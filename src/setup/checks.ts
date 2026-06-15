import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG_FILE, loadConfig } from "../config/loader";
import type { EnvironmentInfo, RequiredCommand } from "./environment";
import { detectEnvironment, getInstallCommand } from "./environment";

export type SetupCheckStatus = "pass" | "warn" | "fail" | "skip";

export interface SetupCheck {
	id: string;
	label: string;
	status: SetupCheckStatus;
	message: string;
	fix?: string;
}

export interface SetupCheckOptions {
	configPath?: string;
	envInfo?: EnvironmentInfo;
	exists?: (path: string) => boolean;
	readFile?: (path: string) => string;
	statMode?: (path: string) => number;
	loadConfigFn?: typeof loadConfig;
}

export interface SetupReport {
	environment: EnvironmentInfo;
	checks: SetupCheck[];
	ready: boolean;
	nextSteps: string[];
}

const defaultReadFile = (path: string): string => readFileSync(path, "utf-8");
const defaultStatMode = (path: string): number => statSync(path).mode & 0o777;

function addCommandCheck(
	checks: SetupCheck[],
	env: EnvironmentInfo,
	command: RequiredCommand,
	label: string,
	fix?: string,
	statusWhenMissing: SetupCheckStatus = "fail",
): void {
	const probe = env.commands[command];
	if (probe?.path) {
		checks.push({
			id: `command.${command}`,
			label,
			status: "pass",
			message: `${command} found at ${probe.path}`,
		});
		return;
	}

	checks.push({
		id: `command.${command}`,
		label,
		status: statusWhenMissing,
		message: `${command} is not available`,
		fix,
	});
}

function configChecks(
	checks: SetupCheck[],
	options: Required<
		Pick<
			SetupCheckOptions,
			"configPath" | "exists" | "statMode" | "loadConfigFn"
		>
	>,
): void {
	if (!options.exists(options.configPath)) {
		checks.push({
			id: "config.exists",
			label: "Config file",
			status: "fail",
			message: `Config file is missing at ${options.configPath}`,
			fix: "Run hyprvox setup or hyprvox config init.",
		});
		return;
	}

	checks.push({
		id: "config.exists",
		label: "Config file",
		status: "pass",
		message: `Config file exists at ${options.configPath}`,
	});

	try {
		const mode = options.statMode(options.configPath);
		if (mode === 0o600) {
			checks.push({
				id: "config.permissions",
				label: "Config permissions",
				status: "pass",
				message: "Config file permissions are 600",
			});
		} else {
			checks.push({
				id: "config.permissions",
				label: "Config permissions",
				status: "warn",
				message: `Config file permissions are ${mode.toString(8)}`,
				fix: `chmod 600 ${options.configPath}`,
			});
		}
	} catch (error) {
		checks.push({
			id: "config.permissions",
			label: "Config permissions",
			status: "warn",
			message: `Could not inspect config permissions: ${(error as Error).message}`,
		});
	}

	try {
		options.loadConfigFn(options.configPath, true);
		checks.push({
			id: "config.valid",
			label: "Config validation",
			status: "pass",
			message: "Config validates successfully",
		});
	} catch (error) {
		checks.push({
			id: "config.valid",
			label: "Config validation",
			status: "fail",
			message: (error as Error).message,
			fix: "Run hyprvox setup to repair the configuration.",
		});
	}
}

function daemonChecks(
	checks: SetupCheck[],
	options: Required<Pick<SetupCheckOptions, "exists" | "readFile">>,
): void {
	const configDir = join(homedir(), ".config", "hypr", "vox");
	const pidFile = join(configDir, "daemon.pid");
	const serviceFile = join(
		homedir(),
		".config",
		"systemd",
		"user",
		"hyprvox.service",
	);

	if (!options.exists(pidFile)) {
		checks.push({
			id: "daemon.running",
			label: "Daemon",
			status: "warn",
			message: "Daemon is not running yet",
			fix: "Run hyprvox install, or hyprvox start for a manual foreground run.",
		});
	} else {
		try {
			const pid = Number.parseInt(options.readFile(pidFile).trim(), 10);
			process.kill(pid, 0);
			checks.push({
				id: "daemon.running",
				label: "Daemon",
				status: "pass",
				message: `Daemon is running with PID ${pid}`,
			});
		} catch {
			checks.push({
				id: "daemon.running",
				label: "Daemon",
				status: "warn",
				message: "Daemon PID file exists but the process is not running",
				fix: "Remove stale daemon state or restart with hyprvox install.",
			});
		}
	}

	checks.push({
		id: "service.installed",
		label: "Systemd service",
		status: options.exists(serviceFile) ? "pass" : "warn",
		message: options.exists(serviceFile)
			? `Service file exists at ${serviceFile}`
			: "Systemd user service is not installed",
		fix: options.exists(serviceFile) ? undefined : "Run hyprvox install.",
	});
}

function buildNextSteps(checks: SetupCheck[]): string[] {
	return checks
		.filter((check) => check.status === "fail" || check.status === "warn")
		.map((check) => check.fix)
		.filter((fix): fix is string => Boolean(fix));
}

export function runSetupChecks(options: SetupCheckOptions = {}): SetupReport {
	const env = options.envInfo ?? detectEnvironment();
	const exists = options.exists ?? existsSync;
	const readFile = options.readFile ?? defaultReadFile;
	const statMode = options.statMode ?? defaultStatMode;
	const loadConfigFn = options.loadConfigFn ?? loadConfig;
	const configPath = options.configPath ?? DEFAULT_CONFIG_FILE;
	const checks: SetupCheck[] = [];
	const installCommand = getInstallCommand(env.distro, env.sessionType);

	checks.push({
		id: "environment.platform",
		label: "Platform",
		status: env.isLinux ? "pass" : "fail",
		message: env.isLinux
			? `Linux detected (${env.distro})`
			: `Unsupported platform: ${env.platform}`,
		fix: env.isLinux ? undefined : "hyprvox currently requires Linux.",
	});

	checks.push({
		id: "environment.session",
		label: "Desktop session",
		status: env.sessionType === "headless" ? "warn" : "pass",
		message:
			env.sessionType === "headless"
				? "No Wayland/X11 session detected"
				: `${env.sessionType.toUpperCase()} session detected`,
		fix:
			env.sessionType === "headless"
				? "Run full transcription setup on a desktop session with microphone and clipboard access."
				: undefined,
	});

	if (env.isContainer) {
		checks.push({
			id: "environment.container",
			label: "Container",
			status: "warn",
			message: "Container environment detected",
			fix: "Use setup --check in containers; run service, audio, and clipboard checks on the host.",
		});
	}

	addCommandCheck(
		checks,
		env,
		"bun",
		"Bun runtime",
		"Install Bun from https://bun.sh.",
	);
	addCommandCheck(
		checks,
		env,
		"ffmpeg",
		"Audio conversion",
		installCommand ?? "Install ffmpeg with your distro package manager.",
	);
	addCommandCheck(
		checks,
		env,
		"arecord",
		"Audio capture",
		installCommand ?? "Install alsa-utils with your distro package manager.",
		env.isContainer || env.sessionType === "headless" ? "warn" : "fail",
	);

	const hasWaylandClipboard = Boolean(env.commands["wl-copy"]?.path);
	const hasXClipboard = Boolean(
		env.commands.xclip?.path || env.commands.xsel?.path,
	);
	const needsXClipboard = env.sessionType === "x11";
	const clipboardOk = needsXClipboard ? hasXClipboard : hasWaylandClipboard;
	checks.push({
		id: "command.clipboard",
		label: "Clipboard command",
		status: clipboardOk
			? "pass"
			: env.isContainer || env.sessionType === "headless"
				? "warn"
				: "fail",
		message: clipboardOk
			? "Clipboard command is available"
			: "Clipboard command is missing",
		fix: clipboardOk
			? undefined
			: (installCommand ??
				"Install wl-clipboard on Wayland or xclip/xsel on X11."),
	});

	addCommandCheck(
		checks,
		env,
		"notify-send",
		"Notifications",
		installCommand ?? "Install libnotify or libnotify-bin.",
		"warn",
	);

	addCommandCheck(
		checks,
		env,
		"systemctl",
		"Systemd user service",
		"Install systemd or run hyprvox start manually.",
		env.isContainer ? "warn" : "fail",
	);

	configChecks(checks, { configPath, exists, statMode, loadConfigFn });
	daemonChecks(checks, { exists, readFile });

	const ready = checks.every(
		(check) => check.status === "pass" || check.status === "skip",
	);

	return {
		environment: env,
		checks,
		ready,
		nextSteps: [...new Set(buildNextSteps(checks))],
	};
}
