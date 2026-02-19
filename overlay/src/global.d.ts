import type { ConnectionStatus, DaemonState } from "./ipc-client";

export interface ElectronAPI {
	onToggleListening: (callback: () => void) => () => void;
	notifyReady: () => void;
	onDaemonState: (callback: (state: DaemonState) => void) => () => void;
	onConnectionStatus: (
		callback: (status: ConnectionStatus) => void,
	) => () => void;
	getDaemonState: () => Promise<DaemonState>;
	getConnectionStatus: () => Promise<ConnectionStatus>;
}

declare global {
	interface Window {
		electronAPI?: ElectronAPI;
	}
}
