import * as path from "node:path";
import {
	app,
	BrowserWindow,
	type BrowserWindowConstructorOptions,
	ipcMain,
	screen,
} from "electron";
import { type DaemonState, getIPCClient, type IPCClient } from "./ipc-client";

// Validate display environment before starting
if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
	console.error(
		"[Overlay] No display environment found (DISPLAY or WAYLAND_DISPLAY)",
	);
	console.error("[Overlay] Overlay cannot start without a display server");
	process.exit(1);
}

// Disable GPU acceleration to prevent rendering crashes on Wayland
// GPU-related crashes are the most common cause of overlay failures
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch("disable-dev-shm-usage");

interface OverlayConfig {
	width: number;
	height: number;
	marginBottom: number;
}

const DEFAULT_CONFIG: OverlayConfig = {
	width: 400,
	height: 60,
	marginBottom: 80,
};

const IPC_CONNECTION_TIMEOUT_MS = 5000;

let mainWindow: BrowserWindow | null = null;
let ipcClient: IPCClient | null = null;
let previousStatus: string = "idle";
let ipcConnectionTimeout: NodeJS.Timeout | null = null;

process.on("uncaughtException", (err) => {
	console.error("[Overlay] Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
	console.error("[Overlay] Unhandled rejection:", reason);
});

function createOverlayWindow(
	config: OverlayConfig = DEFAULT_CONFIG,
): BrowserWindow {
	const display = screen.getPrimaryDisplay();
	// Use workArea to avoid placing overlay behind taskbar/panel
	const { width: screenWidth, height: screenHeight } = display.workArea;

	const x = Math.floor((screenWidth - config.width) / 2);
	const y = screenHeight - config.height - config.marginBottom;

	const windowOptions: BrowserWindowConstructorOptions = {
		width: config.width,
		height: config.height,
		x,
		y,
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
			preload: path.join(__dirname, "preload.js"),
		},
	};

	const window = new BrowserWindow(windowOptions);

	window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	window.setAlwaysOnTop(true, "floating");
	window.setIgnoreMouseEvents(true, { forward: true });

	window.loadFile(path.join(__dirname, "renderer", "index.html"));

	// Add crash recovery handlers
	window.on("unresponsive", () => {
		console.error("[Overlay] Window became unresponsive");
		if (mainWindow) {
			mainWindow.destroy();
			mainWindow = null;
		}
		// Recreate window after delay
		setTimeout(() => {
			if (!mainWindow) {
				console.log("[Overlay] Recreating window after unresponsive event");
				mainWindow = createOverlayWindow();
				// IPC client is a singleton already connected, no need to reinitialize
			}
		}, 2000);
	});

	window.webContents.on("render-process-gone", (_event, details) => {
		console.error("[Overlay] Renderer process crashed", details);
		if (mainWindow) {
			mainWindow.destroy();
			mainWindow = null;
		}
		// Recreate window after delay
		setTimeout(() => {
			if (!mainWindow) {
				console.log("[Overlay] Recreating window after crash");
				mainWindow = createOverlayWindow();
				// IPC client is a singleton already connected, no need to reinitialize
			}
		}, 2000);
	});

	return window;
}

function setupIPCClient(): void {
	// Set connection timeout
	ipcConnectionTimeout = setTimeout(() => {
		console.error(
			"[Overlay] IPC connection timeout - daemon may not be running",
		);
		app.quit();
	}, IPC_CONNECTION_TIMEOUT_MS);

	ipcClient = getIPCClient();

	ipcClient.on("stateChange", (state: DaemonState) => {
		const receivedAt = Date.now();
		const latency = state.timestamp ? receivedAt - state.timestamp : null;

		console.log(`[TIMING] State change: ${state.status}, latency=${latency}ms`);

		if (!mainWindow || mainWindow.isDestroyed()) {
			return;
		}

		mainWindow.webContents.send("daemon-state", state);

		const currentStatus = state.status;

		switch (currentStatus) {
			case "idle":
				if (previousStatus === "processing") {
					console.log(
						`[TIMING] Window already mapped (success), total=${state.timestamp ? Date.now() - state.timestamp : "N/A"}ms`,
					);
				}
				break;

			case "error":
				console.log(
					`[TIMING] Window already mapped (error), total=${state.timestamp ? Date.now() - state.timestamp : "N/A"}ms`,
				);
				break;

			case "starting":
			case "recording":
			case "processing":
			case "stopping":
				console.log(
					`[TIMING] Window already mapped (${currentStatus}), total=${state.timestamp ? Date.now() - state.timestamp : "N/A"}ms`,
				);
				break;
		}

		previousStatus = currentStatus;
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

	ipcClient.on("maxReconnectAttemptsReached", () => {
		console.log("Max reconnect attempts reached, daemon unavailable");
	});

	ipcClient.on("connected", () => {
		if (ipcConnectionTimeout) {
			clearTimeout(ipcConnectionTimeout);
			ipcConnectionTimeout = null;
		}
		console.log("[IPC] Connected to daemon");
	});

	// Add error listener to prevent unhandled error crashes
	ipcClient.on("error", (err: Error) => {
		console.error("[IPC] Connection error:", err.message);
	});

	ipcClient.connect();
}

app.whenReady().then(() => {
	mainWindow = createOverlayWindow();
	console.log("[Overlay] App ready");

	mainWindow.on("closed", () => {
		mainWindow = null;
	});

	mainWindow.webContents.on("render-process-gone", (_event, details) => {
		console.error("[Overlay] Render process gone:", details);
	});

	ipcMain.on("window-ready", () => {
		console.log("Overlay window ready");
	});

	ipcMain.handle("get-daemon-state", () => {
		return ipcClient?.state || { status: "idle" };
	});

	ipcMain.handle("get-connection-status", () => {
		return ipcClient?.status || "disconnected";
	});

	setupIPCClient();
});

app.on("child-process-gone", (_event, details) => {
	console.error("[Overlay] Child process gone:", details);
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		mainWindow = createOverlayWindow();
	}
});

app.on("before-quit", () => {
	if (mainWindow !== null && !mainWindow.isDestroyed()) {
		mainWindow.close();
	}
});
