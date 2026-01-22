import clipboardy from "clipboardy";
import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { logger, logError } from "../utils/logger";
import { loadConfig } from "../config/loader";

export class ClipboardAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClipboardAccessError";
  }
}

const execAsync = promisify(exec);

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
      } catch (e) {
      }
    }
  }

  public async append(text: string): Promise<void> {
    const config = loadConfig();
    const shouldAppend = config.behavior.clipboard.append;

    try {
      let currentContent = "";
      
      try {
        currentContent = await this.read();
      } catch (e) {
        logger.warn("Failed to read clipboard, proceeding with overwrite/first entry");
      }

      const newContent = shouldAppend && currentContent ? `${currentContent}\n${text}` : text;
      
      try {
        await this.write(newContent);
        logger.info("Clipboard updated successfully");
      } catch (error) {
        logger.error("Clipboard write failed, falling back to file");
        this.saveToFallbackFile(text);
        throw new ClipboardAccessError("Failed to write to clipboard");
      }
    } catch (error) {
      logError("Clipboard operation failed", error);
      throw error;
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

  private async read(): Promise<string> {
    if (this.isWayland) {
      try {
        const { stdout } = await execAsync("wl-paste --no-newline --type text/plain");
        return stdout;
      } catch (e) {
        return clipboardy.read();
      }
    }
    return clipboardy.read();
  }

  private async write(text: string): Promise<void> {
    if (this.isWayland) {
      try {
        await this.writeWayland(text);
        return;
      } catch (e) {
        logger.warn("wl-copy failed, falling back to clipboardy");
      }
    }
    await clipboardy.write(text);
  }

  private writeWayland(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn("wl-copy", ["--type", "text/plain"], { stdio: ["pipe", "ignore", "ignore"] });
      
      child.on("error", reject);
      child.on("close", (code: number) => {
        if (code === 0) resolve();
        else reject(new Error(`wl-copy exited with code ${code}`));
      });

      child.stdin.write(text);
      child.stdin.end();
    });
  }
}
