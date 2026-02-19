import { contextBridge, ipcRenderer } from "electron";
import type { ConnectionStatus, DaemonState } from "./ipc-client";

const electronAPI = {
	onToggleListening: (callback: () => void): (() => void) => {
		const handler = (): void => callback();
		ipcRenderer.on("toggle-listening", handler);
		return () => ipcRenderer.removeListener("toggle-listening", handler);
	},
	notifyReady: (): void => {
		ipcRenderer.send("window-ready");
	},
	onDaemonState: (callback: (state: DaemonState) => void): (() => void) => {
		const handler = (
			_event: Electron.IpcRendererEvent,
			state: DaemonState,
		): void => callback(state);
		ipcRenderer.on("daemon-state", handler);
		return () => ipcRenderer.removeListener("daemon-state", handler);
	},
	onConnectionStatus: (
		callback: (status: ConnectionStatus) => void,
	): (() => void) => {
		const handler = (
			_event: Electron.IpcRendererEvent,
			status: ConnectionStatus,
		): void => callback(status);
		ipcRenderer.on("connection-status", handler);
		return () => ipcRenderer.removeListener("connection-status", handler);
	},
	getDaemonState: (): Promise<DaemonState> => {
		return ipcRenderer.invoke("get-daemon-state");
	},
	getConnectionStatus: (): Promise<ConnectionStatus> => {
		return ipcRenderer.invoke("get-connection-status");
	},
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
