import { EventEmitter } from "node:events";
import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	ConnectionStatus,
	DaemonState,
	IPCMessage,
} from "./shared/ipc-types";

const SOCKET_PATH = join(homedir(), ".config", "hypr", "vox", "daemon.sock");
const INITIAL_RECONNECT_DELAY = 100;
const MAX_RECONNECT_DELAY = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;

export type {
	ConnectionStatus,
	DaemonState,
	DaemonStatus,
	IPCMessage,
} from "./shared/ipc-types";

export class IPCClient extends EventEmitter {
	private socket: Socket | null = null;
	private buffer = "";
	private reconnectDelay = INITIAL_RECONNECT_DELAY;
	private reconnectAttempts = 0;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private connectionStatus: ConnectionStatus = "disconnected";
	private currentState: DaemonState = { status: "idle" };
	private _protocolVersion = 0;
	private shouldReconnect = true;

	get state(): DaemonState {
		return this.currentState;
	}

	get status(): ConnectionStatus {
		return this.connectionStatus;
	}

	get protocolVersion(): number {
		return this._protocolVersion;
	}

	connect(): void {
		if (this.socket) {
			return;
		}

		this.shouldReconnect = true;
		this.setConnectionStatus("connecting");
		this.attemptConnection();
	}

	disconnect(): void {
		this.shouldReconnect = false;
		this.clearReconnectTimer();
		if (this.socket) {
			this.socket.destroy();
			this.socket = null;
		}
		this.setConnectionStatus("disconnected");
	}

	private attemptConnection(): void {
		this.socket = createConnection({ path: SOCKET_PATH });

		this.socket.on("connect", () => {
			this.reconnectDelay = INITIAL_RECONNECT_DELAY;
			this.reconnectAttempts = 0;
			this.setConnectionStatus("connected");
			this.emit("connected");
		});

		this.socket.on("data", (chunk) => {
			this.handleData(chunk);
		});

		this.socket.on("close", () => {
			this.socket = null;
			this.setConnectionStatus("disconnected");
			this.emit("disconnected");
			this.scheduleReconnect();
		});

		this.socket.on("error", (err: NodeJS.ErrnoException) => {
			if (err.code === "ECONNREFUSED" || err.code === "ENOENT") {
				this.emit("daemonUnavailable");
			} else {
				// Only emit error if there's a listener, otherwise log it
				// This prevents unhandled error crashes
				if (this.listenerCount("error") > 0) {
					this.emit("error", err);
				} else {
					console.error("[IPCClient] Unhandled socket error:", err.message);
				}
			}
		});
	}

	private handleData(chunk: Buffer): void {
		this.buffer += chunk.toString();
		const lines = this.buffer.split("\n");
		this.buffer = lines.pop() || "";

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const msg: IPCMessage = JSON.parse(line);
				this.handleMessage(msg);
			} catch {
				// Malformed JSON - skip
			}
		}
	}

	private handleMessage(msg: IPCMessage): void {
		const receivedAt = Date.now();
		const latency = msg.timestamp ? receivedAt - msg.timestamp : null;

		if (latency !== null && process.env.HYPRVOX_DEBUG_TIMING) {
			console.log(`[TIMING] IPC ${msg.type} received, latency=${latency}ms`);
		}

		if (msg.type === "hello") {
			this._protocolVersion = msg.version || 1;
			if (msg.status) {
				this.updateState({
					status: msg.status,
					timestamp: msg.timestamp,
				});
			}
			this.emit("hello", msg);
		} else if (msg.type === "state") {
			this.updateState({
				status: msg.status || "idle",
				lastTranscription: msg.lastTranscription,
				error: msg.error,
				timestamp: msg.timestamp,
			});
		}
	}

	private updateState(state: DaemonState): void {
		const oldStatus = this.currentState.status;
		this.currentState = state;
		this.emit("stateChange", state);
		if (oldStatus !== state.status) {
			this.emit("statusChange", state.status, oldStatus);
		}
	}

	private setConnectionStatus(status: ConnectionStatus): void {
		if (this.connectionStatus !== status) {
			this.connectionStatus = status;
			this.emit("connectionStatusChange", status);
		}
	}

	private scheduleReconnect(): void {
		if (!this.shouldReconnect) {
			return;
		}

		this.reconnectAttempts++;
		if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
			this.emit("maxReconnectAttemptsReached");
			return;
		}

		this.clearReconnectTimer();
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.setConnectionStatus("connecting");
			this.attemptConnection();
		}, this.reconnectDelay);

		this.reconnectDelay = Math.min(
			this.reconnectDelay * 2,
			MAX_RECONNECT_DELAY,
		);
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}
}

let clientInstance: IPCClient | null = null;

export function getIPCClient(): IPCClient {
	if (!clientInstance) {
		clientInstance = new IPCClient();
	}
	return clientInstance;
}
