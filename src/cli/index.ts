import { execSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import * as colors from "yoctocolors";
import { AudioDeviceService } from "../audio/device-service";
import { DaemonService, type DaemonState } from "../daemon/service";
import { DaemonSupervisor } from "../daemon/supervisor";
import { loadStats } from "../utils/stats";
import { boostCommand } from "./boost";
import { configCommand } from "./config";
import { errorsCommand } from "./errors";
import { healthCommand } from "./health";
import { historyCommand } from "./history";
import { logsCommand } from "./logs";

const program = new Command();
const configDir = join(homedir(), ".config", "voice-cli");
const pidFile = join(configDir, "daemon.pid");
const stateFile = join(configDir, "daemon.state");

program
	.name("voice-cli")
	.description("Voice-to-text CLI daemon")
	.version("1.0.0");

program
	.command("start")
	.description("Start the daemon")
	.option("--no-supervisor", "Run directly without supervisor")
	.option("--daemon-worker", "Internal: Run as daemon worker process")
	.action((options) => {
		if (existsSync(pidFile) && !process.env.VOICE_CLI_DAEMON_WORKER) {
			try {
				const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
				try {
					process.kill(pid, 0);
					console.error(
						colors.red(`Error: Daemon is already running (PID: ${pid})`),
					);
					console.log(
						`To stop the daemon, run: ${colors.cyan("voice-cli stop")}`,
					);
					console.log(
						`Or if using systemd: ${colors.cyan("systemctl --user stop voice-cli")}`,
					);
					process.exit(1);
				} catch (_e) {}
			} catch (_e) {}
		}

		if (options.supervisor && !process.env.VOICE_CLI_DAEMON_WORKER) {
			console.log(`${colors.cyan("Starting daemon with supervisor...")}`);
			const supervisor = new DaemonSupervisor(join(process.cwd(), "index.ts"));
			supervisor.start();
		} else {
			console.log(`${colors.cyan("Starting daemon worker...")}`);
			let service: DaemonService;
			try {
				service = new DaemonService();
				service.start().catch((err) => {
					console.error(colors.red("\nFailed to start daemon:"), err.message);
					process.exit(1);
				});
			} catch (err: any) {
				console.error(
					colors.red("\nFailed to initialize daemon:"),
					err.message,
				);
				process.exit(1);
			}

			process.on("SIGINT", () => {
				service
					.stop()
					.then(() => process.exit(0))
					.catch((err) => {
						console.error(
							colors.red("Failed to stop daemon:"),
							err?.message ?? err,
						);
						process.exit(1);
					});
			});

			process.on("SIGTERM", () => {
				service
					.stop()
					.then(() => process.exit(0))
					.catch((err) => {
						console.error(
							colors.red("Failed to stop daemon:"),
							err?.message ?? err,
						);
						process.exit(1);
					});
			});
		}
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
			process.kill(pid, "SIGTERM");
			console.log(
				`${colors.green("✅")} Stopped daemon (${colors.dim(`PID: ${pid}`)})`,
			);

			if (existsSync(stateFile)) unlinkSync(stateFile);
		} catch (error) {
			console.error(colors.red("Failed to stop daemon:"), error);
			if (existsSync(pidFile)) unlinkSync(pidFile);
		}
	});

program
	.command("restart")
	.description("Restart the daemon")
	.action(async () => {
		if (existsSync(pidFile)) {
			try {
				const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
				process.kill(pid, "SIGTERM");
				console.log(colors.yellow("Stopping daemon..."));
				await new Promise((resolve) => setTimeout(resolve, 1000));
				if (existsSync(stateFile)) unlinkSync(stateFile);
			} catch (error) {
				const err = error as NodeJS.ErrnoException;
				if (err.code !== "ESRCH") {
					console.error(colors.red("Failed to stop daemon:"), err);
					process.exit(1);
				}
				console.log(colors.yellow("Cleaning up stale PID file..."));
				if (existsSync(pidFile)) unlinkSync(pidFile);
				if (existsSync(stateFile)) unlinkSync(stateFile);
			}
		}
		console.log(colors.cyan("Starting daemon..."));
		const supervisor = new DaemonSupervisor(join(process.cwd(), "index.ts"));
		supervisor.start();
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
	.description("Toggle recording (start/stop)")
	.action(() => {
		if (!existsSync(pidFile)) {
			console.error(colors.red("Error: Daemon is not running."));
			console.log(`Start it with: ${colors.cyan("voice-cli start")}`);
			process.exit(1);
		}

		try {
			const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
			process.kill(pid, "SIGUSR1");
			console.log(
				`${colors.green("✅")} Toggle signal sent to daemon (${colors.dim(`PID: ${pid}`)})`,
			);
		} catch (error) {
			const err = error as NodeJS.ErrnoException;
			console.error(colors.red("Failed to send toggle signal:"), err);
			if (err.code !== "ESRCH") {
				process.exit(1);
			}
			console.log(colors.yellow("Cleaning up stale PID file..."));
			if (existsSync(pidFile)) unlinkSync(pidFile);
			if (existsSync(stateFile)) unlinkSync(stateFile);
			console.log(`Start the daemon with: ${colors.cyan("voice-cli start")}`);
			process.exit(1);
		}
	});

program
	.command("install")
	.description("Install systemd service")
	.action(() => {
		try {
			const serviceName = "voice-cli";
			const serviceDir = join(homedir(), ".config", "systemd", "user");
			const logsDir = join(configDir, "logs");
			const servicePath = join(serviceDir, `${serviceName}.service`);
			const workingDir = process.cwd();
			const bunPath = process.argv[0];
			const entryPoint = join(workingDir, "index.ts");
			const userId = process.getuid?.() ?? 1000;

			if (!existsSync(serviceDir)) {
				mkdirSync(serviceDir, { recursive: true });
			}

			if (!existsSync(logsDir)) {
				console.log(`Creating log directory: ${logsDir}`);
				mkdirSync(logsDir, { recursive: true, mode: 0o700 });
			}

			console.log(`Installing systemd service for ${serviceName}...`);

			const serviceContent = `[Unit]
Description=Voice CLI Daemon
After=network.target sound.target
StartLimitIntervalSec=300
StartLimitBurst=3

[Service]
Type=simple
WorkingDirectory=${workingDir}
ExecStart=${bunPath} run ${entryPoint} start --no-supervisor
Restart=always
RestartSec=5
Environment=PATH=${process.env.PATH}
Environment=DISPLAY=${process.env.DISPLAY || ""}
Environment=XAUTHORITY=${process.env.XAUTHORITY || ""}
Environment=WAYLAND_DISPLAY=${process.env.WAYLAND_DISPLAY || ""}
Environment=XDG_RUNTIME_DIR=/run/user/${userId}

[Install]
WantedBy=default.target
`;

			writeFileSync(servicePath, serviceContent);
			console.log("Service file created.");

			console.log("Reloading systemd daemon...");
			execSync("systemctl --user daemon-reload");

			console.log(`Enabling ${serviceName} service...`);
			execSync(`systemctl --user enable ${serviceName}`);

			console.log(`Starting ${serviceName} service...`);
			execSync(`systemctl --user start ${serviceName}`);

			const configPath = join(configDir, "config.json");
			const configExists = existsSync(configPath);

			console.log(
				`\n${colors.green("------------------------------------------------")}`,
			);
			console.log(colors.bold("  Installation complete! 🚀"));

			let statusStr = colors.red("Inactive");
			try {
				const isActive = execSync(`systemctl --user is-active ${serviceName}`)
					.toString()
					.trim();
				if (isActive === "active") statusStr = colors.green("Active");
				else if (isActive === "activating")
					statusStr = colors.yellow("Activating");
			} catch (_e) {}
			console.log(`  Status: ${statusStr}`);
			console.log(
				colors.green("------------------------------------------------"),
			);

			console.log(colors.bold("\nNext Steps:"));

			if (!configExists) {
				console.log(
					`  1. ${colors.yellow("CRITICAL:")} Initialize your API keys:`,
				);
				console.log(`     ${colors.cyan("bun run index.ts config init")}`);
			} else {
				console.log(`  1. Verify your configuration:`);
				console.log(`     ${colors.cyan("bun run index.ts config list")}`);
			}

			console.log(`  2. Select your microphone device:`);
			console.log(`     ${colors.cyan("bun run index.ts list-mics")}`);

			console.log(`  3. Configure your hotkey (default: Right Control):`);
			console.log(`     ${colors.cyan("bun run index.ts config bind")}`);

			console.log(colors.bold("\nVerification:"));
			console.log(
				`  - Check service status: ${colors.cyan(`systemctl --user status ${serviceName}`)}`,
			);
			console.log(
				`  - Follow live logs:     ${colors.cyan(`journalctl --user -u ${serviceName} -f`)}`,
			);

			console.log(colors.bold("\nFiles:"));
			console.log(`  - Config: ${colors.dim(configPath)}`);
			console.log(`  - Logs:   ${colors.dim(logsDir)}`);
			console.log(
				colors.green("------------------------------------------------\n"),
			);
		} catch (error) {
			console.error("Installation failed:", (error as Error).message);
			process.exit(1);
		}
	});

program
	.command("uninstall")
	.description("Remove systemd service")
	.action(() => {
		const serviceName = "voice-cli";
		const serviceDir = join(homedir(), ".config", "systemd", "user");
		const servicePath = join(serviceDir, `${serviceName}.service`);

		if (existsSync(servicePath)) {
			console.log(`Stopping and disabling ${serviceName} service...`);
			try {
				try {
					execSync(`systemctl --user stop ${serviceName}`, { stdio: "ignore" });
				} catch (_e) {}

				try {
					execSync(`systemctl --user disable ${serviceName}`, {
						stdio: "ignore",
					});
				} catch (_e) {}

				unlinkSync(servicePath);

				try {
					execSync("systemctl --user daemon-reload", { stdio: "ignore" });
				} catch (_e) {}

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
			console.log("Scanning for audio devices...");
			const devices = await deviceService.listDevices();

			if (devices.length === 0) {
				console.log("No audio devices found.");
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
				"\nTo use a device, add its ID to your config file (~/.config/voice-cli/config.json):",
			);
			console.log('"behavior": { "audioDevice": "YOUR_DEVICE_ID" }');
		} catch (error) {
			console.error("Failed to list microphones:", error);
		}
	});

program.addCommand(logsCommand);
program.addCommand(configCommand);
program.addCommand(boostCommand);
program.addCommand(healthCommand);
program.addCommand(errorsCommand);
program.addCommand(historyCommand);

export { program };
