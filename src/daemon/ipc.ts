import { EventEmitter } from "node:events";
import { existsSync, unlinkSync } from "node:fs";
import {
	createConnection,
	createServer,
	type Server,
	type Socket,
} from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DaemonStatus, IPCMessage } from "../shared/ipc-types";
import { logger } from "../utils/logger";

const IPC_PROTOCOL_VERSION = 1;
export const SOCKET_PATH = join(
	homedir(),
	".config",
	"hypr",
	"vox",
	"daemon.sock",
);

export type { DaemonStatus, IPCMessage } from "../shared/ipc-types";

export interface IPCServerEvents {
	clientConnected: (clientId: number) => void;
	clientDisconnected: (clientId: number) => void;
	error: (error: Error) => void;
}

export class IPCServer extends EventEmitter {
	private server: Server | null = null;
	private clients: Map<number, Socket> = new Map();
	private clientIdCounter = 0;
	private currentState: IPCMessage | null = null;

	get socketPath(): string {
		return SOCKET_PATH;
	}

	get clientCount(): number {
		return this.clients.size;
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

			testClient.on("error", (err: NodeJS.ErrnoException) => {
				clearTimeout(timeout);
				testClient.destroy();
				if (err.code === "ECONNREFUSED" || err.code === "ENOENT") {
					this.cleanupSocketFile();
					resolve(true);
				} else {
					this.cleanupSocketFile();
					resolve(true);
				}
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
			throw new Error("Another daemon instance is already running");
		}

		return new Promise((resolve, reject) => {
			this.server = createServer((socket) => {
				this.handleClientConnection(socket);
			});

			this.server.on("error", (err: NodeJS.ErrnoException) => {
				if (err.code === "EADDRINUSE") {
					reject(new Error("Socket address already in use"));
				} else {
					this.emit("error", err);
					reject(err);
				}
			});

			this.server.listen(SOCKET_PATH, () => {
				logger.info({ path: SOCKET_PATH }, "IPC server started");
				resolve();
			});
		});
	}

	async stop(): Promise<void> {
		for (const [clientId, socket] of this.clients) {
			socket.destroy();
			logger.debug({ clientId }, "Closed client connection");
		}
		this.clients.clear();

		if (this.server) {
			return new Promise((resolve) => {
				this.server!.close(() => {
					this.cleanupSocketFile();
					logger.info("IPC server stopped");
					this.server = null;
					resolve();
				});
			});
		}
	}

	private handleClientConnection(socket: Socket): void {
		const clientId = ++this.clientIdCounter;
		this.clients.set(clientId, socket);

		logger.debug({ clientId }, "IPC client connected");
		this.emit("clientConnected", clientId);

		const helloMessage: IPCMessage = {
			type: "hello",
			version: IPC_PROTOCOL_VERSION,
			status: this.currentState?.status || "idle",
			timestamp: Date.now(),
		};
		this.sendToClient(clientId, helloMessage);

		socket.on("data", (data) => {
			try {
				const lines = data
					.toString()
					.split("\n")
					.filter((l) => l.trim());
				for (const line of lines) {
					const msg = JSON.parse(line);
					logger.debug({ clientId, msg }, "Received message from client");
				}
			} catch {
				// Malformed JSON - ignore
			}
		});

		socket.on("close", () => {
			this.clients.delete(clientId);
			logger.debug({ clientId }, "IPC client disconnected");
			this.emit("clientDisconnected", clientId);
		});

		socket.on("error", (err) => {
			logger.warn({ clientId, err }, "IPC client error");
			this.clients.delete(clientId);
		});
	}

	private sendToClient(clientId: number, message: IPCMessage): boolean {
		const socket = this.clients.get(clientId);
		if (!socket || socket.destroyed) {
			this.clients.delete(clientId);
			return false;
		}

		try {
			socket.write(JSON.stringify(message) + "\n");
			return true;
		} catch (err) {
			logger.warn({ clientId, err }, "Failed to send message to client");
			this.clients.delete(clientId);
			return false;
		}
	}

	broadcast(message: IPCMessage): void {
		this.currentState = message;

		const stateMessage: IPCMessage = {
			type: "state",
			status: message.status,
			timestamp: message.timestamp,
			lastTranscription: message.lastTranscription,
			error: message.error,
		};

		let successCount = 0;
		for (const clientId of this.clients.keys()) {
			if (this.sendToClient(clientId, stateMessage)) {
				successCount++;
			}
		}

		if (this.clients.size > 0) {
			logger.debug(
				{ status: message.status, clients: successCount },
				"Broadcast state to clients",
			);
		}
	}

	broadcastStatus(
		status: DaemonStatus,
		extra?: { lastTranscription?: string; error?: string; timestamp?: number },
	): void {
		const timestamp = extra?.timestamp ?? Date.now();
		this.broadcast({
			type: "state",
			status,
			timestamp,
			lastTranscription: extra?.lastTranscription,
			error: extra?.error,
		});
		logger.debug(
			{ status, timestamp, clients: this.clients.size },
			"State broadcast",
		);
	}
}

let ipcServerInstance: IPCServer | null = null;

export function getIPCServer(): IPCServer {
	if (!ipcServerInstance) {
		ipcServerInstance = new IPCServer();
	}
	return ipcServerInstance;
}

export function resetIPCServer(): void {
	ipcServerInstance = null;
}
