import { contextBridge, ipcRenderer } from "electron";
import type {
	AudioLevelMessage,
	ConnectionStatus,
	DaemonState,
} from "./shared/ipc-types";

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
	onReconnectExhausted: (callback: () => void): (() => void) => {
		const handler = (): void => callback();
		ipcRenderer.on("reconnect-exhausted", handler);
		return () => ipcRenderer.removeListener("reconnect-exhausted", handler);
	},
	onAudioLevel: (
		callback: (audioLevel: AudioLevelMessage) => void,
	): (() => void) => {
		const handler = (
			_event: Electron.IpcRendererEvent,
			audioLevel: AudioLevelMessage,
		): void => callback(audioLevel);
		ipcRenderer.on("audio-level", handler);
		return () => ipcRenderer.removeListener("audio-level", handler);
	},
	getDaemonState: (): Promise<DaemonState> => {
		return ipcRenderer.invoke("get-daemon-state");
	},
	getConnectionStatus: (): Promise<ConnectionStatus> => {
		return ipcRenderer.invoke("get-connection-status");
	},
	setOverlayVisible: (visible: boolean): void => {
		ipcRenderer.send("overlay-visible", visible);
	},
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);

export type ElectronAPI = typeof electronAPI;
