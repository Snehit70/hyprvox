// Single-app topology: one Electron process hosts the daemon (DaemonService)
// and the overlay window. Daemon state flows main -> renderer directly via
// webContents.send — there is no loopback socket and no supervision stack;
// Electron is the single supervisor (ADR-0003). Launched via Hyprland
// exec-once (`hyprvox start`) or lazily by `hyprvox toggle`.
import * as path from "node:path";
import {
	app,
	BrowserWindow,
	type BrowserWindowConstructorOptions,
	ipcMain,
	screen,
} from "electron";
import { DaemonService } from "../daemon/service";
import type {
	AudioLevelMessage,
	ConnectionStatus,
	DaemonState,
} from "../shared/ipc-types";
import { getBundledOverlayPath } from "../utils/project-paths";
import { SOCKET_PATH } from "../utils/socket-path";
import { CommandServer } from "./command-server";

if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
	console.error("[App] No display environment (DISPLAY or WAYLAND_DISPLAY)");
	process.exit(1);
}

// The overlay parks itself off-screen by moving its own window (ADR-0001),
// which only works as an XWayland client — native Wayland windows cannot
// self-position, setPosition becomes a silent no-op, and the overlay freezes
// wherever the compositor mapped it. This switch pins X11 when no ozone env
// hint is present. It is NOT sufficient on its own: Electron consumes
// ELECTRON_OZONE_PLATFORM_HINT in C++ before this file runs, and (verified on
// Electron 34) hint=auto alongside --ozone-platform=x11 half-initializes the
// browser and no window is ever created. The CLI launcher therefore strips
// that env var from the spawn environment (src/cli/app-launcher.ts); anyone
// exec'ing the electron binary directly must do the same.
app.commandLine.appendSwitch("ozone-platform", "x11");

// Disable GPU acceleration to prevent rendering crashes on Wayland.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch("disable-dev-shm-usage");

// Where the built renderer + preload live (overlay project's tsc/vite output).
const OVERLAY_DIST =
	process.env.HYPRVOX_OVERLAY_DIST ||
	path.join(getBundledOverlayPath(), "dist");

const OVERLAY_CONFIG = { width: 400, height: 60, marginBottom: 80 };

let mainWindow: BrowserWindow | null = null;
let service: DaemonService | null = null;
let commandServer: CommandServer | null = null;
let lastState: DaemonState = { status: "idle" };
let restingPosition = { x: 0, y: 0 };
let parkedPosition = { x: 0, y: 0 };
let overlayVisible = false;

process.on("uncaughtException", (err) => console.error("[App] uncaught:", err));
process.on("unhandledRejection", (r) => console.error("[App] unhandled:", r));

// Without these, a SIGTERM/SIGINT kills Electron before service.stop() runs,
// leaving a stale pidfile/socket that fails the next boot.
process.on("SIGTERM", () => app.quit());
process.on("SIGINT", () => app.quit());

function sendToRenderer(channel: string, payload: unknown): void {
	if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.webContents.send(channel, payload);
	}
}

function createOverlayWindow(): BrowserWindow {
	const display = screen.getPrimaryDisplay();
	const { width: sw, height: sh } = display.workArea;
	const x = Math.floor((sw - OVERLAY_CONFIG.width) / 2);
	const y = sh - OVERLAY_CONFIG.height - OVERLAY_CONFIG.marginBottom;

	// Resting spot (visible) and a parked spot fully below the monitor. The
	// window stays mapped (ADR-0001); when idle it moves off-screen so the
	// compositor has no transparent rect to blur into a "ghost pill".
	restingPosition = { x, y };
	parkedPosition = {
		x,
		y: display.bounds.y + display.bounds.height + OVERLAY_CONFIG.height,
	};
	overlayVisible = false;

	const opts: BrowserWindowConstructorOptions = {
		width: OVERLAY_CONFIG.width,
		height: OVERLAY_CONFIG.height,
		x: parkedPosition.x,
		y: parkedPosition.y,
		frame: false,
		transparent: true,
		show: true,
		alwaysOnTop: true,
		resizable: false,
		skipTaskbar: true,
		hasShadow: false,
		focusable: false,
		type: "toolbar",
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			preload: path.join(OVERLAY_DIST, "preload.js"),
		},
	};

	const window = new BrowserWindow(opts);
	window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	window.setAlwaysOnTop(true, "floating");
	window.setIgnoreMouseEvents(true, { forward: true });
	window.loadFile(path.join(OVERLAY_DIST, "renderer", "index.html"));

	// A crashed or hung renderer only loses the window; the daemon half keeps
	// running and the recreated window re-syncs from lastState.
	window.on("unresponsive", () => {
		console.error("[App] Overlay window unresponsive, recreating");
		recreateOverlayWindow();
	});
	window.webContents.on("render-process-gone", (_event, details) => {
		console.error("[App] Renderer process gone:", details);
		recreateOverlayWindow();
	});
	window.webContents.on("preload-error", (_event, preloadPath, error) => {
		console.error("[App] Preload failed:", preloadPath, error);
	});
	window.webContents.on(
		"did-fail-load",
		(_event, errorCode, errorDescription, validatedURL) => {
			console.error(
				"[App] Renderer failed to load:",
				errorCode,
				errorDescription,
				validatedURL,
			);
		},
	);
	window.webContents.on(
		"console-message",
		(_event, level, message, line, sourceId) => {
			if (level >= 2) {
				console.error(`[Renderer:${level}] ${message} (${sourceId}:${line})`);
			}
		},
	);
	window.webContents.on("did-finish-load", () => {
		// In-process daemon: the renderer's "connection" to it is the process
		// itself being alive, so it is connected by definition.
		sendToRenderer("connection-status", "connected" satisfies ConnectionStatus);
		sendToRenderer("daemon-state", lastState);
	});

	return window;
}

function recreateOverlayWindow(): void {
	if (mainWindow) {
		mainWindow.destroy();
		mainWindow = null;
	}
	setTimeout(() => {
		if (!mainWindow) {
			mainWindow = createOverlayWindow();
			mainWindow.on("closed", () => {
				mainWindow = null;
			});
		}
	}, 2000);
}

function setOverlayWindowVisible(visible: boolean): void {
	if (!mainWindow || mainWindow.isDestroyed() || overlayVisible === visible) {
		return;
	}
	overlayVisible = visible;
	const target = visible ? restingPosition : parkedPosition;
	mainWindow.setPosition(target.x, target.y);
}

async function boot(): Promise<void> {
	// Resolved paths, not env: a boot line must identify the run it came from
	// unambiguously (HOME remapping and env overrides both move these).
	console.log(
		"[App] boot: pid=%d socket=%s pidfile=%s",
		process.pid,
		SOCKET_PATH,
		process.env.HYPRVOX_PID_FILE || "(default daemon.pid)",
	);

	// 1. Bind the command socket first: it is the single-instance guard, so a
	//    second launch dies here before touching the pidfile or the recorder.
	commandServer = new CommandServer((action) => {
		if (action === "soniox-toggle") {
			service?.triggerSonioxToggle();
		}
	});
	await commandServer.start();

	// 2. Start the daemon in-process. It writes the pidfile and installs its
	//    own SIGUSR1 handler, so `hyprvox toggle` drives THIS process.
	service = new DaemonService();
	service.on("state", (state: DaemonState) => {
		lastState = state;
		sendToRenderer("daemon-state", state);
	});
	service.on("audioLevel", (audioLevel: AudioLevelMessage) => {
		sendToRenderer("audio-level", audioLevel);
	});
	await service.start();
	console.log("[App] DaemonService started in-process, pid", process.pid);

	// 3. Bring up the window.
	ipcMain.on("overlay-visible", (_e: unknown, visible: boolean) =>
		setOverlayWindowVisible(Boolean(visible)),
	);
	ipcMain.handle("get-daemon-state", () => lastState);
	ipcMain.handle(
		"get-connection-status",
		(): ConnectionStatus => (service ? "connected" : "disconnected"),
	);
	mainWindow = createOverlayWindow();
	mainWindow.on("closed", () => {
		mainWindow = null;
	});
	console.log("[App] App ready (single process)");
}

app.whenReady().then(() =>
	boot().catch((err) => {
		// A half-alive app (window up, daemon dead) is worse than a dead one:
		// it looks healthy while holding the pidfile and answering nothing.
		console.error("[App] Boot failed, exiting:", err);
		app.exit(1);
	}),
);

let stopping = false;
app.on("will-quit", (event: { preventDefault: () => void }) => {
	if (stopping || (!service && !commandServer)) {
		return;
	}
	stopping = true;
	event.preventDefault();
	Promise.resolve()
		.then(() => service?.stop())
		.then(() => commandServer?.stop())
		.catch((err) => console.error("[App] Shutdown error:", err))
		.finally(() => app.exit(0));
});

app.on("window-all-closed", () => {
	// Single-app model: the window IS the app. Keep the process alive so the
	// daemon and hotkey survive an overlay reload rather than quitting.
});
