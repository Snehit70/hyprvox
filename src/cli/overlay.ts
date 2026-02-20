import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import * as colors from "yoctocolors";
import { loadConfig } from "../config/loader";

const configDir = join(homedir(), ".config", "voice-cli");
const overlayPidFile = join(configDir, "overlay.pid");

function getDefaultOverlayPath(): string {
	return join(process.cwd(), "overlay");
}

function getOverlayBinaryPath(): string {
	const config = loadConfig();
	if (config.overlay?.binaryPath) {
		return config.overlay.binaryPath;
	}
	return getDefaultOverlayPath();
}

function isOverlayRunning(): { running: boolean; pid?: number } {
	if (!existsSync(overlayPidFile)) {
		return { running: false };
	}

	try {
		const pid = parseInt(readFileSync(overlayPidFile, "utf-8").trim(), 10);
		process.kill(pid, 0);
		return { running: true, pid };
	} catch {
		try {
			unlinkSync(overlayPidFile);
		} catch {
			// File may have been deleted concurrently
		}
		return { running: false };
	}
}

function startOverlay(): void {
	const { running, pid } = isOverlayRunning();
	if (running) {
		console.log(
			`${colors.yellow("Overlay is already running")} (${colors.dim(`PID: ${pid}`)})`,
		);
		return;
	}

	const overlayPath = getOverlayBinaryPath();

	if (!existsSync(overlayPath)) {
		console.error(
			`${colors.red("Error:")} Overlay not found at ${colors.dim(overlayPath)}`,
		);
		console.log(
			`Build it first: ${colors.cyan(`cd ${overlayPath} && bun install && bun run build`)}`,
		);
		process.exit(1);
	}

	console.log(`${colors.cyan("Starting overlay...")}`);

	const child = spawn("bun", ["run", "start"], {
		cwd: overlayPath,
		detached: true,
		stdio: "ignore",
	});

	child.unref();

	if (!child.pid) {
		console.error(
			`${colors.red("Error:")} Overlay spawned but no PID was assigned`,
		);
		return;
	}

	writeFileSync(overlayPidFile, child.pid.toString());

	console.log(
		`${colors.green("✅")} Overlay started (${colors.dim(`PID: ${child.pid}`)})`,
	);
}

function stopOverlay(): void {
	const { running, pid } = isOverlayRunning();
	if (!running) {
		console.log(`${colors.yellow("Overlay is not running")}`);
		return;
	}

	try {
		process.kill(pid!, "SIGTERM");
	} catch (error) {
		console.error(`${colors.red("Error:")} Failed to stop overlay:`, error);
		return;
	}

	console.log(
		`${colors.green("✅")} Stopped overlay (${colors.dim(`PID: ${pid}`)})`,
	);
	try {
		unlinkSync(overlayPidFile);
	} catch {
		// PID file may have already been removed
	}
}

function waitForProcessExit(pid: number, timeoutMs = 3000): Promise<void> {
	return new Promise((resolve) => {
		const start = Date.now();
		const interval = setInterval(() => {
			try {
				process.kill(pid, 0);
			} catch {
				clearInterval(interval);
				resolve();
				return;
			}
			if (Date.now() - start >= timeoutMs) {
				clearInterval(interval);
				resolve();
			}
		}, 50);
	});
}

async function restartOverlay(): Promise<void> {
	const { pid } = isOverlayRunning();
	stopOverlay();
	if (pid) {
		await waitForProcessExit(pid);
	}
	startOverlay();
}

function statusOverlay(): void {
	const config = loadConfig();
	const { running, pid } = isOverlayRunning();

	console.log(
		`${colors.dim("Status:")} ${running ? colors.green("Running") : colors.red("Stopped")}`,
	);

	if (running && pid) {
		console.log(`${colors.dim("PID:")}    ${pid}`);
	}

	console.log(
		`${colors.dim("Enabled:")} ${config.overlay?.enabled ? colors.green("true") : colors.red("false")}`,
	);
	console.log(
		`${colors.dim("Auto-start:")} ${config.overlay?.autoStart ? colors.green("true") : colors.red("false")}`,
	);
	console.log(`${colors.dim("Path:")}   ${colors.dim(getOverlayBinaryPath())}`);

	const socketPath = join(configDir, "daemon.sock");
	if (existsSync(socketPath)) {
		console.log(`${colors.dim("IPC:")}    ${colors.green("Socket available")}`);
	} else {
		console.log(
			`${colors.dim("IPC:")}    ${colors.yellow("Socket not found (daemon not running?)")}`,
		);
	}
}

export const overlayCommand = new Command("overlay")
	.description("Manage the waveform overlay")
	.action(() => {
		statusOverlay();
	});

overlayCommand
	.command("start")
	.description("Start the overlay")
	.action(() => {
		startOverlay();
	});

overlayCommand
	.command("stop")
	.description("Stop the overlay")
	.action(() => {
		stopOverlay();
	});

overlayCommand
	.command("restart")
	.description("Restart the overlay")
	.action(() => {
		restartOverlay();
	});
