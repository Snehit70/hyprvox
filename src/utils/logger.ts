import {
	existsSync,
	mkdirSync,
	readdirSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { join } from "node:path";
import pino from "pino";
import { createStream } from "rotating-file-stream";
import { loadConfig } from "../config/loader";

let logDir: string;
try {
	const config = loadConfig();
	logDir = config.paths.logs;
} catch (_e) {
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
				} catch (_e) {}
			}
		}
	} catch (_e) {}
};

rotateLogs(logDir);

const rotatingStream = createStream(
	(time) => {
		const date = time ? new Date(time) : new Date();
		const dateStr = date.toISOString().split("T")[0];
		return `voice-cli-${dateStr}.log`;
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
	context?: Record<string, any>,
) => {
	const errorObj =
		error instanceof Error
			? error
			: new Error(String(error || "Unknown error"));
	logger.error({ err: errorObj, ...context }, msg);
};
