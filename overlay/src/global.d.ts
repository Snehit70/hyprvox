import type { ConnectionStatus, DaemonState } from "./shared/ipc-types";

export interface ElectronAPI {
	onToggleListening: (callback: () => void) => () => void;
	notifyReady: () => void;
	onDaemonState: (callback: (state: DaemonState) => void) => () => void;
	onConnectionStatus: (
		callback: (status: ConnectionStatus) => void,
	) => () => void;
	onReconnectExhausted: (callback: () => void) => () => void;
	getDaemonState: () => Promise<DaemonState>;
	getConnectionStatus: () => Promise<ConnectionStatus>;
	setOverlayVisible: (visible: boolean) => void;
}

declare global {
	interface Window {
		electronAPI?: ElectronAPI;
	}
}
