import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { Command } from "commander";
import readlineSync from "readline-sync";
import * as colors from "yoctocolors";
import { AudioDeviceService } from "../audio/device-service";
import { DEFAULT_CONFIG_FILE, loadConfig } from "../config/loader";
import type { ConfigFile } from "../config/schema";
import { saveConfig } from "../config/writer";
import {
	runSetupChecks,
	type SetupCheckStatus,
	type SetupReport,
} from "../setup/checks";
import { getInstallCommand } from "../setup/environment";

export interface SetupOptions {
	check?: boolean;
	json?: boolean;
	dryRun?: boolean;
	skipService?: boolean;
}

const statusIcon: Record<SetupCheckStatus, string> = {
	pass: colors.green("✓"),
	warn: colors.yellow("!"),
	fail: colors.red("x"),
	skip: colors.dim("-"),
};

const checkGroups = [
	{
		title: "Environment",
		matches: (id: string) => id.startsWith("environment."),
	},
	{
		title: "Dependencies",
		matches: (id: string) => id.startsWith("command."),
	},
	{
		title: "Configuration",
		matches: (id: string) => id.startsWith("config."),
	},
	{
		title: "Runtime",
		matches: (id: string) =>
			id.startsWith("daemon.") || id.startsWith("service."),
	},
];

function printReport(report: ReturnType<typeof runSetupChecks>): void {
	console.log(`\n${colors.bold(colors.cyan("Hyprvox Setup Check"))}`);
	console.log(colors.cyan("===================\n"));
	console.log(
		[
			`${colors.dim("Distro")} ${report.environment.distro}`,
			`${colors.dim("Session")} ${report.environment.sessionType}`,
			`${colors.dim("Hyprland")} ${report.environment.isHyprland ? "yes" : "no"}`,
			`${colors.dim("Container")} ${report.environment.isContainer ? "yes" : "no"}`,
		].join("  "),
	);

	for (const group of checkGroups) {
		const checks = report.checks.filter((check) => group.matches(check.id));
		if (checks.length === 0) continue;
		console.log(`\n${colors.bold(group.title)}`);
		for (const check of checks) {
			console.log(
				`  ${statusIcon[check.status]} ${colors.bold(check.label)} ${colors.dim(check.message)}`,
			);
		}
	}

	const requiredSteps = [
		...new Set(
			report.checks
				.filter((check) => check.status === "fail")
				.map((check) => check.fix)
				.filter((fix): fix is string => Boolean(fix)),
		),
	];
	const hostSteps = [
		...new Set(
			report.checks
				.filter(
					(check) =>
						check.status === "warn" &&
						(check.id.startsWith("environment.") ||
							check.id.startsWith("command.")),
				)
				.map((check) => check.fix)
				.filter(
					(fix): fix is string => Boolean(fix) && !requiredSteps.includes(fix),
				),
		),
	];
	const runtimeSteps =
		report.environment.isContainer ||
		report.environment.sessionType === "headless"
			? []
			: [
					...new Set(
						report.checks
							.filter(
								(check) =>
									check.status === "warn" &&
									(check.id.startsWith("daemon.") ||
										check.id.startsWith("service.")),
							)
							.map((check) => check.fix)
							.filter((fix): fix is string => Boolean(fix)),
					),
				];

	if (requiredSteps.length > 0) {
		console.log(colors.bold("\nRequired next steps"));
		for (const step of requiredSteps) {
			console.log(`  - ${step}`);
		}
	}
	if (hostSteps.length > 0) {
		console.log(colors.bold("\nHost-only follow-up"));
		for (const step of hostSteps) {
			console.log(`  - ${step}`);
		}
	}
	if (runtimeSteps.length > 0) {
		console.log(colors.bold("\nAfter config is complete"));
		for (const step of runtimeSteps) {
			console.log(`  - ${step}`);
		}
	}
	if (
		report.environment.isContainer ||
		report.environment.sessionType === "headless"
	) {
		console.log(
			colors.dim(
				"\nService, audio capture, clipboard, and overlay checks are host-only in this environment.",
			),
		);
	}

	console.log("");
}

function askOptionalSecret(
	prompt: string,
	validate: (input: string) => true | string,
): string | null {
	const value = readlineSync.question(prompt, {
		hideEchoBack: true,
		mask: "*",
	});

	if (value.trim() !== "") {
		const validation = validate(value);
		if (validation === true) return value;
		console.log(validation);
		return askOptionalSecret(prompt, validate);
	}

	if (
		readlineSync.keyInYN(
			"Leave this empty for now? You can set it later with hyprvox config setup.",
		)
	) {
		return null;
	}

	return askOptionalSecret(prompt, validate);
}

function loadPartialConfig(): ConfigFile {
	if (!existsSync(DEFAULT_CONFIG_FILE)) return {};
	try {
		return JSON.parse(readFileSync(DEFAULT_CONFIG_FILE, "utf-8")) as ConfigFile;
	} catch {
		return {};
	}
}

async function configureInteractively(options: SetupOptions): Promise<boolean> {
	let existingConfig: ReturnType<typeof loadConfig> | null = null;
	if (existsSync(DEFAULT_CONFIG_FILE)) {
		try {
			existingConfig = loadConfig(DEFAULT_CONFIG_FILE, true);
		} catch (error) {
			console.log(
				colors.yellow(
					`Existing config could not be loaded: ${(error as Error).message}`,
				),
			);
			console.log(colors.dim("Setup will ask for fresh config values."));
		}
	}

	if (existingConfig) {
		console.log(
			colors.green(`Config found at ${colors.dim(DEFAULT_CONFIG_FILE)}`),
		);
		if (!readlineSync.keyInYN("Do you want to update configuration now?")) {
			return true;
		}
	}

	const groqKey = askOptionalSecret(
		"Enter Groq API Key (starts with gsk_): ",
		(input) =>
			input.startsWith("gsk_")
				? true
				: colors.red("Groq API key must start with gsk_"),
	);

	const deepgramKey = askOptionalSecret(
		"\nEnter Deepgram API Key: ",
		(input) =>
			(input.length >= 32 && input.length <= 40) ||
			colors.red("Deepgram API key must be 32-40 characters"),
	);

	if (!groqKey || !deepgramKey) {
		const partialConfig = loadPartialConfig();
		const nextConfig: ConfigFile = {
			...partialConfig,
			apiKeys:
				groqKey || deepgramKey
					? {
							...(partialConfig.apiKeys ?? {}),
							...(groqKey ? { groq: groqKey } : {}),
							...(deepgramKey ? { deepgram: deepgramKey } : {}),
						}
					: partialConfig.apiKeys,
		};

		if (!options.dryRun) {
			saveConfig(nextConfig);
		}

		console.log(
			colors.yellow(
				"API keys were skipped. Full transcription will not work until they are configured.",
			),
		);
		console.log(`Later setup: ${colors.cyan("hyprvox config setup")}`);
		console.log(
			`Direct set:  ${colors.cyan("hyprvox config set apiKeys.groq gsk_...")}`,
		);
		console.log(
			`Direct set:  ${colors.cyan("hyprvox config set apiKeys.deepgram <key>")}`,
		);
		return false;
	}

	const config = existingConfig ?? loadPartialConfig();
	const nextConfig = {
		...config,
		apiKeys: {
			...(existingConfig?.apiKeys ?? {}),
			groq: groqKey,
			deepgram: deepgramKey,
		},
	};

	if (!options.dryRun) {
		saveConfig(nextConfig);
	}
	console.log(
		`${colors.green("✓")} ${options.dryRun ? "Would save" : "Saved"} config at ${DEFAULT_CONFIG_FILE}`,
	);
	return true;
}

export async function runConfigSetup(
	options: SetupOptions = { skipService: true },
): Promise<boolean> {
	const apiKeysConfigured = await configureInteractively(options);
	await configureMicrophone(options);
	configureWaylandBehavior(options);
	return apiKeysConfigured;
}

async function configureMicrophone(options: SetupOptions): Promise<void> {
	const report = runSetupChecks();
	if (!report.environment.commands.arecord?.path) {
		console.log(
			colors.yellow(
				"Skipping microphone selection because arecord is not installed.",
			),
		);
		console.log(
			colors.dim("Install alsa-utils, then run hyprvox config setup."),
		);
		return;
	}

	const deviceService = new AudioDeviceService();
	const devices = await deviceService.listDevices();
	if (devices.length === 0) {
		console.log(
			colors.yellow("No microphones detected; leaving default audio device."),
		);
		return;
	}

	console.log(colors.bold("\nMicrophones:"));
	devices.forEach((device, index) => {
		console.log(`  ${index + 1}. ${device.description}`);
		console.log(`     ${colors.dim(device.id)}`);
	});
	console.log("  0. Use system default");

	const choice = readlineSync.questionInt("Select microphone [0]: ", {
		defaultInput: "0",
		limit: (input) => input >= 0 && input <= devices.length,
		limitMessage: "Choose a listed microphone number.",
	});

	if (choice === 0) return;

	const selected = devices[choice - 1];
	if (!selected) return;
	const config = loadPartialConfig();
	const nextConfig = {
		...config,
		behavior: {
			...config.behavior,
			audioDevice: selected.id,
		},
	};
	if (!options.dryRun) saveConfig(nextConfig);
	console.log(
		`${colors.green("✓")} Selected microphone: ${selected.description}`,
	);
}

function configureWaylandBehavior(options: SetupOptions): void {
	const report = runSetupChecks();
	if (report.environment.sessionType !== "wayland") return;

	console.log(colors.bold("\nWayland hotkey setup"));
	console.log(
		"Built-in global hotkeys are limited on Wayland. Native compositor bindings are more reliable.",
	);

	if (
		!readlineSync.keyInYN("Use compositor binding and disable built-in hotkey?")
	) {
		return;
	}

	const config = loadPartialConfig();
	const nextConfig = {
		...config,
		behavior: {
			...config.behavior,
			hotkey: "disabled",
		},
	};
	if (!options.dryRun) saveConfig(nextConfig);
	console.log(`${colors.green("✓")} Built-in hotkey disabled in config.`);
	console.log(
		`Add this to Hyprland: ${colors.cyan("bind = , code:105, exec, hyprvox toggle")}`,
	);
}

function installServiceIfRequested(
	options: SetupOptions,
	report: SetupReport,
	apiKeysConfigured: boolean,
): void {
	if (options.skipService) {
		console.log(
			colors.yellow("Skipping service install because --skip-service was set."),
		);
		return;
	}

	if (
		report.environment.isContainer ||
		report.environment.sessionType === "headless"
	) {
		console.log(
			colors.yellow(
				"Skipping service install in this container/headless session. Run hyprvox install on the desktop host.",
			),
		);
		return;
	}

	if (!apiKeysConfigured) {
		console.log(
			colors.yellow(
				"Skipping service install until API keys are configured. Run hyprvox config setup later.",
			),
		);
		return;
	}

	if (
		!readlineSync.keyInYN("Install and start the systemd user service now?")
	) {
		return;
	}

	if (options.dryRun) {
		console.log(colors.green("✓ Would run hyprvox install"));
		return;
	}

	execFileSync(process.argv[0], [process.argv[1] ?? "index.ts", "install"], {
		stdio: "inherit",
	});
}

async function runInteractiveSetup(options: SetupOptions): Promise<void> {
	const initialReport = runSetupChecks();
	printReport(initialReport);

	const installCommand = getInstallCommand(
		initialReport.environment.distro,
		initialReport.environment.sessionType,
	);
	const failedDependency = initialReport.checks.find(
		(check) => check.id.startsWith("command.") && check.status === "fail",
	);
	if (failedDependency && installCommand) {
		console.log(colors.bold("Install missing system dependencies:"));
		console.log(colors.cyan(installCommand));
		if (initialReport.environment.isContainer) {
			console.log(
				colors.dim(
					"Container detected: continuing with config-only setup. Install host dependencies on the desktop machine.",
				),
			);
		} else if (
			!readlineSync.keyInYN("Continue setup after handling dependencies?")
		) {
			return;
		}
	}

	const apiKeysConfigured = await runConfigSetup(options);
	installServiceIfRequested(options, initialReport, apiKeysConfigured);

	const finalReport = runSetupChecks();
	printReport(finalReport);
}

export const setupCommand = new Command("setup")
	.description("Interactively set up hyprvox")
	.option("--check", "Run setup checks without changing anything")
	.option("--json", "Print setup check output as JSON")
	.option("--dry-run", "Show what setup would change without writing")
	.option("--skip-service", "Do not install or start the systemd user service")
	.action(async (options: SetupOptions) => {
		try {
			if (options.check || options.json) {
				const report = runSetupChecks();
				if (options.json) {
					console.log(JSON.stringify(report, null, 2));
				} else {
					printReport(report);
				}
				process.exit(report.ready ? 0 : 1);
			}

			await runInteractiveSetup(options);
		} catch (error) {
			console.error(colors.red("Setup failed:"), (error as Error).message);
			process.exit(1);
		}
	});
