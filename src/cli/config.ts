import { Command } from "commander";
import { loadConfig, DEFAULT_CONFIG_FILE } from "../config/loader";
import { saveConfig } from "../config/writer";
import { ConfigFileSchema } from "../config/schema";
import * as colors from "yoctocolors";
import { existsSync } from "node:fs";
import readlineSync from "readline-sync";

export const configCommand = new Command("config")
  .description("Manage configuration settings")
  .summary("manage config");

configCommand
  .command("init")
  .description("Initialize configuration file")
  .option("-f, --force", "Overwrite existing config file")
  .action((options) => {
    try {
      if (existsSync(DEFAULT_CONFIG_FILE) && !options.force) {
        console.log(colors.yellow(`Config file already exists at ${DEFAULT_CONFIG_FILE}`));
        console.log(`Use ${colors.cyan("--force")} to overwrite.`);
        return;
      }

      console.log(colors.cyan("Initializing voice-cli configuration..."));
      console.log(colors.dim("Follow the prompts to set up your API keys. Press Ctrl+C to cancel at any time.\n"));

      const groqKey = readlineSync.question("Enter Groq API Key (starts with gsk_): ", {
        hideEchoBack: true,
        mask: "*",
        validate: (input: string) => input.startsWith("gsk_") || colors.red("Invalid format: Groq API key must start with 'gsk_'")
      });

      const deepgramKey = readlineSync.question("\nEnter Deepgram API Key (UUID): ", {
        hideEchoBack: true,
        mask: "*",
        validate: (input: string) => /^[a-fA-F0-9-]+$/.test(input) && input.length >= 32 && input.length <= 40 || colors.red("Invalid format: Deepgram API key must be a valid UUID or 40-char hex string")
      });

      console.log("");

      const config = {
        apiKeys: {
          groq: groqKey,
          deepgram: deepgramKey
        }
      };

      saveConfig(config);
      console.log(`${colors.green("✅")} Configuration initialized at ${DEFAULT_CONFIG_FILE}`);
    } catch (error) {
      console.error(colors.red("Failed to initialize config:"), (error as Error).message);
    }
  });

configCommand
  .command("list")
  .description("List all configuration settings")
  .action(() => {
    try {
      const config = loadConfig();
      console.log(colors.bold("\nCurrent Configuration:"));
      console.log(colors.dim("------------------------"));
      
      const maskedConfig = JSON.parse(JSON.stringify(config));
      if (maskedConfig.apiKeys) {
        if (maskedConfig.apiKeys.groq) maskedConfig.apiKeys.groq = "gsk_****" + maskedConfig.apiKeys.groq.slice(-4);
        if (maskedConfig.apiKeys.deepgram) maskedConfig.apiKeys.deepgram = "****" + maskedConfig.apiKeys.deepgram.slice(-4);
      }

      console.log(JSON.stringify(maskedConfig, null, 2));
      console.log(colors.dim("------------------------"));
    } catch (error) {
      console.error(colors.red("Failed to list config:"), (error as Error).message);
    }
  });

configCommand
  .command("get <key>")
  .description("Get a configuration value")
  .action((key: string) => {
    try {
      const config = loadConfig() as any;
      const value = key.split(".").reduce((obj, k) => obj?.[k], config);
      
      if (value === undefined) {
        console.error(colors.red(`Key '${key}' not found in configuration.`));
        return;
      }

      if (key.includes("apiKeys")) {
        console.log("****" + String(value).slice(-4));
      } else if (typeof value === "object") {
        console.log(JSON.stringify(value, null, 2));
      } else {
        console.log(value);
      }
    } catch (error) {
      console.error(colors.red("Failed to get config value:"), (error as Error).message);
    }
  });

configCommand
  .command("set <key> <value>")
  .description("Set a configuration value")
  .action((key: string, value: string) => {
    try {
      const config = loadConfig() as any;
      const keys = key.split(".");
      const lastKey = keys.pop()!;
      
      let target = config;
      for (const k of keys) {
        if (!target[k]) target[k] = {};
        target = target[k];
      }

      // Type conversion
      let typedValue: any = value;
      if (value.toLowerCase() === "true") typedValue = true;
      else if (value.toLowerCase() === "false") typedValue = false;
      else if (!isNaN(Number(value)) && value.trim() !== "") typedValue = Number(value);
      else if (value.startsWith("[") && value.endsWith("]")) {
        try {
          typedValue = JSON.parse(value);
        } catch (e) {
          // Keep as string if not valid JSON
        }
      }

      target[lastKey] = typedValue;

      // Validate and save
      saveConfig(config);
      console.log(`${colors.green("✅")} Set ${colors.cyan(key)} to ${colors.bold(value)}`);
    } catch (error) {
      console.error(colors.red("Failed to set config value:"), (error as Error).message);
    }
  });
