import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import * as colors from "yoctocolors";
import { loadConfig } from "../config/loader";

export const errorsCommand = new Command("errors")
	.description("Display the last error from the logs")
	.option("-n, --number <count>", "Number of errors to show", "1")
	.action((options) => {
		let logDir: string;
		try {
			const config = loadConfig();
			logDir = config.paths.logs;
		} catch (_e) {
			const home = homedir();
			logDir = join(home || ".", ".config", "hypr", "vox", "logs");
		}

		if (!existsSync(logDir)) {
			console.log(colors.yellow("Log directory does not exist."));
			return;
		}

		try {
			const files = readdirSync(logDir)
				.filter((f) => f.startsWith("hyprvox-") && f.endsWith(".log"))
				.sort((a, b) => b.localeCompare(a));

			if (files.length === 0) {
				console.log(colors.yellow("No log files found."));
				return;
			}

			const count = parseInt(options.number, 10);
			const errorsFound: any[] = [];

			for (const file of files) {
				if (errorsFound.length >= count) break;

				const logPath = join(logDir, file);
				const content = readFileSync(logPath, "utf-8");
				const lines = content.split("\n").filter((line) => line.trim() !== "");

				for (let i = lines.length - 1; i >= 0; i--) {
					const line = lines[i];
					if (!line) continue;
					try {
						const entry = JSON.parse(line);
						if (entry.level === 50) {
							errorsFound.push({
								file,
								...entry,
							});
							if (errorsFound.length >= count) break;
						}
					} catch (_e) {}
				}
			}

			if (errorsFound.length === 0) {
				console.log(colors.green("No errors found in the logs."));
				return;
			}

			console.log(
				colors.bold(colors.red(`Last ${errorsFound.length} error(s):`)),
			);
			errorsFound.forEach((err) => {
				console.log(
					colors.dim("------------------------------------------------"),
				);
				console.log(
					`${colors.bold("Timestamp:")} ${new Date(err.time).toLocaleString()}`,
				);
				console.log(`${colors.bold("Message:  ")} ${colors.red(err.msg)}`);
				if (err.err) {
					console.log(`${colors.bold("Type:     ")} ${err.err.type}`);
					console.log(
						`${colors.bold("Stack:    ")} ${colors.dim(err.err.stack)}`,
					);
				} else if (err.error) {
					console.log(
						`${colors.bold("Error:    ")} ${colors.dim(JSON.stringify(err.error, null, 2))}`,
					);
				}
				if (err.context) {
					console.log(
						`${colors.bold("Context:  ")} ${colors.dim(JSON.stringify(err.context, null, 2))}`,
					);
				}
				console.log(`${colors.bold("Source:   ")} ${colors.dim(err.file)}`);
			});
			console.log(
				colors.dim("------------------------------------------------"),
			);
		} catch (error) {
			console.error(colors.red("Failed to read errors:"), error);
		}
	});
