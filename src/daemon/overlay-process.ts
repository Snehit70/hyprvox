import { type ChildProcess, spawn } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	unlinkSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { Config } from "../config/schema";
import { logError, logger } from "../utils/logger";
import { getBundledOverlayPath } from "../utils/project-paths";

type OverlayTrigger = "startup" | "restart";
type OverlayBackend = "gtk" | "electron";
type OverlayLaunchMode = "gtk_python" | "electron_fallback" | "custom_binary";

export function findWaylandDisplay(
	runtimeDir: string,
	configuredDisplay?: string,
): string | undefined {
	if (
		configuredDisplay &&
		existsSync(
			isAbsolute(configuredDisplay)
				? configuredDisplay
				: join(runtimeDir, configuredDisplay),
		)
	) {
		return configuredDisplay;
	}

	try {
		return readdirSync(runtimeDir)
			.filter((candidate) => /^wayland-\d+$/.test(candidate))
			.sort()
			.find((candidate) => existsSync(join(runtimeDir, candidate)));
	} catch {
		return undefined;
	}
}

export class OverlayProcessManager {
	private static readonly RESTART_INITIAL_DELAY_MS = 1000;
	private static readonly RESTART_MAX_DELAY_MS = 4000;
	private static readonly RESTART_WINDOW_MS = 60000;
	private static readonly RESTART_MAX_ATTEMPTS = 3;
	private static readonly DISPLAY_RETRY_DELAY_MS = 2000;

	private config: Config;
	private process?: ChildProcess;
	private restartTimer?: NodeJS.Timeout;
	private stopRequested = false;
	private restartAttempts: number[] = [];
	private backend: OverlayBackend = "gtk";

	public constructor(
		config: Config,
		private readonly pidFile: string,
		private logFile: string,
	) {
		this.config = config;
	}

	public updateConfig(config: Config): void {
		this.config = config;
		this.logFile = join(config.paths.logs, "overlay.log");
	}

	public start(trigger: OverlayTrigger = "startup"): void {
		if (!this.config.overlay?.enabled || !this.config.overlay?.autoStart) {
			return;
		}

		if (
			this.process &&
			this.process.exitCode === null &&
			this.process.signalCode === null
		) {
			return;
		}

		this.stopRequested = false;
		if (trigger === "startup") {
			this.backend = "gtk";
			this.restartAttempts = [];
		}

		(async () => {
			try {
				const raw = readFileSync(this.pidFile, "utf8").trim();
				const oldPid = parseInt(raw, 10);
				if (!Number.isNaN(oldPid)) {
					process.kill(oldPid, "SIGTERM");
					logger.debug({ oldPid }, "Terminated stale overlay process");
					await this.waitForProcessExit(oldPid);
				}
			} catch {
				// PID file absent or process already dead.
			}

			const overlayPath = this.getOverlayPath();
			if (!existsSync(overlayPath)) {
				logger.warn(
					{ path: overlayPath },
					"Overlay not found, skipping auto-start",
				);
				return;
			}

			try {
				this.spawnOverlay(overlayPath, trigger);
			} catch (error) {
				logError("Failed to start overlay", error);
				this.scheduleRestart("start_failure");
			}
		})();
	}

	public stop(): void {
		this.stopRequested = true;
		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
			this.restartTimer = undefined;
		}

		if (this.process) {
			try {
				this.process.kill("SIGTERM");
			} catch (e) {
				logger.debug({ err: e }, "Failed to kill overlay process");
			}
			this.process = undefined;
		}

		try {
			const raw = readFileSync(this.pidFile, "utf8").trim();
			const oldPid = parseInt(raw, 10);
			if (!Number.isNaN(oldPid)) {
				process.kill(oldPid, "SIGTERM");
				logger.debug(
					{ oldPid },
					"Terminated stale overlay from previous session",
				);
			}
		} catch {
			// PID file absent or process already dead.
		}

		this.removePidFile();
	}

	private getOverlayPath(): string {
		if (this.config.overlay?.binaryPath) {
			return this.config.overlay.binaryPath;
		}
		return getBundledOverlayPath();
	}

	private resolveLaunchCommand(overlayPath: string): {
		command: string;
		args: string[];
		cwd: string;
		mode: OverlayLaunchMode;
	} {
		const gtkOverlayPath = join(overlayPath, "hyprvox-overlay.py");
		if (this.backend === "gtk" && existsSync(gtkOverlayPath)) {
			return {
				command: "python3",
				args: [gtkOverlayPath],
				cwd: overlayPath,
				mode: "gtk_python",
			};
		}

		const electronPath = join(overlayPath, "node_modules", ".bin", "electron");
		if (existsSync(electronPath)) {
			return {
				command: "prlimit",
				args: [
					"--core=0",
					"--",
					electronPath,
					"--ozone-platform=wayland",
					"--enable-features=UseOzonePlatform",
					".",
				],
				cwd: overlayPath,
				mode: "electron_fallback",
			};
		}

		if (existsSync(gtkOverlayPath)) {
			throw new Error(
				"GTK overlay failed and Electron fallback is not installed",
			);
		}

		return {
			command: overlayPath,
			args: [],
			cwd: dirname(overlayPath),
			mode: "custom_binary",
		};
	}

	private spawnOverlay(overlayPath: string, trigger: OverlayTrigger): void {
		const overlayEnv = this.buildOverlayEnv();
		if (!overlayEnv) {
			this.scheduleDisplayWait();
			return;
		}
		const launch = this.resolveLaunchCommand(overlayPath);

		logger.debug(
			{
				WAYLAND_DISPLAY: overlayEnv.WAYLAND_DISPLAY,
				DISPLAY: overlayEnv.DISPLAY,
				XDG_RUNTIME_DIR: overlayEnv.XDG_RUNTIME_DIR,
			},
			"Starting overlay with display environment",
		);

		mkdirSync(this.config.paths.logs, { recursive: true, mode: 0o700 });
		const overlayLogFd = openSync(this.logFile, "a");

		this.process = spawn(launch.command, launch.args, {
			cwd: launch.cwd,
			detached: true,
			stdio: ["ignore", overlayLogFd, overlayLogFd],
			env: overlayEnv,
		});

		this.process.on("error", (err) => {
			logger.warn({ err }, "Overlay process error");
			if (launch.mode === "gtk_python") {
				this.activateElectronFallback("gtk_spawn_error");
			} else {
				this.scheduleRestart("spawn_error");
			}
		});

		const overlayPid = this.process.pid;
		this.process.on("exit", (code, signal) => {
			if (this.process?.pid === overlayPid) {
				this.process = undefined;
			}
			this.removePidFile(overlayPid);
			logger.warn(
				{
					pid: overlayPid,
					code,
					signal,
					stopRequested: this.stopRequested,
					logFile: this.logFile,
				},
				"Overlay process exited",
			);
			if (this.stopRequested) {
				return;
			}
			if (launch.mode === "gtk_python") {
				this.activateElectronFallback("gtk_process_exit");
			} else {
				this.scheduleRestart("process_exit");
			}
		});

		this.process.unref();

		const pid = this.process.pid;
		if (pid) {
			writeFile(this.pidFile, pid.toString()).catch((e) => {
				logger.debug({ err: e }, "Failed to write overlay PID file");
			});
		}

		closeSync(overlayLogFd);

		logger.info(
			{
				pid,
				logFile: this.logFile,
				trigger,
				launchMode: launch.mode,
			},
			"Overlay started",
		);
	}

	private buildOverlayEnv(): NodeJS.ProcessEnv | null {
		const uid = process.getuid?.() ?? 1000;
		const overlayEnv: NodeJS.ProcessEnv = { ...process.env };
		if (!overlayEnv.XDG_RUNTIME_DIR) {
			overlayEnv.XDG_RUNTIME_DIR = `/run/user/${uid}`;
		}

		const runtimeDir = overlayEnv.XDG_RUNTIME_DIR;
		overlayEnv.WAYLAND_DISPLAY = findWaylandDisplay(
			runtimeDir,
			overlayEnv.WAYLAND_DISPLAY,
		);

		if (!overlayEnv.WAYLAND_DISPLAY) {
			return null;
		}

		// Never fall through to X11 at login: its per-boot Xauthority may not yet
		// exist. Both GTK and Electron are explicitly launched on Wayland.
		delete overlayEnv.DISPLAY;
		delete overlayEnv.XAUTHORITY;
		overlayEnv.GDK_BACKEND = "wayland";
		overlayEnv.ELECTRON_OZONE_PLATFORM_HINT = "wayland";

		return overlayEnv;
	}

	private scheduleDisplayWait(): void {
		if (
			this.stopRequested ||
			this.restartTimer ||
			!this.config.overlay?.enabled ||
			!this.config.overlay?.autoStart
		) {
			return;
		}

		logger.debug(
			{ delayMs: OverlayProcessManager.DISPLAY_RETRY_DELAY_MS },
			"Wayland session not ready; delaying overlay startup",
		);
		this.restartTimer = setTimeout(() => {
			this.restartTimer = undefined;
			this.start("restart");
		}, OverlayProcessManager.DISPLAY_RETRY_DELAY_MS);
	}

	private activateElectronFallback(reason: string): void {
		if (this.stopRequested || this.backend === "electron") {
			return;
		}
		this.backend = "electron";
		this.restartAttempts = [];
		logger.error(
			{ reason, logFile: this.logFile },
			"GTK overlay failed; activating guarded Electron fallback",
		);
		this.scheduleRestart(reason);
	}

	private scheduleRestart(reason: string): void {
		if (
			this.stopRequested ||
			this.restartTimer ||
			!this.config.overlay?.enabled ||
			!this.config.overlay?.autoStart
		) {
			return;
		}

		const now = Date.now();
		this.pruneRestartAttempts(now);
		if (
			this.restartAttempts.length >= OverlayProcessManager.RESTART_MAX_ATTEMPTS
		) {
			logger.error(
				{
					reason,
					attempts: this.restartAttempts.length,
					windowMs: OverlayProcessManager.RESTART_WINDOW_MS,
					logFile: this.logFile,
				},
				"Overlay crashed too often; automatic restart disabled",
			);
			return;
		}

		this.restartAttempts.push(now);
		const restartDelayMs = Math.min(
			OverlayProcessManager.RESTART_INITIAL_DELAY_MS *
				2 ** (this.restartAttempts.length - 1),
			OverlayProcessManager.RESTART_MAX_DELAY_MS,
		);

		logger.warn(
			{
				reason,
				delayMs: restartDelayMs,
				attempt: this.restartAttempts.length,
				logFile: this.logFile,
			},
			"Scheduling overlay restart",
		);

		this.restartTimer = setTimeout(() => {
			this.restartTimer = undefined;
			this.start("restart");
		}, restartDelayMs);
	}

	private pruneRestartAttempts(now = Date.now()): void {
		this.restartAttempts = this.restartAttempts.filter(
			(at) => now - at <= OverlayProcessManager.RESTART_WINDOW_MS,
		);
	}

	private removePidFile(expectedPid?: number): void {
		try {
			if (expectedPid !== undefined) {
				const raw = readFileSync(this.pidFile, "utf8").trim();
				const currentPid = parseInt(raw, 10);
				if (currentPid !== expectedPid) {
					return;
				}
			}
			unlinkSync(this.pidFile);
		} catch (e) {
			logger.debug({ err: e }, "Failed to remove overlay PID file");
		}
	}

	private async waitForProcessExit(
		pid: number,
		timeoutMs = 3000,
	): Promise<void> {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			try {
				process.kill(pid, 0);
				await new Promise((r) => setTimeout(r, 50));
			} catch {
				return;
			}
		}
		logger.debug({ pid, timeoutMs }, "Timeout waiting for process exit");
	}
}
