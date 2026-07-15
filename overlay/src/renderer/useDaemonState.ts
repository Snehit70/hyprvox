import { useCallback, useEffect, useRef, useState } from "react";
import type {
	AudioLevelMessage,
	ConnectionStatus,
	DaemonState,
	DaemonStatus,
} from "../shared/ipc-types";

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
	audioLevel: AudioLevelMessage | null;
}

const ERROR_HIDE_DELAY_MS = 3000;

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
	const [hideError, setHideError] = useState(false);
	const [reconnectExhausted, setReconnectExhausted] = useState(false);
	const [audioLevel, setAudioLevel] = useState<AudioLevelMessage | null>(null);
	const prevStatusRef = useRef<DaemonStatus>("idle");
	const errorTimeoutRef = useRef<number | null>(null);

	useEffect(() => {
		const api = window.electronAPI;
		if (!api) {
			return;
		}

		const handleDaemonState = (state: DaemonState): void => {
			const wasProcessing = prevStatusRef.current === "processing";
			prevStatusRef.current = state.status;

			setDaemonState(state);

			if (errorTimeoutRef.current !== null) {
				window.clearTimeout(errorTimeoutRef.current);
				errorTimeoutRef.current = null;
			}

			if (state.status === "error") {
				setHideError(false);
				errorTimeoutRef.current = window.setTimeout(() => {
					setHideError(true);
					errorTimeoutRef.current = null;
				}, ERROR_HIDE_DELAY_MS);
			} else {
				setHideError(false);
			}

			if (state.status !== "recording") {
				setAudioLevel(null);
			}

			if (wasProcessing && state.status === "idle" && state.lastTranscription) {
				setShowSuccess(true);
				setTimeout(() => setShowSuccess(false), 1500);
			}
		};

		const unsubState = api.onDaemonState(handleDaemonState);

		const unsubConnection = api.onConnectionStatus(
			(status: ConnectionStatus) => {
				if (status !== "disconnected") {
					setReconnectExhausted(false);
				}
				setConnectionStatus(status);
			},
		);

		const unsubReconnectExhausted = api.onReconnectExhausted(() => {
			setReconnectExhausted(true);
		});

		const unsubAudioLevel = api.onAudioLevel(
			(nextAudioLevel: AudioLevelMessage) => {
				setAudioLevel(nextAudioLevel);
			},
		);

		void api.getDaemonState().then(handleDaemonState);
		void api.getConnectionStatus().then(setConnectionStatus);

		return () => {
			if (errorTimeoutRef.current !== null) {
				window.clearTimeout(errorTimeoutRef.current);
			}
			unsubState();
			unsubConnection();
			unsubReconnectExhausted();
			unsubAudioLevel();
		};
	}, []);

	const getOverlayState = useCallback((): OverlayState => {
		if (showSuccess) {
			return "success";
		}
		if (reconnectExhausted) {
			return "hidden";
		}
		if (hideError && daemonState.status === "error") {
			return "hidden";
		}
		return mapDaemonToOverlay(daemonState.status, connectionStatus);
	}, [
		daemonState.status,
		connectionStatus,
		showSuccess,
		reconnectExhausted,
		hideError,
	]);

	return {
		overlayState: getOverlayState(),
		daemonState,
		connectionStatus,
		errorMessage: daemonState.error,
		audioLevel,
	};
}
