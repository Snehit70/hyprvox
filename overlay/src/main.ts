import * as path from "node:path";
import {
	app,
	BrowserWindow,
	type BrowserWindowConstructorOptions,
	ipcMain,
	screen,
} from "electron";
import { type DaemonState, getIPCClient, type IPCClient } from "./ipc-client";

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

const SUCCESS_HIDE_DELAY_MS = 1500;
const ERROR_HIDE_DELAY_MS = 3000;

let mainWindow: BrowserWindow | null = null;
let ipcClient: IPCClient | null = null;
let previousStatus: string = "idle";
let hideTimeout: NodeJS.Timeout | null = null;
let isWindowVisible = false;

function createOverlayWindow(
	config: OverlayConfig = DEFAULT_CONFIG,
): BrowserWindow {
	const display = screen.getPrimaryDisplay();
	const { width: screenWidth, height: screenHeight } = display.bounds;

	const x = Math.floor((screenWidth - config.width) / 2);
	const y = screenHeight - config.height - config.marginBottom;

	const windowOptions: BrowserWindowConstructorOptions = {
		width: config.width,
		height: config.height,
		x,
		y,
		frame: false,
		transparent: true,
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
	window.hide();

	window.loadFile(path.join(__dirname, "renderer", "index.html"));

	return window;
}

function setupIPCClient(): void {
	ipcClient = getIPCClient();

	ipcClient.on("stateChange", (state: DaemonState) => {
		if (!mainWindow || mainWindow.isDestroyed()) {
			return;
		}

		mainWindow.webContents.send("daemon-state", state);

		const currentStatus = state.status;

		if (hideTimeout) {
			clearTimeout(hideTimeout);
			hideTimeout = null;
		}

		switch (currentStatus) {
			case "idle":
				if (previousStatus === "processing") {
					mainWindow.show();
					isWindowVisible = true;
					hideTimeout = setTimeout(() => {
						if (mainWindow && !mainWindow.isDestroyed()) {
							mainWindow.hide();
							isWindowVisible = false;
						}
					}, SUCCESS_HIDE_DELAY_MS);
				} else if (isWindowVisible) {
					mainWindow.hide();
					isWindowVisible = false;
				}
				break;

			case "error":
				mainWindow.show();
				isWindowVisible = true;
				hideTimeout = setTimeout(() => {
					if (mainWindow && !mainWindow.isDestroyed()) {
						mainWindow.hide();
						isWindowVisible = false;
					}
				}, ERROR_HIDE_DELAY_MS);
				break;

			case "starting":
			case "recording":
			case "processing":
				mainWindow.show();
				isWindowVisible = true;
				break;
		}

		previousStatus = currentStatus;
	});

	ipcClient.on("connectionStatusChange", (status) => {
		if (mainWindow && !mainWindow.isDestroyed()) {
			mainWindow.webContents.send("connection-status", status);
		}
	});

	ipcClient.on("maxReconnectAttemptsReached", () => {
		console.log("Max reconnect attempts reached, daemon unavailable");
		if (mainWindow && !mainWindow.isDestroyed() && isWindowVisible) {
			mainWindow.hide();
			isWindowVisible = false;
		}
	});

	ipcClient.connect();
}

app.whenReady().then(() => {
	mainWindow = createOverlayWindow();

	mainWindow.on("closed", () => {
		mainWindow = null;
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
