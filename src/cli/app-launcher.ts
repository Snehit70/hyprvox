import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { projectRoot } from "../utils/project-paths";

// The single Electron app (daemon + overlay window). Built by `bun run
// build:app`; the Electron runtime is the overlay package's dependency.
export const appDir = join(projectRoot, "dist", "app");
export const electronBinary = join(
	projectRoot,
	"overlay",
	"node_modules",
	".bin",
	"electron",
);

const configDir = join(homedir(), ".config", "hypr", "vox");
const logsDir = join(configDir, "logs");

/**
 * Spawn environment for the app. ELECTRON_OZONE_PLATFORM_HINT must not reach
 * the Electron process: the overlay depends on XWayland (self-positioning),
 * and hint=auto — common in Hyprland sessions — either selects native Wayland
 * or, combined with the app's --ozone-platform=x11 pin, leaves Electron with
 * no window at all. Electron reads the hint before the app's JS runs, so it
 * can only be stripped here.
 */
function buildAppEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	delete env.ELECTRON_OZONE_PLATFORM_HINT;
	return env;
}

export function assertAppLaunchable(): void {
	if (!existsSync(join(appDir, "main.js"))) {
		throw new Error(
			`App bundle not found at ${appDir}. Build it with: bun run build:app`,
		);
	}
	if (!existsSync(electronBinary)) {
		throw new Error(
			`Electron binary not found at ${electronBinary}. Install overlay deps with: cd overlay && npm install`,
		);
	}
}

/**
 * Launch the app detached, logging to ~/.config/hypr/vox/logs/app.log.
 * The service writes its own pidfile once it is actually up; callers that
 * need the pid should poll the pidfile rather than trust the spawn result.
 */
export function spawnAppDetached(): number | undefined {
	assertAppLaunchable();
	mkdirSync(logsDir, { recursive: true, mode: 0o700 });
	const logFd = openSync(join(logsDir, "app.log"), "a");

	const child = spawn(electronBinary, [appDir], {
		detached: true,
		stdio: ["ignore", logFd, logFd],
		env: buildAppEnv(),
	});
	child.unref();
	closeSync(logFd);
	return child.pid;
}

export function spawnAppForeground(): void {
	assertAppLaunchable();
	const child = spawn(electronBinary, [appDir], {
		stdio: "inherit",
		env: buildAppEnv(),
	});
	child.on("exit", (code) => {
		process.exit(code ?? 0);
	});
}
