import { useCallback, useEffect, useState } from "react";
import type {
	ConnectionStatus,
	DaemonState,
	DaemonStatus,
} from "../ipc-client";

export type OverlayState =
	| "hidden"
	| "connecting"
	| "listening"
	| "recording"
	| "processing"
	| "success"
	| "error";

interface UseDaemonStateResult {
	overlayState: OverlayState;
	daemonState: DaemonState;
	connectionStatus: ConnectionStatus;
	errorMessage?: string;
}

function mapDaemonToOverlay(
	daemonStatus: DaemonStatus,
	connectionStatus: ConnectionStatus,
): OverlayState {
	if (connectionStatus !== "connected") {
		return "connecting";
	}

	switch (daemonStatus) {
		case "idle":
			return "hidden";
		case "starting":
			return "listening";
		case "recording":
			return "recording";
		case "stopping":
		case "processing":
			return "processing";
		case "error":
			return "error";
		default:
			return "hidden";
	}
}

export function useDaemonState(): UseDaemonStateResult {
	const [daemonState, setDaemonState] = useState<DaemonState>({
		status: "idle",
	});
	const [connectionStatus, setConnectionStatus] =
		useState<ConnectionStatus>("disconnected");
	const [showSuccess, setShowSuccess] = useState(false);

	useEffect(() => {
		const api = window.electronAPI;
		if (!api) {
			return;
		}

		const unsubState = api.onDaemonState((state: DaemonState) => {
			const wasProcessing = daemonState.status === "processing";
			const nowIdle = state.status === "idle";

			setDaemonState(state);

			if (wasProcessing && nowIdle && state.lastTranscription) {
				setShowSuccess(true);
				setTimeout(() => setShowSuccess(false), 1500);
			}
		});

		const unsubConnection = api.onConnectionStatus(
			(status: ConnectionStatus) => {
				setConnectionStatus(status);
			},
		);

		void api.getDaemonState().then(setDaemonState);
		void api.getConnectionStatus().then(setConnectionStatus);

		return () => {
			unsubState();
			unsubConnection();
		};
	}, [daemonState.status]);

	const getOverlayState = useCallback((): OverlayState => {
		if (showSuccess) {
			return "success";
		}
		return mapDaemonToOverlay(daemonState.status, connectionStatus);
	}, [daemonState.status, connectionStatus, showSuccess]);

	return {
		overlayState: getOverlayState(),
		daemonState,
		connectionStatus,
		errorMessage: daemonState.error,
	};
}
