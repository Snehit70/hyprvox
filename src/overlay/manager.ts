import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";

const SOCKET_PATH = "/tmp/voice-cli-overlay.sock";
const OVERLAY_BINARY = path.join(
	__dirname,
	"../../overlay/target/release/voice-overlay",
);

interface AmplitudeMessage {
	amplitude: number;
	recording: boolean;
}

export class OverlayManager {
	private process: ChildProcess | null = null;
	private server: net.Server | null = null;
	private clients: Set<net.Socket> = new Set();
	private isRecording = false;

	async start(): Promise<void> {
		// Check if overlay binary exists
		if (!fs.existsSync(OVERLAY_BINARY)) {
			console.warn("[Overlay] Binary not found, skipping visualization");
			return;
		}

		// Start Unix socket server
		await this.startServer();

		// Spawn overlay process
		this.process = spawn(OVERLAY_BINARY, [SOCKET_PATH], {
			stdio: ["ignore", "pipe", "pipe"],
			detached: false,
		});

		this.process.stdout?.on("data", (data) => {
			console.log(`[Overlay] ${data.toString().trim()}`);
		});

		this.process.stderr?.on("data", (data) => {
			console.error(`[Overlay] ${data.toString().trim()}`);
		});

		this.process.on("error", (err) => {
			console.error("[Overlay] Failed to spawn:", err.message);
		});

		this.process.on("exit", (code, signal) => {
			console.log(`[Overlay] Exited (code: ${code}, signal: ${signal})`);
			this.process = null;
		});

		console.log("[Overlay] Started");
	}

	private async startServer(): Promise<void> {
		return new Promise((resolve, reject) => {
			// Clean up stale socket
			if (fs.existsSync(SOCKET_PATH)) {
				fs.unlinkSync(SOCKET_PATH);
			}

			this.server = net.createServer((socket) => this.handleClient(socket));

			this.server.listen(SOCKET_PATH, () => {
				console.log(`[Overlay] IPC server listening on ${SOCKET_PATH}`);
				resolve();
			});

			this.server.on("error", reject);
		});
	}

	private handleClient(socket: net.Socket): void {
		this.clients.add(socket);
		console.log(`[Overlay] Client connected (total: ${this.clients.size})`);

		socket.on("error", (err) => {
			console.error(`[Overlay] Socket error:`, err.message);
			this.clients.delete(socket);
		});

		socket.on("close", () => {
			console.log(
				`[Overlay] Client disconnected (total: ${this.clients.size - 1})`,
			);
			this.clients.delete(socket);
		});
	}

	sendAmplitude(amplitude: number): void {
		if (this.clients.size === 0) {
			return;
		}

		const message: AmplitudeMessage = {
			amplitude,
			recording: this.isRecording,
		};

		const data = JSON.stringify(message) + "\n";

		for (const client of this.clients) {
			if (!client.destroyed) {
				client.write(data, (err) => {
					if (err) {
						console.error(`[Overlay] Write error:`, err.message);
						this.clients.delete(client);
					}
				});
			}
		}
	}

	setRecording(recording: boolean): void {
		this.isRecording = recording;
	}

	async stop(): Promise<void> {
		console.log("[Overlay] Stopping...");

		// Close all client connections
		for (const client of this.clients) {
			client.destroy();
		}
		this.clients.clear();

		// Close server
		if (this.server) {
			await new Promise<void>((resolve) => {
				this.server!.close(() => {
					if (fs.existsSync(SOCKET_PATH)) {
						fs.unlinkSync(SOCKET_PATH);
					}
					resolve();
				});
			});
			this.server = null;
		}

		// Kill overlay process
		if (this.process && !this.process.killed) {
			this.process.kill("SIGTERM");

			// Wait for process to exit (with timeout)
			await new Promise<void>((resolve) => {
				const timeout = setTimeout(() => {
					if (this.process && !this.process.killed) {
						this.process.kill("SIGKILL");
					}
					resolve();
				}, 2000);

				this.process!.once("exit", () => {
					clearTimeout(timeout);
					resolve();
				});
			});

			this.process = null;
		}

		console.log("[Overlay] Stopped");
	}
}
