import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { notify } from "../output/notification";
import { readJsonFile } from "../utils/file-ops";
import { logger } from "../utils/logger";

interface DaemonState {
	status: string;
	lastError?: string;
	[key: string]: unknown;
}

export class DaemonSupervisor {
	private restartCount = 0;
	private firstRestartTime = 0;
	private readonly MAX_RESTARTS = 3;
	private readonly WINDOW_MS = 5 * 60 * 1000;
	private isStopping = false;

	constructor(private scriptPath: string) {}

	public start() {
		this.spawnDaemon();
	}

	public stop() {
		this.isStopping = true;
	}

	private spawnDaemon() {
		if (this.isStopping) return;

		logger.info("Supervisor: Spawning daemon process...");

		const child = spawn(
			"bun",
			["run", this.scriptPath, "start", "--daemon-worker"],
			{
				stdio: "inherit",
				env: { ...process.env, VOICE_CLI_DAEMON_WORKER: "true" },
			},
		);

		child.on("exit", (code, signal) => {
			if (this.isStopping || code === 0) {
				logger.info(
					`Supervisor: Daemon exited cleanly (code: ${code}, signal: ${signal})`,
				);
				return;
			}

			logger.error(
				`Supervisor: Daemon crashed (code: ${code}, signal: ${signal})`,
			);
			this.handleCrash();
		});
	}

	private handleCrash() {
		const now = Date.now();

		if (now - this.firstRestartTime > this.WINDOW_MS) {
			this.restartCount = 1;
			this.firstRestartTime = now;
		} else {
			this.restartCount++;
		}

		if (this.restartCount > this.MAX_RESTARTS) {
			this.handleFatalCrash();
			return;
		}

		logger.warn(
			`Supervisor: Restarting daemon (${this.restartCount}/${this.MAX_RESTARTS})...`,
		);
		setTimeout(() => this.spawnDaemon(), 1000);
	}

	private async handleFatalCrash() {
		const msg = `Daemon crashed ${this.MAX_RESTARTS} times in 5 minutes. Stopping.`;
		logger.error(msg);

		const configDir = join(homedir(), ".config", "voice-cli");
		const stateFile = join(configDir, "daemon.state");
		const pidFile = join(configDir, "daemon.pid");

		if (existsSync(stateFile)) {
			try {
				const state = await readJsonFile<DaemonState>(stateFile);
				if (state) {
					state.status = "error";
					state.lastError = msg;
					await writeFile(stateFile, JSON.stringify(state, null, 2));
				}
			} catch (e) {
				logger.error({ error: e }, "Failed to write crash state");
			}
		}

		if (existsSync(pidFile)) {
			try {
				await unlink(pidFile);
			} catch (e) {
				// PID file may already be deleted
				logger.debug(
					{ err: e },
					"Failed to remove PID file during fatal crash handling",
				);
			}
		}

		notify("Daemon Critical Failure", msg, "error");
		process.exit(1);
	}
}
