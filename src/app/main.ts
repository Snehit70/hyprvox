// Phase 0 spike: single-process topology.
//
// One Electron process hosts BOTH the daemon (DaemonService) and the overlay
// window, replacing the systemd -> supervisor -> daemon -> overlay-child stack.
// For this spike the daemon still emits state over its unix socket and the
// window's IPCClient connects to it in-process (loopback); Phase 1 replaces
// that hop with a direct webContents.send. The point here is only to prove the
// two halves boot and run inside a single process.
import * as path from "node:path";
import {
	app,
	BrowserWindow,
	type BrowserWindowConstructorOptions,
	ipcMain,
	screen,
} from "electron";
import { DaemonService } from "../daemon/service";
import { type DaemonState, getIPCClient, type IPCClient } from "../../overlay/src/ipc-client";

if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
	console.error("[App] No display environment (DISPLAY or WAYLAND_DISPLAY)");
	process.exit(1);
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch("disable-dev-shm-usage");

// Where the built renderer + preload live (overlay project's tsc/vite output).
const OVERLAY_DIST =
	process.env.HYPRVOX_OVERLAY_DIST ||
	path.join(app.getAppPath(), "overlay", "dist");

const OVERLAY_CONFIG = { width: 400, height: 60, marginBottom: 80 };

let mainWindow: BrowserWindow | null = null;
let ipcClient: IPCClient | null = null;
let restingPosition = { x: 0, y: 0 };
let parkedPosition = { x: 0, y: 0 };
let overlayVisible = false;

process.on("uncaughtException", (err) => console.error("[App] uncaught:", err));
process.on("unhandledRejection", (r) => console.error("[App] unhandled:", r));

function createOverlayWindow(): BrowserWindow {
	const display = screen.getPrimaryDisplay();
	const { width: sw, height: sh } = display.workArea;
	const x = Math.floor((sw - OVERLAY_CONFIG.width) / 2);
	const y = sh - OVERLAY_CONFIG.height - OVERLAY_CONFIG.marginBottom;

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
	return window;
}

function setOverlayWindowVisible(visible: boolean): void {
	if (!mainWindow || mainWindow.isDestroyed() || overlayVisible === visible) {
		return;
	}
	overlayVisible = visible;
	const target = visible ? restingPosition : parkedPosition;
	mainWindow.setPosition(target.x, target.y);
}

function setupIPCClient(): void {
	ipcClient = getIPCClient();
	ipcClient.on("stateChange", (state: DaemonState) => {
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.send("daemon-state", state);
		}
	});
	ipcClient.on("connectionStatusChange", (status) => {
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.send("connection-status", status);
		}
	});
	ipcClient.on("audioLevel", (audioLevel) => {
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.send("audio-level", audioLevel);
		}
	});
	ipcClient.on("connected", () => console.log("[App] IPC connected (in-process)"));
	ipcClient.on("error", (err: Error) => console.error("[App] IPC error:", err.message));
	ipcClient.connect();
}

async function boot(): Promise<void> {
	// 1. Start the daemon in-process. It binds its socket, installs its own
	//    SIGUSR1 handler (so `hyprvox toggle` drives THIS process), and — with
	//    HYPRVOX_EMBEDDED_OVERLAY set — does NOT spawn a child overlay.
	const service = new DaemonService();
	await service.start();
	console.log("[App] DaemonService started in-process, pid", process.pid);

	// 2. Bring up the window and connect to the daemon's socket in-process.
	mainWindow = createOverlayWindow();
	mainWindow.on("closed", () => {
		mainWindow = null;
	});
	ipcMain.on("overlay-visible", (_e, visible: boolean) =>
		setOverlayWindowVisible(Boolean(visible)),
	);
	ipcMain.handle("get-daemon-state", () => ipcClient?.state || { status: "idle" });
	ipcMain.handle("get-connection-status", () => ipcClient?.status || "disconnected");
	setupIPCClient();
	console.log("[App] App ready (single process)");
}

app.whenReady().then(boot);

app.on("window-all-closed", () => {
	// Single-app model: the window IS the app. Keep the process alive so the
	// daemon and hotkey survive an overlay reload rather than quitting.
});
