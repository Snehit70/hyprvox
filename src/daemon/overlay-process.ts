import { type ChildProcess, spawn } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	unlinkSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "../config/schema";
import { logError, logger } from "../utils/logger";
import { getBundledOverlayPath } from "../utils/project-paths";

type OverlayTrigger = "startup" | "restart";

export class OverlayProcessManager {
	private static readonly RESTART_INITIAL_DELAY_MS = 250;
	private static readonly RESTART_MAX_DELAY_MS = 2000;
	private static readonly RESTART_WINDOW_MS = 60000;
	private static readonly RESTART_MAX_ATTEMPTS = 5;

	private config: Config;
	private process?: ChildProcess;
	private restartTimer?: NodeJS.Timeout;
	private stopRequested = false;
	private restartAttempts: number[] = [];

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
		// When the daemon runs inside the Electron main process (single-app
		// topology), the overlay is the host — do not spawn a second Electron.
		if (process.env.HYPRVOX_EMBEDDED_OVERLAY) {
			return;
		}
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
		mode: "electron_direct" | "bun_fallback";
	} {
		const directElectronPath = join(
			overlayPath,
			"node_modules",
			".bin",
			"electron",
		);
		if (existsSync(directElectronPath)) {
			return {
				command: directElectronPath,
				args: ["."],
				mode: "electron_direct",
			};
		}

		return {
			command: "bun",
			args: ["run", "start"],
			mode: "bun_fallback",
		};
	}

	private spawnOverlay(overlayPath: string, trigger: OverlayTrigger): void {
		const launch = this.resolveLaunchCommand(overlayPath);
		const overlayEnv = this.buildOverlayEnv();

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
			cwd: overlayPath,
			detached: true,
			stdio: ["ignore", overlayLogFd, overlayLogFd],
			env: overlayEnv,
		});

		this.process.on("error", (err) => {
			logger.warn({ err }, "Overlay process error");
			this.scheduleRestart("spawn_error");
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
			if (!this.stopRequested) {
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

		if (trigger === "startup") {
			this.restartAttempts = [];
		}

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

	private buildOverlayEnv(): NodeJS.ProcessEnv {
		const uid = process.getuid?.() ?? 1000;
		const overlayEnv: NodeJS.ProcessEnv = { ...process.env };

		if (!overlayEnv.WAYLAND_DISPLAY && !overlayEnv.DISPLAY) {
			overlayEnv.WAYLAND_DISPLAY = "wayland-1";
			overlayEnv.DISPLAY = ":0";
		}

		if (!overlayEnv.XDG_RUNTIME_DIR) {
			overlayEnv.XDG_RUNTIME_DIR = `/run/user/${uid}`;
		}

		return overlayEnv;
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
