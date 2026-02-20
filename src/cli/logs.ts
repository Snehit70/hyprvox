import { createReadStream, existsSync, statSync } from "node:fs";
import { watch } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Command } from "commander";
import * as colors from "yoctocolors";
import { loadConfig } from "../config/loader";
import { isErrorWithName } from "../utils/errors";

function formatLogLine(line: string): string {
	try {
		const log = JSON.parse(line);
		const time = log.time
			? new Date(log.time).toLocaleTimeString()
			: new Date().toLocaleTimeString();
		const level = log.level;
		const msg = log.msg || "";

		let levelStr = "[INFO]";
		let levelColor = colors.blue;

		if (level === 50) {
			levelStr = "[ERROR]";
			levelColor = colors.red;
		} else if (level === 40) {
			levelStr = "[WARN]";
			levelColor = colors.yellow;
		} else if (level === 30) {
			levelStr = "[INFO]";
			levelColor = colors.blue;
		} else if (level === 20) {
			levelStr = "[DEBUG]";
			levelColor = colors.magenta;
		}

		const context = { ...log };
		delete context.time;
		delete context.level;
		delete context.msg;
		delete context.pid;
		delete context.hostname;

		let output = `${colors.dim(time)} ${levelColor(levelStr)} ${msg}`;

		if (Object.keys(context).length > 0) {
			output += ` ${colors.dim(JSON.stringify(context))}`;
		}

		return output;
	} catch (_e) {
		return line;
	}
}

async function tailFile(filePath: string, lines: number) {
	if (!existsSync(filePath)) {
		console.error(colors.red(`Log file not found: ${filePath}`));
		return;
	}

	const rl = createInterface({
		input: createReadStream(filePath),
		crlfDelay: Infinity,
	});

	const buffer: string[] = [];
	for await (const line of rl) {
		buffer.push(line);
		if (buffer.length > lines) buffer.shift();
	}

	buffer.forEach((line) => console.log(formatLogLine(line)));

	let currentSize = statSync(filePath).size;

	try {
		const watcher = watch(filePath);
		for await (const event of watcher) {
			if (event.eventType === "change") {
				const stats = statSync(filePath);
				if (stats.size < currentSize) {
					currentSize = 0;
					console.log(colors.yellow("--- Log file rotated ---"));
				}

				if (stats.size > currentSize) {
					const stream = createReadStream(filePath, {
						start: currentSize,
						end: stats.size,
					});
					const newRl = createInterface({ input: stream });
					for await (const line of newRl) {
						console.log(formatLogLine(line));
					}
					currentSize = stats.size;
				}
			}
		}
	} catch (err) {
		if (isErrorWithName(err, "AbortError")) return;
		throw err;
	}
}

export const logsCommand = new Command("logs")
	.description("Tail recent logs")
	.option("-f, --follow", "Follow log output", false)
	.option("-n, --number <lines>", "Number of lines to show", "20")
	.action(async (options) => {
		let logDir: string;
		try {
			const config = loadConfig();
			logDir = config.paths.logs;
		} catch (_e) {
			logDir = join(homedir(), ".config", "hypr", "vox", "logs");
		}

		const dateStr = new Date().toISOString().split("T")[0];
		const logFile = join(logDir, `hyprvox-${dateStr}.log`);

		if (!existsSync(logFile)) {
			console.log(colors.yellow(`No logs found for today (${dateStr}).`));
			console.log(colors.dim(`Checked: ${logFile}`));
			return;
		}

		const lineCount = parseInt(options.number, 10);

		if (options.follow) {
			await tailFile(logFile, lineCount);
		} else {
			const rl = createInterface({
				input: createReadStream(logFile),
				crlfDelay: Infinity,
			});

			const buffer: string[] = [];
			for await (const line of rl) {
				buffer.push(line);
				if (buffer.length > lineCount) buffer.shift();
			}
			buffer.forEach((line) => console.log(formatLogLine(line)));
		}
	});
