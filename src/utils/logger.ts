import pino from "pino";
import { join } from "node:path";
import { existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { loadConfig } from "../config/loader";

let logDir: string;
try {
  const config = loadConfig();
  logDir = config.paths.logs;
} catch (e) {
  logDir = join(process.env.HOME || ".", ".config", "voice-cli", "logs");
}

if (!existsSync(logDir)) {
  try {
    mkdirSync(logDir, { recursive: true, mode: 0o700 });
  } catch (e) {
    console.error(`Failed to create log directory: ${logDir}`, e);
  }
}

const rotateLogs = (dir: string) => {
  try {
    if (!existsSync(dir)) return;
    const files = readdirSync(dir);
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (file.startsWith("voice-cli-") && file.endsWith(".log")) {
        const filePath = join(dir, file);
        try {
          const stats = statSync(filePath);
          if (now - stats.mtimeMs > sevenDaysMs) {
            unlinkSync(filePath);
          }
        } catch (e) {
        }
      }
    }
  } catch (e) {
  }
};

const getLogFile = () => {
  const dateStr = new Date().toISOString().split("T")[0];
  return join(logDir, `voice-cli-${dateStr}.log`);
};

const logFile = getLogFile();
rotateLogs(logDir);

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: {
    pid: process.pid,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  transport: {
    targets: [
      {
        target: "pino/file",
        options: { destination: logFile, mkdir: true },
      },
      {
        target: "pino-pretty",
        options: { destination: 1, colorize: true },
      },
    ],
  },
});

export const logError = (msg: string, error?: unknown, context?: Record<string, any>) => {
  const errorObj = error instanceof Error ? error : new Error(String(error || "Unknown error"));
  logger.error({ err: errorObj, ...context }, msg);
};
