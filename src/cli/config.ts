import { existsSync } from "node:fs";
import { Command } from "commander";
import readlineSync from "readline-sync";
import * as colors from "yoctocolors";
import { DEFAULT_CONFIG_FILE, loadConfig } from "../config/loader";
import { saveConfig } from "../config/writer";

export function normalizeKeyName(key: string): string {
	const map: Record<string, string> = {
		"LEFT CONTROL": "Ctrl",
		"RIGHT CONTROL": "Right Control",
		"LEFT CTRL": "Ctrl",
		"RIGHT CTRL": "Right Control",
		CONTROL: "Ctrl",
		CTRL: "Ctrl",
		"LEFT ALT": "Alt",
		"RIGHT ALT": "Right Alt",
		ALT: "Alt",
		"LEFT SHIFT": "Shift",
		"RIGHT SHIFT": "Right Shift",
		SHIFT: "Shift",
		"LEFT META": "Meta",
		"RIGHT META": "Right Meta",
		"LEFT WIN": "Meta",
		"RIGHT WIN": "Meta",
		META: "Meta",
		WIN: "Meta",
		SPACE: "Space",
		RETURN: "Enter",
		ENTER: "Enter",
		ESCAPE: "Esc",
		BACKSPACE: "Backspace",
		TAB: "Tab",
		DELETE: "Delete",
		INSERT: "Insert",
		INS: "Insert",
		DEL: "Delete",
		"PAGE UP": "Page Up",
		"PAGE DOWN": "Page Down",
		PGUP: "Page Up",
		PGDN: "Page Down",
		HOME: "Home",
		END: "End",
		UP: "Up",
		DOWN: "Down",
		LEFT: "Left",
		RIGHT: "Right",
		"UP ARROW": "Up",
		"DOWN ARROW": "Down",
		"LEFT ARROW": "Left",
		"RIGHT ARROW": "Right",
	};

	const upper = key.toUpperCase();
	if (map[upper]) return map[upper];

	if (/^F\d+$/.test(upper)) return upper;

	if (upper.length === 1) return upper;
	return upper.charAt(0) + upper.slice(1).toLowerCase();
}

export function formatCombination(keys: Set<string>): string {
	const parts: string[] = [];

	const hasCtrl =
		keys.has("LEFT CTRL") ||
		keys.has("RIGHT CTRL") ||
		keys.has("LEFT CONTROL") ||
		keys.has("RIGHT CONTROL") ||
		keys.has("CONTROL");
	const hasAlt =
		keys.has("LEFT ALT") || keys.has("RIGHT ALT") || keys.has("ALT");
	const hasShift =
		keys.has("LEFT SHIFT") || keys.has("RIGHT SHIFT") || keys.has("SHIFT");
	const hasMeta =
		keys.has("LEFT META") ||
		keys.has("RIGHT META") ||
		keys.has("LEFT WIN") ||
		keys.has("RIGHT WIN") ||
		keys.has("META") ||
		keys.has("WIN");

	if (keys.size === 1) {
		const key = Array.from(keys)[0];
		return normalizeKeyName(key || "");
	}

	if (hasCtrl) parts.push("Ctrl");
	if (hasAlt) parts.push("Alt");
	if (hasShift) parts.push("Shift");
	if (hasMeta) parts.push("Meta");

	for (const key of keys) {
		const isMod = [
			"LEFT CTRL",
			"RIGHT CTRL",
			"LEFT CONTROL",
			"RIGHT CONTROL",
			"CONTROL",
			"LEFT ALT",
			"RIGHT ALT",
			"ALT",
			"LEFT SHIFT",
			"RIGHT SHIFT",
			"SHIFT",
			"LEFT META",
			"RIGHT META",
			"LEFT WIN",
			"RIGHT WIN",
			"META",
			"WIN",
		].includes(key);

		if (!isMod) {
			parts.push(normalizeKeyName(key));
		}
	}

	return parts.join("+");
}

async function interactiveBind(): Promise<string | null> {
	const { GlobalKeyboardListener } = await import("node-global-key-listener");
	const listener = new GlobalKeyboardListener();

	return new Promise((resolve) => {
		const pressedKeys = new Set<string>();
		let resolved = false;

		const finish = (result: string | null) => {
			if (resolved) return;
			resolved = true;
			listener.kill();
			resolve(result);
		};

		console.log(
			colors.cyan(
				"\nPress the key combination you want to use (e.g. Ctrl+Space, Right Control)...",
			),
		);
		console.log(
			colors.dim(
				"The first non-modifier key you press will complete the combination.",
			),
		);
		console.log(colors.dim("Press ESC to cancel.\n"));

		listener.addListener((e, downRaw) => {
			const down = downRaw as unknown as Record<string, boolean>;
			const name = e.name?.toUpperCase();
			if (!name) return;

			if (e.state === "DOWN") {
				if (name === "ESCAPE") {
					finish(null);
					return;
				}

				if (
					name === "C" &&
					(down["LEFT CTRL"] || down["RIGHT CTRL"] || down.CONTROL)
				) {
					finish(null);
					process.exit(0);
				}

				pressedKeys.add(name);

				const isModifier = [
					"LEFT CTRL",
					"RIGHT CTRL",
					"LEFT CONTROL",
					"RIGHT CONTROL",
					"CONTROL",
					"LEFT ALT",
					"RIGHT ALT",
					"ALT",
					"LEFT SHIFT",
					"RIGHT SHIFT",
					"SHIFT",
					"LEFT META",
					"RIGHT META",
					"LEFT WIN",
					"RIGHT WIN",
					"META",
					"WIN",
				].includes(name);

				if (!isModifier) {
					const result = formatCombination(pressedKeys);
					finish(result);
				}
			} else if (e.state === "UP") {
				if (pressedKeys.has(name)) {
					if (pressedKeys.size === 1) {
						const result = formatCombination(pressedKeys);
						finish(result);
					}
					pressedKeys.delete(name);
				}
			}
		});
	});
}

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
				console.log(
					colors.yellow(`Config file already exists at ${DEFAULT_CONFIG_FILE}`),
				);
				console.log(`Use ${colors.cyan("--force")} to overwrite.`);
				return;
			}

			console.log(colors.cyan("Initializing hyprvox configuration..."));
			console.log(
				colors.dim(
					"Follow the prompts to set up your API keys. Press Ctrl+C to cancel at any time.\n",
				),
			);

			const groqKey = readlineSync.question(
				"Enter Groq API Key (starts with gsk_): ",
				{
					hideEchoBack: true,
					mask: "*",
					validate: (input: string) =>
						input.startsWith("gsk_") ||
						colors.red("Invalid format: Groq API key must start with 'gsk_'"),
				},
			);

			const deepgramKey = readlineSync.question(
				"\nEnter Deepgram API Key (UUID): ",
				{
					hideEchoBack: true,
					mask: "*",
					validate: (input: string) =>
						(/^[a-fA-F0-9-]+$/.test(input) &&
							input.length >= 32 &&
							input.length <= 40) ||
						colors.red(
							"Invalid format: Deepgram API key must be a valid UUID or 40-char hex string",
						),
				},
			);

			console.log("");

			const config = {
				apiKeys: {
					groq: groqKey,
					deepgram: deepgramKey,
				},
			};

			saveConfig(config);
			console.log(
				`${colors.green("✅")} Configuration initialized at ${DEFAULT_CONFIG_FILE}`,
			);

			console.log(colors.bold("\nNext Steps:"));
			console.log(`  1. Install the systemd service:`);
			console.log(`     ${colors.cyan("bun run index.ts install")}`);
			console.log(`  2. Select your microphone device:`);
			console.log(`     ${colors.cyan("bun run index.ts list-mics")}`);
			console.log(`  3. Configure your hotkey (default: Right Control):`);
			console.log(`     ${colors.cyan("bun run index.ts config bind")}`);
		} catch (error) {
			console.error(
				colors.red("Failed to initialize config:"),
				(error as Error).message,
			);
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
				if (maskedConfig.apiKeys.groq)
					maskedConfig.apiKeys.groq = `gsk_****${String(maskedConfig.apiKeys.groq).slice(-4)}`;
				if (maskedConfig.apiKeys.deepgram)
					maskedConfig.apiKeys.deepgram = `****${String(maskedConfig.apiKeys.deepgram).slice(-4)}`;
			}

			console.log(JSON.stringify(maskedConfig, null, 2));
			console.log(colors.dim("------------------------"));
		} catch (error) {
			console.error(
				colors.red("Failed to list config:"),
				(error as Error).message,
			);
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
				console.log(`****${String(value).slice(-4)}`);
			} else if (typeof value === "object") {
				console.log(JSON.stringify(value, null, 2));
			} else {
				console.log(value);
			}
		} catch (error) {
			console.error(
				colors.red("Failed to get config value:"),
				(error as Error).message,
			);
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
			else if (!Number.isNaN(Number(value)) && value.trim() !== "")
				typedValue = Number(value);
			else if (value.startsWith("[") && value.endsWith("]")) {
				try {
					typedValue = JSON.parse(value);
				} catch (_e) {
					// Keep as string if not valid JSON
				}
			}

			target[lastKey] = typedValue;

			// Validate and save
			saveConfig(config);
			console.log(
				`${colors.green("✅")} Set ${colors.cyan(key)} to ${colors.bold(value)}`,
			);
		} catch (error) {
			console.error(
				colors.red("Failed to set config value:"),
				(error as Error).message,
			);
		}
	});

configCommand
	.command("bind")
	.description("Interactively bind a global hotkey")
	.action(async () => {
		try {
			console.log(colors.cyan("\nInteractively selecting hotkey..."));

			const hotkey = await interactiveBind();

			if (!hotkey) {
				console.log(colors.yellow("Hotkey selection cancelled."));
				return;
			}

			console.log(`\nSelected hotkey: ${colors.bold(colors.green(hotkey))}`);

			const confirm = readlineSync.keyInYN("Do you want to save this hotkey?");

			if (confirm) {
				const config = loadConfig() as any;
				config.behavior.hotkey = hotkey;
				saveConfig(config);
				console.log(
					`${colors.green("✅")} Hotkey updated to ${colors.bold(hotkey)}`,
				);
			} else {
				console.log(colors.yellow("Changes not saved."));
			}
		} catch (error) {
			console.error(
				colors.red("\nFailed to bind hotkey:"),
				(error as Error).message,
			);
			if ((error as Error).message.includes("permissions")) {
				console.log(
					colors.dim(
						"Try running with higher permissions or ensure your user is in the 'input' group.",
					),
				);
			}
		}
	});
