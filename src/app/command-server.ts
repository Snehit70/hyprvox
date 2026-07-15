import { existsSync, unlinkSync } from "node:fs";
import {
	createConnection,
	createServer,
	type Server,
	type Socket,
} from "node:net";
import { logger } from "../utils/logger";
import { SOCKET_PATH } from "../utils/socket-path";

// The overlay no longer talks over this socket — daemon state reaches the
// renderer via webContents.send. What remains is a command channel for CLI
// verbs that need a payload (SIGUSR1 carries none): today only soniox-toggle.
// Binding the socket also doubles as the single-instance guard, and its
// existence is how `hyprvox soniox-toggle` decides whether the app is up.
export class CommandServer {
	private server: Server | null = null;

	constructor(private readonly onAction: (action: string) => void) {}

	get socketPath(): string {
		return SOCKET_PATH;
	}

	private async checkAndCleanStaleSocket(): Promise<boolean> {
		if (!existsSync(SOCKET_PATH)) {
			return false;
		}

		return new Promise((resolve) => {
			const testClient = createConnection({ path: SOCKET_PATH });
			const timeout = setTimeout(() => {
				testClient.destroy();
				this.cleanupSocketFile();
				resolve(true);
			}, 1000);

			testClient.on("connect", () => {
				clearTimeout(timeout);
				testClient.destroy();
				resolve(false);
			});

			testClient.on("error", () => {
				clearTimeout(timeout);
				testClient.destroy();
				this.cleanupSocketFile();
				resolve(true);
			});
		});
	}

	private cleanupSocketFile(): void {
		try {
			if (existsSync(SOCKET_PATH)) {
				unlinkSync(SOCKET_PATH);
				logger.debug({ path: SOCKET_PATH }, "Cleaned up stale socket file");
			}
		} catch (err) {
			logger.warn({ err, path: SOCKET_PATH }, "Failed to cleanup socket file");
		}
	}

	async start(): Promise<void> {
		const wasStale = await this.checkAndCleanStaleSocket();

		if (existsSync(SOCKET_PATH) && !wasStale) {
			throw new Error("Another hyprvox instance is already running");
		}

		return new Promise((resolve, reject) => {
			this.server = createServer((socket) => {
				this.handleConnection(socket);
			});

			this.server.on("error", (err: NodeJS.ErrnoException) => {
				if (err.code === "EADDRINUSE") {
					reject(new Error("Socket address already in use"));
				} else {
					logger.warn({ err }, "Command socket error");
					reject(err);
				}
			});

			this.server.listen(SOCKET_PATH, () => {
				logger.info({ path: SOCKET_PATH }, "Command socket listening");
				resolve();
			});
		});
	}

	async stop(): Promise<void> {
		if (!this.server) {
			return;
		}
		return new Promise((resolve) => {
			this.server!.close(() => {
				this.cleanupSocketFile();
				logger.info("Command socket stopped");
				this.server = null;
				resolve();
			});
		});
	}

	private handleConnection(socket: Socket): void {
		socket.on("data", (data) => {
			const lines = data
				.toString()
				.split("\n")
				.filter((line) => line.trim());
			for (const line of lines) {
				try {
					const msg = JSON.parse(line);
					if (msg.type === "action" && typeof msg.action === "string") {
						logger.debug({ action: msg.action }, "Command received");
						this.onAction(msg.action);
					}
				} catch {
					// Malformed JSON - ignore
				}
			}
		});

		socket.on("error", (err) => {
			logger.debug({ err }, "Command socket client error");
		});
	}
}
