import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import pino from "pino";
import { createStream } from "rotating-file-stream";
import { loadConfig } from "../config/loader";

let logDir: string;
try {
	const config = loadConfig();
	logDir = config.paths.logs;
} catch {
	logDir = join(process.env.HOME || ".", ".config", "hypr", "vox", "logs");
}

if (!existsSync(logDir)) {
	mkdirSync(logDir, { recursive: true, mode: 0o700 });
}

const rotateLogs = async (dir: string) => {
	try {
		if (!existsSync(dir)) return;
		const files = readdirSync(dir);
		const now = Date.now();
		const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

		for (const file of files) {
			if (file.startsWith("hyprvox-") && file.endsWith(".log")) {
				const filePath = join(dir, file);
				try {
					const stats = statSync(filePath);
					if (now - stats.mtimeMs > thirtyDaysMs) {
						await unlink(filePath);
					}
				} catch (e) {
					// Non-critical: file may have been deleted or permissions issue
					console.debug(`Failed to process log file ${filePath}:`, e);
				}
			}
		}
	} catch (e) {
		// Non-critical: log rotation is best-effort
		console.debug("Log rotation failed:", e);
	}
};

rotateLogs(logDir).catch((e) => {
	// Non-critical: log rotation failure shouldn't block logger creation
	console.debug("Log rotation failed:", e);
});

const rotatingStream = createStream(
	(time) => {
		const date = time ? new Date(time) : new Date();
		const dateStr = date.toISOString().split("T")[0];
		return `hyprvox-${dateStr}.log`;
	},
	{
		interval: "1d",
		path: logDir,
	},
);

const streams = [{ stream: rotatingStream }, { stream: pino.destination(1) }];

export const logger = pino(
	{
		level: process.env.LOG_LEVEL || "info",
		base: {
			pid: process.pid,
		},
		timestamp: pino.stdTimeFunctions.isoTime,
		serializers: {
			err: pino.stdSerializers.err,
			error: pino.stdSerializers.err,
		},
	},
	pino.multistream(streams),
);

export const logError = (
	msg: string,
	error?: unknown,
	context?: Record<string, unknown>,
) => {
	const errorObj =
		error instanceof Error
			? error
			: new Error(String(error || "Unknown error"));
	logger.error({ err: errorObj, ...context }, msg);
};
