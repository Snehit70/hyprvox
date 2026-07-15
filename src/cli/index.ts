import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import * as colors from "yoctocolors";
import { AudioDeviceService } from "../audio/device-service";
import type { DaemonState } from "../daemon/service";
import { projectRoot } from "../utils/project-paths";
import { SOCKET_PATH } from "../utils/socket-path";
import { loadStats } from "../utils/stats";
import { spawnAppDetached, spawnAppForeground } from "./app-launcher";
import { boostCommand } from "./boost";
import { configCommand } from "./config";
import { errorsCommand } from "./errors";
import { healthCommand } from "./health";
import { historyCommand } from "./history";
import { logsCommand } from "./logs";
import { setupCommand } from "./setup";
import { statsCommand } from "./stats";

const program = new Command();
const configDir = join(homedir(), ".config", "hypr", "vox");
const pidFile = join(configDir, "daemon.pid");
const stateFile = join(configDir, "daemon.state");

interface PackageMetadata {
	version: string;
}

const packageMetadata: PackageMetadata = (() => {
	try {
		const parsed = JSON.parse(
			readFileSync(join(projectRoot, "package.json"), "utf-8"),
		);
		if (typeof parsed.version === "string") return parsed as PackageMetadata;
		throw new Error("version field missing or not a string");
	} catch {
		console.error(
			colors.yellow("Warning: Could not read package.json for version info"),
		);
		return { version: "0.0.0-unknown" };
	}
})();

program
	.name("hyprvox")
	.description("Speech-to-text daemon for Hyprland")
	.version(packageMetadata.version);

/** Pid from the pidfile if that process is alive; null otherwise. */
function readAlivePid(): number | null {
	if (!existsSync(pidFile)) {
		return null;
	}
	try {
		const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
		if (Number.isNaN(pid)) {
			return null;
		}
		process.kill(pid, 0);
		return pid;
	} catch {
		return null;
	}
}

function cleanStalePidFile(): void {
	if (existsSync(pidFile) && readAlivePid() === null) {
		console.log(
			colors.yellow("Cleaning up stale PID file from previous session..."),
		);
		try {
			unlinkSync(pidFile);
		} catch {
			// PID file may have already been removed
		}
	}
}

/** Wait for the app's DaemonService to write its pidfile after a spawn. */
async function waitForAlivePid(timeoutMs = 10000): Promise<number | null> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const pid = readAlivePid();
		if (pid !== null) {
			return pid;
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	return null;
}

function startApp(foreground: boolean): void {
	const runningPid = readAlivePid();
	if (runningPid !== null) {
		console.error(
			colors.red(`Error: hyprvox is already running (PID: ${runningPid})`),
		);
		console.log(`To stop it, run: ${colors.cyan("hyprvox stop")}`);
		process.exit(1);
	}
	cleanStalePidFile();

	try {
		if (foreground) {
			console.log(`${colors.cyan("Starting hyprvox app (foreground)...")}`);
			spawnAppForeground();
		} else {
			console.log(`${colors.cyan("Starting hyprvox app...")}`);
			const pid = spawnAppDetached();
			console.log(
				`${colors.green("✅")} App launched${pid ? ` (${colors.dim(`PID: ${pid}`)})` : ""} — logs: ${colors.dim(join(configDir, "logs", "app.log"))}`,
			);
		}
	} catch (err) {
		console.error(colors.red("Failed to start app:"), (err as Error).message);
		process.exit(1);
	}
}

program
	.command("start")
	.description("Start the hyprvox app (daemon + overlay in one process)")
	.option("--foreground", "Stay attached to the terminal (for debugging)")
	.action((options) => {
		startApp(Boolean(options.foreground));
	});

program
	.command("stop")
	.description("Stop the daemon")
	.action(() => {
		if (!existsSync(pidFile)) {
			console.error("Daemon is not running (no PID file found)");
			return;
		}

		try {
			const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
			try {
				process.kill(pid, "SIGTERM");
				console.log(
					`${colors.green("✅")} Stopped daemon (${colors.dim(`PID: ${pid}`)})`,
				);
				// Do NOT unlink pidFile/stateFile here — DaemonService.stop() already
				// deletes them after recorder and IPC teardown. Unlinking early creates
				// a race where a new `hyprvox start` can launch a duplicate daemon.
			} catch (killError: unknown) {
				// Process doesn't exist (ESRCH) - clean up stale PID file
				if (
					killError instanceof Error &&
					"code" in killError &&
					killError.code === "ESRCH"
				) {
					console.log(
						colors.yellow("Daemon was not running (stale PID file cleaned up)"),
					);
					if (existsSync(pidFile)) unlinkSync(pidFile);
					if (existsSync(stateFile)) unlinkSync(stateFile);
				} else {
					throw killError;
				}
			}
		} catch (error) {
			console.error(colors.red("Failed to stop daemon:"), error);
		}
	});

program
	.command("restart")
	.description("Restart the hyprvox app")
	.action(async () => {
		if (existsSync(pidFile)) {
			try {
				const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
				process.kill(pid, "SIGTERM");
				console.log(colors.yellow("Stopping app..."));
				// Wait for the old process to actually exit; spawning while it
				// still holds the pidfile/socket would fail the instance guard.
				const deadline = Date.now() + 5000;
				while (Date.now() < deadline) {
					try {
						process.kill(pid, 0);
						await new Promise((resolve) => setTimeout(resolve, 100));
					} catch {
						break;
					}
				}
				if (existsSync(stateFile)) unlinkSync(stateFile);
			} catch (error) {
				const err = error as NodeJS.ErrnoException;
				if (err.code !== "ESRCH") {
					console.error(colors.red("Failed to stop app:"), err);
					process.exit(1);
				}
				console.log(colors.yellow("Cleaning up stale PID file..."));
				if (existsSync(pidFile)) unlinkSync(pidFile);
				if (existsSync(stateFile)) unlinkSync(stateFile);
			}
		}
		startApp(false);
	});

program
	.command("status")
	.description("Show daemon status")
	.action(() => {
		if (!existsSync(pidFile)) {
			console.log(`${colors.dim("Status:")} ${colors.red("Stopped")}`);
			const stats = loadStats();
			console.log(
				`${colors.dim("Today:")}  ${colors.bold(stats.today.toString())}`,
			);
			console.log(
				`${colors.dim("Total:")}  ${colors.bold(stats.total.toString())}`,
			);
			return;
		}

		const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
		try {
			process.kill(pid, 0);
			console.log(
				`${colors.dim("Status:")} ${colors.green("Running")} (${colors.dim(`PID: ${pid}`)})`,
			);

			if (existsSync(stateFile)) {
				const state: DaemonState = JSON.parse(readFileSync(stateFile, "utf-8"));

				let statusColor = colors.blue;
				if (state.status === "recording") statusColor = colors.red;
				if (state.status === "processing") statusColor = colors.yellow;
				if (state.status === "error") statusColor = colors.red;
				if (state.status === "idle") statusColor = colors.green;

				console.log(
					`${colors.dim("State:")}  ${statusColor(state.status.toUpperCase())}`,
				);
				console.log(`${colors.dim("Uptime:")} ${state.uptime}s`);
				console.log(
					`${colors.dim("Today:")}  ${colors.bold(state.transcriptionCountToday.toString())}`,
				);
				console.log(
					`${colors.dim("Total:")}  ${colors.bold(state.transcriptionCountTotal.toString())}`,
				);
				console.log(
					`${colors.dim("Errors:")} ${state.errorCount > 0 ? colors.red(state.errorCount.toString()) : colors.green("0")}`,
				);

				if (state.lastTranscription) {
					console.log(
						`${colors.dim("Last:")}   ${new Date(state.lastTranscription).toLocaleString()}`,
					);
				}
				if (state.lastError) {
					console.log(
						`${colors.red("Error:")}  ${colors.red(state.lastError)}`,
					);
				}
			}
		} catch (_e) {
			console.log(
				`${colors.dim("Status:")} ${colors.yellow("Dead")} ${colors.dim("(PID file exists but process is not running)")}`,
			);
			const stats = loadStats();
			console.log(
				`${colors.dim("Today:")}  ${colors.bold(stats.today.toString())}`,
			);
			console.log(
				`${colors.dim("Total:")}  ${colors.bold(stats.total.toString())}`,
			);
		}
	});

program
	.command("toggle")
	.description("Toggle recording (start/stop); starts the app if it is down")
	.action(async () => {
		let pid = readAlivePid();

		// Lazy-spawn crash recovery: if the app died (or was never started),
		// a toggle brings it back up and then delivers the trigger.
		if (pid === null) {
			cleanStalePidFile();
			if (existsSync(stateFile)) unlinkSync(stateFile);
			console.log(colors.yellow("App not running; starting it..."));
			try {
				spawnAppDetached();
			} catch (err) {
				console.error(
					colors.red("Failed to start app:"),
					(err as Error).message,
				);
				process.exit(1);
			}
			pid = await waitForAlivePid();
			if (pid === null) {
				console.error(
					colors.red("App did not come up in time. Check logs:"),
					colors.dim(join(configDir, "logs", "app.log")),
				);
				process.exit(1);
			}
		}

		try {
			process.kill(pid, "SIGUSR1");
			console.log(
				`${colors.green("✅")} Toggle signal sent to daemon (${colors.dim(`PID: ${pid}`)})`,
			);
		} catch (error) {
			console.error(colors.red("Failed to send toggle signal:"), error);
			process.exit(1);
		}
	});

program
	.command("soniox-toggle")
	.description("Toggle Soniox live dictation (start/stop)")
	.action(async () => {
		if (!existsSync(SOCKET_PATH)) {
			console.error(colors.red("Error: Daemon is not running."));
			console.log(`Start it with: ${colors.cyan("hyprvox start")}`);
			process.exit(1);
		}

		const { createConnection } = await import("node:net");
		const client = createConnection({ path: SOCKET_PATH });

		client.on("connect", () => {
			client.write(
				JSON.stringify({ type: "action", action: "soniox-toggle" }) + "\n",
			);
			console.log(colors.green("✅") + " Soniox toggle sent to daemon");
			client.destroy();
			process.exit(0);
		});

		client.on("error", (err) => {
			console.error(colors.red("Failed to reach daemon:"), err.message);
			process.exit(1);
		});
	});

program
	.command("install")
	.description("Show how to autostart hyprvox with Hyprland")
	.action(() => {
		// The app supervises itself (Electron is the single supervisor,
		// ADR-0003); autostart is a compositor exec-once, not a systemd unit.
		const logsDir = join(configDir, "logs");
		if (!existsSync(logsDir)) {
			mkdirSync(logsDir, { recursive: true, mode: 0o700 });
		}

		const configPath = join(configDir, "config.json");
		const legacyUnit = join(
			homedir(),
			".config",
			"systemd",
			"user",
			"hyprvox.service",
		);

		console.log(colors.bold("\nAutostart hyprvox with Hyprland:"));
		console.log("\nAdd to your hyprland.conf:");
		console.log(`  ${colors.cyan("exec-once = hyprvox start")}`);
		console.log("\nRecommended toggle binding (example):");
		console.log(
			`  ${colors.cyan("bind = , code:105, exec, hyprvox toggle")}  ${colors.dim("# Right Control")}`,
		);
		console.log(
			`\nIf hyprvox dies, the next ${colors.cyan("hyprvox toggle")} restarts it automatically.`,
		);

		if (existsSync(legacyUnit)) {
			console.log(
				`\n${colors.yellow("⚠️")}  Legacy systemd unit found at ${colors.dim(legacyUnit)}.`,
			);
			console.log(
				`   Remove it with: ${colors.cyan("hyprvox uninstall")} (the app now supervises itself).`,
			);
		}

		if (!existsSync(configPath)) {
			console.log(
				`\n${colors.yellow("CRITICAL:")} Initialize your API keys first: ${colors.cyan("hyprvox config init")}`,
			);
		}
		console.log("");
	});

program
	.command("uninstall")
	.description("Remove the legacy systemd service")
	.action(() => {
		const serviceName = "hyprvox";
		const serviceDir = join(homedir(), ".config", "systemd", "user");
		const servicePath = join(serviceDir, `${serviceName}.service`);

		if (existsSync(servicePath)) {
			console.log(`Stopping and disabling ${serviceName} service...`);
			try {
				try {
					execSync(`systemctl --user stop ${serviceName}`, { stdio: "ignore" });
				} catch {
					// Service may not be running
				}

				try {
					execSync(`systemctl --user disable ${serviceName}`, {
						stdio: "ignore",
					});
				} catch {
					// Service may not be enabled
				}

				unlinkSync(servicePath);

				try {
					execSync("systemctl --user daemon-reload", { stdio: "ignore" });
				} catch {
					// daemon-reload may fail, non-critical
				}

				console.log("Service removed successfully.");
			} catch (error) {
				console.error("Failed to remove service:", (error as Error).message);
			}
		} else {
			console.log("Service file not found.");
		}
	});

program
	.command("list-mics")
	.description("List available microphone devices")
	.action(async () => {
		const deviceService = new AudioDeviceService();
		try {
			try {
				execSync("which arecord", { stdio: "ignore" });
			} catch {
				console.log(colors.red("Cannot list microphones: arecord is missing."));
				console.log(
					colors.dim("Install alsa-utils, then run hyprvox list-mics again."),
				);
				console.log(
					colors.cyan(
						"Debian/Ubuntu: sudo apt install alsa-utils\nFedora: sudo dnf install -y alsa-utils\nArch: sudo pacman -S alsa-utils",
					),
				);
				return;
			}

			console.log("Scanning for audio devices...");
			const devices = await deviceService.listDevices();

			if (devices.length === 0) {
				console.log(colors.yellow("No audio devices found."));
				console.log(
					colors.dim(
						"Check that a microphone is connected and visible to ALSA/PipeWire.",
					),
				);
				return;
			}

			console.log("\nAvailable Audio Devices:");
			console.log("------------------------");
			devices.forEach((device) => {
				console.log(`ID:   ${device.id}`);
				console.log(`Desc: ${device.description}`);
				console.log("------------------------");
			});

			console.log(
				"\nTo use a device, add its ID to your config file (~/.config/hypr/vox/config.json):",
			);
			console.log('"behavior": { "audioDevice": "YOUR_DEVICE_ID" }');
		} catch (error) {
			console.error(
				colors.red("Failed to list microphones:"),
				(error as Error).message,
			);
		}
	});

program.addCommand(logsCommand);
program.addCommand(configCommand);
program.addCommand(boostCommand);
program.addCommand(healthCommand);
program.addCommand(errorsCommand);
program.addCommand(historyCommand);
program.addCommand(setupCommand);
program.addCommand(statsCommand);

export { program };
