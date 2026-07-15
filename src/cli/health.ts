import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import * as colors from "yoctocolors";
import { AudioDeviceService } from "../audio/device-service";
import { DEFAULT_CONFIG_FILE, loadConfig } from "../config/loader";
import type { DaemonState } from "../daemon/service";
import { detectEnvironment, getInstallCommand } from "../setup/environment";
import { DeepgramTranscriber } from "../transcribe/deepgram";
import { GroqClient } from "../transcribe/groq";

export const healthCommand = new Command("health")
	.description("Check system health and configuration")
	.action(async () => {
		console.log(`\n${colors.bold(colors.cyan("🔍 Hyprvox Health Check"))}`);
		console.log(`${colors.cyan("=======================")}\n`);

		let allOk = true;
		let config: any;
		const envInfo = detectEnvironment();
		const sessionType =
			envInfo.sessionType === "headless" ? "unknown" : envInfo.sessionType;
		const isWayland = sessionType === "wayland";
		const installCommand = getInstallCommand(
			envInfo.distro,
			envInfo.sessionType,
		);

		// 1. Environment Check
		console.log(colors.bold("--- Environment ---"));
		console.log(`${colors.dim("OS:")}      ${process.platform}`);
		console.log(
			`${colors.dim("Session:")} ${
				sessionType === "wayland"
					? colors.magenta("Wayland")
					: sessionType === "x11"
						? colors.blue("X11")
						: colors.yellow("Unknown")
			}`,
		);

		try {
			if (isWayland) {
				execSync("which wl-copy", { stdio: "ignore" });
				console.log(`${colors.green("✅")} wl-clipboard found`);
			} else if (sessionType === "x11") {
				execSync("which xclip || which xsel", { stdio: "ignore" });
				console.log(`${colors.green("✅")} xclip/xsel found`);
			} else {
				execSync("which wl-copy || which xclip || which xsel", {
					stdio: "ignore",
				});
				console.log(
					`${colors.green("✅")} Clipboard tools found (session auto-detect unavailable)`,
				);
			}
		} catch (_e) {
			console.log(
				`${colors.red("❌")} Clipboard tools missing (wl-clipboard or xclip/xsel)`,
			);
			allOk = false;
		}

		try {
			execSync("which notify-send", { stdio: "ignore" });
			console.log(`${colors.green("✅")} libnotify (notify-send) found`);
		} catch (_e) {
			console.log(
				`${colors.yellow("⚠️  libnotify missing (notifications may not work)")}`,
			);
		}

		// 2. Configuration Check
		console.log(`\n${colors.bold("--- Configuration ---")}`);
		try {
			config = loadConfig();
			console.log(
				`${colors.green("✅")} Config loaded from ${colors.dim(DEFAULT_CONFIG_FILE)}`,
			);

			const stats = statSync(DEFAULT_CONFIG_FILE);
			const mode = stats.mode & 0o777;
			if (mode === 0o600) {
				console.log(`${colors.green("✅")} Config file permissions are 600`);
			} else {
				console.log(
					`${colors.yellow("⚠️  Config file permissions are")} ${colors.bold(mode.toString(8))} ${colors.yellow("(recommended: 600)")}`,
				);
			}
		} catch (e) {
			console.log(
				`${colors.red("❌")} Config Error:`,
				colors.red((e as Error).message),
			);
			allOk = false;
		}

		if (isWayland && config) {
			const hotkeyDisabled =
				config.behavior?.hotkey?.toLowerCase() === "disabled";
			if (!hotkeyDisabled) {
				console.log(
					`${colors.yellow("⚠️")}  ${colors.bold("Wayland Hotkey Limitation:")}`,
				);
				console.log(
					`${colors.dim("   Built-in hotkeys only work with XWayland windows.")}`,
				);
				console.log(
					`${colors.dim("   For reliable system-wide hotkeys, see:")} ${colors.cyan("docs/WAYLAND.md")}`,
				);
				console.log(
					`${colors.dim("   Or set")} ${colors.bold('"hotkey": "disabled"')} ${colors.dim("in config and use compositor bindings.")}`,
				);
			} else {
				console.log(
					`${colors.green("✅")} Hotkey listener disabled (using compositor bindings)`,
				);
			}
		}

		// 3. API Connectivity Check
		if (config) {
			console.log(`\n${colors.bold("--- API Connectivity ---")}`);

			// Test Groq
			try {
				const groq = new GroqClient();
				const connected = await groq.checkConnection();
				if (connected) {
					console.log(
						`${colors.green("✅")} Groq API: ${colors.green("Connected")}`,
					);
				}
			} catch (e) {
				console.log(
					`${colors.red("❌")} Groq API Error:`,
					colors.red((e as Error).message),
				);
				allOk = false;
			}

			// Test Deepgram
			try {
				const deepgram = new DeepgramTranscriber();
				const connected = await deepgram.checkConnection();
				if (connected) {
					console.log(
						`${colors.green("✅")} Deepgram API: ${colors.green("Connected")}`,
					);
				}
			} catch (e) {
				console.log(
					`${colors.red("❌")} Deepgram API Error:`,
					colors.red((e as Error).message),
				);
				allOk = false;
			}
		}

		// 4. Audio Check
		console.log(`\n${colors.bold("--- Audio Devices ---")}`);
		try {
			if (!envInfo.commands.arecord?.path) {
				console.log(
					`${colors.red("❌")} arecord is not installed; cannot inspect microphones`,
				);
				if (installCommand) {
					console.log(
						`${colors.dim("   Install deps:")} ${colors.cyan(installCommand)}`,
					);
				}
				if (envInfo.isContainer || envInfo.sessionType === "headless") {
					console.log(
						colors.dim(
							"   This is expected in many containers/headless sessions. Run full audio checks on the desktop host.",
						),
					);
				}
				allOk = false;
			} else {
				const deviceService = new AudioDeviceService();
				const devices = await deviceService.listDevices();
				if (devices.length > 0) {
					console.log(
						`${colors.green("✅")} ${colors.bold(devices.length.toString())} audio devices found`,
					);
					if (config?.behavior?.audioDevice) {
						const found = devices.find(
							(d) => d.id === config.behavior.audioDevice,
						);
						if (found) {
							console.log(
								`${colors.green("✅")} Configured device found: ${colors.cyan(found.description)}`,
							);
						} else {
							console.log(
								`${colors.red("❌")} Configured device not found: ${colors.bold(config.behavior.audioDevice)}`,
							);
							allOk = false;
						}
					} else {
						console.log(`${colors.blue("ℹ️")}  Using default system microphone`);
					}
				} else {
					console.log(`${colors.red("❌")} No audio devices found`);
					allOk = false;
				}
			}
		} catch (e) {
			console.log(
				`${colors.red("❌")} Audio Check Error:`,
				colors.red((e as Error).message),
			);
			allOk = false;
		}

		// 5. Daemon Check
		console.log(`\n${colors.bold("--- Daemon Status ---")}`);
		const configDir = join(homedir(), ".config", "hypr", "vox");
		const pidFile = join(configDir, "daemon.pid");
		const stateFile = join(configDir, "daemon.state");

		if (existsSync(pidFile)) {
			const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
			try {
				process.kill(pid, 0);
				console.log(
					`${colors.green("✅")} Daemon is running (${colors.dim(`PID: ${pid}`)})`,
				);

				if (existsSync(stateFile)) {
					const state: DaemonState = JSON.parse(
						readFileSync(stateFile, "utf-8"),
					);
					let statusColor = colors.blue;
					if (state.status === "recording") statusColor = colors.red;
					if (state.status === "processing") statusColor = colors.yellow;
					if (state.status === "error") statusColor = colors.red;
					if (state.status === "idle") statusColor = colors.green;

					console.log(
						`${colors.green("✅")} Daemon State: ${statusColor(state.status.toUpperCase())}`,
					);
					if (state.status === "error") {
						console.log(
							`${colors.yellow("⚠️")}  Last Daemon Error: ${colors.red(state.lastError || "Unknown error")}`,
						);
					}
				}
			} catch (_e) {
				console.log(
					`${colors.yellow("⚠️  Daemon PID file exists but process is dead")}`,
				);
			}
		} else {
			console.log(`${colors.blue("ℹ️")}  Daemon is not running`);
		}

		try {
			const isServiceActive = execSync("systemctl --user is-active hyprvox", {
				stdio: "pipe",
			})
				.toString()
				.trim();
			if (isServiceActive === "active") {
				console.log(
					`${colors.yellow("⚠️")}  Legacy systemd service is active — the app now supervises itself; remove it with ${colors.cyan("hyprvox uninstall")}`,
				);
			} else {
				console.log(
					`${colors.blue("ℹ️")}  Legacy systemd service present but ${isServiceActive}`,
				);
			}
		} catch (_e) {
			console.log(
				`${colors.blue("ℹ️")}  No legacy systemd service (expected; app is launched via exec-once)`,
			);
		}

		// 6. Overlay Check
		console.log(`\n${colors.bold("--- Overlay Status ---")}`);

		if (config?.overlay?.enabled === false) {
			console.log(`${colors.blue("ℹ️")}  Overlay is disabled in config`);
		} else {
			// The overlay window is hosted by the app process itself; a live
			// command socket means the app (and therefore the window) is up.
			const socketPath = join(configDir, "daemon.sock");
			if (existsSync(socketPath)) {
				console.log(
					`${colors.green("✅")} App command socket present (overlay window hosted in-process)`,
				);
			} else {
				console.log(
					`${colors.yellow("⚠️")}  Command socket not found (app not running?)`,
				);
			}
		}

		console.log(`\n${colors.cyan("-------------------------")}`);
		if (allOk) {
			console.log(
				`${colors.bold(colors.green("✅ System health check passed!"))}`,
			);
		} else {
			console.log(
				`${colors.bold(colors.red("❌ System health check failed. Please check the issues above."))}`,
			);
		}
		console.log(`${colors.cyan("-------------------------")}\n`);
	});
