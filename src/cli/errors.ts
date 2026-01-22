import { Command } from "commander";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "../config/loader";
import * as colorette from "colorette";

export const errorsCommand = new Command("errors")
  .description("Display the last error from the logs")
  .option("-n, --number <count>", "Number of errors to show", "1")
  .action((options) => {
    let logDir: string;
    try {
      const config = loadConfig();
      logDir = config.paths.logs;
    } catch (e) {
      const home = homedir();
      logDir = join(home || ".", ".config", "voice-cli", "logs");
    }

    if (!existsSync(logDir)) {
      console.log(colorette.yellow("Log directory does not exist."));
      return;
    }

    try {
      const files = readdirSync(logDir)
        .filter(f => f.startsWith("voice-cli-") && f.endsWith(".log"))
        .sort((a, b) => b.localeCompare(a));

      if (files.length === 0) {
        console.log(colorette.yellow("No log files found."));
        return;
      }

      const count = parseInt(options.number, 10);
      const errorsFound: any[] = [];

      for (const file of files) {
        if (errorsFound.length >= count) break;

        const logPath = join(logDir, file);
        const content = readFileSync(logPath, "utf-8");
        const lines = content.split("\n").filter(line => line.trim() !== "");
        
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const entry = JSON.parse(lines[i]);
            if (entry.level === 50) {
              errorsFound.push({
                file,
                ...entry
              });
              if (errorsFound.length >= count) break;
            }
          } catch (e) {
          }
        }
      }

      if (errorsFound.length === 0) {
        console.log(colorette.green("No errors found in the logs."));
        return;
      }

      console.log(colorette.bold(colorette.red(`Last ${errorsFound.length} error(s):`)));
      errorsFound.forEach((err) => {
        console.log(colorette.gray("------------------------------------------------"));
        console.log(`${colorette.bold("Timestamp:")} ${new Date(err.time).toLocaleString()}`);
        console.log(`${colorette.bold("Message:  ")} ${colorette.red(err.msg)}`);
        if (err.err) {
          console.log(`${colorette.bold("Type:     ")} ${err.err.type}`);
          console.log(`${colorette.bold("Stack:    ")} ${err.err.stack}`);
        } else if (err.error) {
          console.log(`${colorette.bold("Error:    ")} ${JSON.stringify(err.error, null, 2)}`);
        }
        if (err.context) {
          console.log(`${colorette.bold("Context:  ")} ${JSON.stringify(err.context, null, 2)}`);
        }
        console.log(`${colorette.bold("Source:   ")} ${err.file}`);
      });
      console.log(colorette.gray("------------------------------------------------"));

    } catch (error) {
      console.error(colorette.red("Failed to read errors:"), error);
    }
  });
