import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Command } from "commander";
import readlineSync from "readline-sync";
import * as colors from "yoctocolors";
import { AudioDeviceService } from "../audio/device-service";
import {
	hasConfiguredTranscriptionApiKeys,
	isValidDeepgramApiKey,
} from "../config/api-keys";
import { DEFAULT_CONFIG_FILE, loadConfig } from "../config/loader";
import type { ConfigFile } from "../config/schema";
import { saveConfig } from "../config/writer";
import {
	runSetupChecks,
	type SetupCheckStatus,
	type SetupReport,
} from "../setup/checks";
import {
	type ConfigPatch,
	loadPartialConfig,
	mergeConfig,
	rollbackProfileDerivedFields,
} from "../setup/config-patch";
import { getInstallCommand } from "../setup/environment";
import { resolveSetupHotkey } from "../setup/hotkey";
import {
	collectDeviceSignals,
	diffConfig,
	getProfileBundle,
	recommendProfile,
	type SetupProfileId,
} from "../setup/profile";

export interface SetupOptions {
	check?: boolean;
	json?: boolean;
	dryRun?: boolean;
	skipService?: boolean;
	nonInteractive?: boolean;
	advanced?: boolean;
}

class SetupAbortedError extends Error {
	constructor() {
		super("setup aborted by user");
	}
}

function abortIfQuit(value: string): void {
	if (value.trim().toLowerCase() === "q") throw new SetupAbortedError();
}

function askYesNoQuit(prompt: string): boolean {
	const idx = readlineSync.keyInSelect(
		["Yes", "No", "Quit setup"],
		`${prompt} (or q to quit)`,
		{ cancel: false },
	);
	if (idx === 2) throw new SetupAbortedError();
	return idx === 0;
}

function askSelectionQuit(choices: string[], prompt: string): number {
	for (let idx = 0; idx < choices.length; idx += 1) {
		console.log(`[${idx + 1}] ${choices[idx]}`);
	}
	while (true) {
		const raw = readlineSync.question(
			`${prompt} (or q to quit) [1...${choices.length}]: `,
		);
		abortIfQuit(raw);
		const selected = Number.parseInt(raw, 10);
		if (
			Number.isFinite(selected) &&
			selected >= 1 &&
			selected <= choices.length
		) {
			return selected - 1;
		}
		console.log(
			colors.red(`Choose a number between 1 and ${choices.length}, or q.`),
		);
	}
}

function askIntQuit(
	prompt: string,
	min: number,
	max: number,
	defaultValue: number,
): number {
	while (true) {
		const raw = readlineSync.question(
			`${prompt} [${defaultValue}] (or q to quit): `,
			{
				defaultInput: String(defaultValue),
			},
		);
		abortIfQuit(raw);
		const value = Number.parseInt(raw, 10);
		if (Number.isFinite(value) && value >= min && value <= max) return value;
		console.log(colors.red(`Choose a number between ${min} and ${max}.`));
	}
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
					(fix): fix is string =>
						typeof fix === "string" && !requiredSteps.includes(fix),
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
	allowEmpty = true,
): string | null {
	const value = readlineSync.question(prompt, {
		hideEchoBack: true,
		mask: "*",
	});
	abortIfQuit(value);

	if (value.trim() !== "") {
		const validation = validate(value);
		if (validation === true) return value;
		console.log(validation);
		return askOptionalSecret(prompt, validate);
	}

	if (
		allowEmpty &&
		askYesNoQuit(
			"Leave this empty for now? You can set it later with hyprvox config setup.",
		)
	) {
		return null;
	}

	return askOptionalSecret(prompt, validate);
}

const SETUP_REPORT_FILE = join(
	homedir(),
	".config",
	"hypr",
	"vox",
	"setup-report.json",
);

function writeSetupReport(payload: Record<string, unknown>): void {
	mkdirSync(dirname(SETUP_REPORT_FILE), { recursive: true });
	writeFileSync(SETUP_REPORT_FILE, JSON.stringify(payload, null, 2));
}

function runPostApplySmokeTest(apiKeysConfigured: boolean): {
	passed: boolean;
	reasons: string[];
} {
	const reasons: string[] = [];
	const report = runSetupChecks();
	if (!apiKeysConfigured) reasons.push("api_keys_incomplete");
	if (!report.environment.commands.arecord?.path)
		reasons.push("arecord_missing");
	if (
		report.environment.sessionType === "wayland" &&
		!report.environment.commands["wl-copy"]?.path
	) {
		reasons.push("wl_copy_missing");
	}
	if (
		report.checks.some(
			(check) => check.id.startsWith("config.") && check.status === "fail",
		)
	) {
		reasons.push("config_check_failed");
	}
	return { passed: reasons.length === 0, reasons };
}

async function collectInteractiveWizardUpdates(
	baseConfig: ConfigFile,
	options: SetupOptions,
): Promise<ConfigPatch> {
	const updates: ConfigPatch = {};
	const report = runSetupChecks();

	const groqKey = askOptionalSecret(
		"Enter Groq API Key (starts with gsk_) [enter to keep current]: ",
		(input) =>
			input.startsWith("gsk_")
				? true
				: colors.red("Groq API key must start with gsk_"),
	);

	const deepgramKey = askOptionalSecret(
		"\nEnter Deepgram API Key [enter to keep current]: ",
		(input) =>
			isValidDeepgramApiKey(input) ||
			colors.red(
				"Deepgram API key must be a 40-character hex string or valid UUID",
			),
	);

	if (groqKey || deepgramKey) {
		updates.apiKeys = {
			...(groqKey ? { groq: groqKey } : {}),
			...(deepgramKey ? { deepgram: deepgramKey } : {}),
		};
	}

	const useCompositorBinding =
		report.environment.sessionType === "wayland"
			? askYesNoQuit(
					"Use compositor binding for the hotkey? (Recommended on Wayland; disables built-in listener)",
				)
			: !askYesNoQuit(
					"Use built-in hotkey listener? (No = disable and use compositor bind)",
				);
	updates.behavior = {
		...updates.behavior,
		hotkey: resolveSetupHotkey(
			baseConfig,
			useCompositorBinding ? "compositor" : "built-in",
		),
	};

	const notifications = askYesNoQuit("Enable notifications?");
	updates.behavior = {
		...updates.behavior,
		notifications,
	};

	const clipAppend = askYesNoQuit("Append transcripts to clipboard history?");
	updates.behavior = {
		...updates.behavior,
		clipboard: {
			...updates.behavior?.clipboard,
			append: clipAppend,
			minDuration: baseConfig.behavior?.clipboard?.minDuration ?? 0.6,
			maxDuration: baseConfig.behavior?.clipboard?.maxDuration ?? 600,
		},
	};

	updates.transcription = {
		...updates.transcription,
		language: "en",
	};

	if (options.advanced) {
		const streaming = askYesNoQuit("[Advanced] Enable streaming mode?");
		const deepgramBoosting = askYesNoQuit(
			"[Advanced] Enable Deepgram boosting?",
		);
		updates.transcription = {
			...updates.transcription,
			streaming,
			deepgramBoosting,
		};
	}

	return updates;
}

async function runSetupWizard(
	workingConfig: ConfigFile,
	options: SetupOptions,
): Promise<{ nextConfig: ConfigFile; apiKeysConfigured: boolean }> {
	if (options.nonInteractive) {
		console.log(
			colors.dim(
				"Non-interactive mode: skipping prompts and preserving existing values.",
			),
		);
		return {
			nextConfig: workingConfig,
			apiKeysConfigured: hasConfiguredTranscriptionApiKeys(workingConfig),
		};
	}

	const updates = await collectInteractiveWizardUpdates(workingConfig, options);
	const nextConfig = mergeConfig(workingConfig, updates);
	return {
		nextConfig,
		apiKeysConfigured: hasConfiguredTranscriptionApiKeys(nextConfig),
	};
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
		if (
			!options.nonInteractive &&
			!askYesNoQuit("Do you want to update configuration now?")
		) {
			return true;
		}
	}

	const config = existingConfig ?? loadPartialConfig();
	const { nextConfig, apiKeysConfigured } = await runSetupWizard(
		config,
		options,
	);

	const changes = diffConfig(config, nextConfig);
	console.log(colors.bold("\nPlanned setup changes"));
	if (changes.length === 0) {
		console.log(colors.dim("  (no config changes)"));
	} else {
		for (const line of changes) console.log(`  - ${line}`);
	}

	if (!options.nonInteractive && !askYesNoQuit("Apply these setup changes?")) {
		console.log(colors.yellow("Setup changes cancelled by user."));
		return hasConfiguredTranscriptionApiKeys(config);
	}

	if (!options.dryRun && changes.length > 0) saveConfig(nextConfig);
	console.log(
		`${colors.green("✓")} ${options.dryRun ? "Would save" : "Saved"} config at ${DEFAULT_CONFIG_FILE}`,
	);

	if (!apiKeysConfigured) {
		console.log(
			colors.yellow(
				"API keys are incomplete. Full transcription will not work until both Groq and Deepgram are configured.",
			),
		);
	}
	return apiKeysConfigured;
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
	if (options.nonInteractive) return;
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

	const choice = askIntQuit("Select microphone", 0, devices.length, 0);

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
	if (options.nonInteractive) return;
	const report = runSetupChecks();
	if (report.environment.sessionType !== "wayland") return;

	const config = loadPartialConfig();
	const hotkey = config.behavior?.hotkey ?? "Right Control";
	const hotkeyDisabled = hotkey.trim().toLowerCase() === "disabled";

	console.log(colors.bold("\nWayland hotkey guidance"));
	console.log(
		"Built-in global hotkeys are limited on Wayland. Native compositor bindings are more reliable.",
	);
	if (hotkeyDisabled) {
		console.log(`${colors.green("✓")} Built-in hotkey disabled in config.`);
		console.log(
			`Add this to Hyprland: ${colors.cyan("bind = , code:105, exec, hyprvox toggle")}`,
		);
	} else {
		console.log(
			colors.yellow(
				`Built-in hotkey remains enabled as ${colors.bold(hotkey)}; use compositor bindings for reliable system-wide Wayland hotkeys.`,
			),
		);
	}
}

function installServiceIfRequested(
	options: SetupOptions,
	report: SetupReport,
	apiKeysConfigured: boolean,
): void {
	const executable = process.argv[0] ?? "bun";
	const entrypoint = process.argv[1] ?? "index.ts";

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

	if (options.nonInteractive) {
		if (options.dryRun) {
			console.log(colors.green("✓ Would run hyprvox install"));
			return;
		}
		execFileSync(executable, [entrypoint, "install"], {
			stdio: "inherit",
		});
		return;
	}

	if (!askYesNoQuit("Install and start the systemd user service now?")) {
		return;
	}

	if (options.dryRun) {
		console.log(colors.green("✓ Would run hyprvox install"));
		return;
	}

	execFileSync(executable, [entrypoint, "install"], {
		stdio: "inherit",
	});
}

async function runInteractiveSetup(options: SetupOptions): Promise<void> {
	const initialReport = runSetupChecks();
	printReport(initialReport);
	const runStartedAt = new Date().toISOString();
	let selectedProfileId: SetupProfileId | null = null;
	let selectedProfileConfidence: string | null = null;
	let profileDiff: string[] = [];
	const preProfileConfig = loadPartialConfig();
	const audioDevices = initialReport.environment.commands.arecord?.path
		? await new AudioDeviceService().listDevices().catch(() => [])
		: [];
	const signals = collectDeviceSignals(
		initialReport.environment,
		audioDevices.length,
	);
	const recommendation = recommendProfile(signals);
	selectedProfileConfidence = recommendation.confidence;
	const recommendedBundle = getProfileBundle(recommendation.profile);

	console.log(colors.bold("Device-aware profile recommendation"));
	console.log(
		`${colors.cyan(recommendedBundle.label)} (${recommendation.profile}) confidence=${recommendation.confidence}`,
	);
	console.log(colors.dim(recommendedBundle.description));
	for (const reason of recommendation.reasons.slice(0, 4)) {
		console.log(`  - ${reason}`);
	}

	const profileChoices = [
		`Use recommended: ${recommendedBundle.label}`,
		"Override: Desktop Balanced",
		"Override: Laptop Low Power",
		"Override: Container Headless",
		"Skip profile",
	];
	const profileChoice = options.nonInteractive
		? 0
		: askSelectionQuit(profileChoices, "Choose setup profile");
	selectedProfileId = recommendation.profile;
	if (profileChoice === 1) selectedProfileId = "desktop-balanced";
	if (profileChoice === 2) selectedProfileId = "laptop-lowpower";
	if (profileChoice === 3) selectedProfileId = "container-headless";
	const shouldApplyProfile = profileChoice !== 4;
	if (shouldApplyProfile) {
		const currentConfig = loadPartialConfig();
		const selectedBundle = getProfileBundle(selectedProfileId);
		const proposedConfig = selectedBundle.apply(currentConfig);
		profileDiff = diffConfig(currentConfig, proposedConfig);

		console.log(colors.bold("\nProfile preview"));
		console.log(
			`${colors.cyan(selectedBundle.label)} (${selectedProfileId}) will apply:`,
		);
		if (profileDiff.length === 0) {
			console.log(colors.dim("  (no changes from current config)"));
		} else {
			for (const line of profileDiff) console.log(`  - ${line}`);
		}

		if (
			options.nonInteractive ||
			askYesNoQuit("Apply this profile before setup questions?")
		) {
			if (!options.dryRun) saveConfig(proposedConfig);
			console.log(
				`${colors.green("✓")} ${options.dryRun ? "Would apply" : "Applied"} profile ${selectedBundle.label}`,
			);
		}
	}

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
			!options.nonInteractive &&
			!askYesNoQuit("Continue setup after handling dependencies?")
		) {
			return;
		}
	}

	const apiKeysConfigured = await runConfigSetup(options);
	const smoke = runPostApplySmokeTest(apiKeysConfigured);
	if (!smoke.passed && selectedProfileId && profileDiff.length > 0) {
		console.log(
			colors.yellow("Smoke test failed; rolling back profile-derived fields."),
		);
		const current = loadPartialConfig();
		const rolledBack = rollbackProfileDerivedFields(current, preProfileConfig);
		if (!options.dryRun) saveConfig(rolledBack);
	}
	installServiceIfRequested(options, initialReport, apiKeysConfigured);

	const finalReport = runSetupChecks();
	writeSetupReport({
		startedAt: runStartedAt,
		finishedAt: new Date().toISOString(),
		nonInteractive: Boolean(options.nonInteractive),
		advanced: Boolean(options.advanced),
		profile: {
			selected: selectedProfileId,
			confidence: selectedProfileConfidence,
			diff: profileDiff,
		},
		smokeTest: smoke,
		initialReady: initialReport.ready,
		finalReady: finalReport.ready,
		environment: {
			distro: initialReport.environment.distro,
			sessionType: initialReport.environment.sessionType,
			isContainer: initialReport.environment.isContainer,
			audioDeviceCount: audioDevices.length,
		},
	});
	console.log(colors.dim(`Setup report saved: ${SETUP_REPORT_FILE}`));
	printReport(finalReport);
}

export const setupCommand = new Command("setup")
	.description("Interactively set up hyprvox")
	.option("--check", "Run setup checks without changing anything")
	.option("--json", "Print setup check output as JSON")
	.option("--dry-run", "Show what setup would change without writing")
	.option("--skip-service", "Do not install or start the systemd user service")
	.option(
		"--non-interactive",
		"Run setup without prompts (automation-friendly)",
	)
	.option("--advanced", "Enable advanced setup questions")
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
			if (error instanceof SetupAbortedError) {
				console.log(colors.yellow("Setup aborted."));
				process.exit(0);
			}
			console.error(colors.red("Setup failed:"), (error as Error).message);
			process.exit(1);
		}
	});
