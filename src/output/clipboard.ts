import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import clipboardy from "clipboardy";
import { AppError } from "../utils/errors";
import { logError, logger } from "../utils/logger";

export class ClipboardAccessError extends AppError {
	constructor(message: string, context?: Record<string, any>) {
		super("ACCESS_DENIED", message, context);
		this.name = "ClipboardAccessError";
	}
}

export class ClipboardManager {
	private isWayland: boolean;
	private fallbackFile: string;

	constructor() {
		this.isWayland = !!process.env.WAYLAND_DISPLAY;
		const configDir = join(homedir(), ".config", "voice-cli");
		this.fallbackFile = join(configDir, "transcriptions.txt");

		if (!existsSync(configDir)) {
			try {
				mkdirSync(configDir, { recursive: true });
			} catch (_e) {}
		}
	}

	public async append(text: string): Promise<void> {
		try {
			await this.write(text);
			logger.info("Clipboard updated successfully");
		} catch (error) {
			logger.error("Clipboard write failed, falling back to file");
			this.saveToFallbackFile(text);
			throw new ClipboardAccessError("Failed to write to clipboard", {
				error,
			});
		}
	}

	private saveToFallbackFile(text: string): void {
		try {
			const timestamp = new Date().toISOString();
			const content = `[${timestamp}]\n${text}\n---\n`;
			appendFileSync(this.fallbackFile, content, { mode: 0o600 });
			logger.info(`Transcription saved to fallback file: ${this.fallbackFile}`);
		} catch (e) {
			logError("Failed to save to fallback file", e);
		}
	}

	private async write(text: string): Promise<void> {
		if (this.isWayland) {
			try {
				await this.writeWayland(text);
				return;
			} catch (_e) {
				logger.warn("wl-copy failed, falling back to clipboardy");
			}
		}
		await clipboardy.write(text);
	}

	private writeWayland(text: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const child = spawn("wl-copy", ["--type", "text/plain"], {
				stdio: ["pipe", "ignore", "ignore"],
			});

			child.on("error", reject);
			child.on("close", (code: number) => {
				if (code === 0) resolve();
				else
					reject(
						new AppError("APPEND_FAILED", `wl-copy exited with code ${code}`),
					);
			});

			child.stdin.write(text);
			child.stdin.end();
		});
	}
}
