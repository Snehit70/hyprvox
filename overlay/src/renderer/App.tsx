import { useEffect, useRef, useState } from "react";
import { LiveWaveform } from "./LiveWaveform";
import { type OverlayState, useDaemonState } from "./useDaemonState";
import "./styles.css";

function getStateStyles(state: OverlayState): {
	background: string;
	opacity: number;
	display: string;
} {
	switch (state) {
		case "hidden":
			return {
				background: "transparent",
				opacity: 0,
				display: "none",
			};
		case "connecting":
			return {
				background: "rgba(30, 30, 40, 0.7)",
				opacity: 0.7,
				display: "flex",
			};
		case "listening":
		case "recording":
			return {
				background: "rgba(10, 10, 15, 0.6)",
				opacity: 1,
				display: "flex",
			};
		case "processing":
			return {
				background: "rgba(10, 10, 15, 0.6)",
				opacity: 1,
				display: "flex",
			};
		case "success":
			return {
				background: "rgba(16, 185, 129, 0.3)",
				opacity: 1,
				display: "flex",
			};
		case "error":
			return {
				background: "rgba(239, 68, 68, 0.3)",
				opacity: 1,
				display: "flex",
			};
	}
}

type IndicatorState = Exclude<OverlayState, "hidden" | "recording">;

interface AnimatedIndicator {
	state: IndicatorState;
	key: number;
}

function StatusIndicator({ state }: { state: IndicatorState }) {
	if (state === "connecting") {
		return (
			<div className="status-indicator connecting">
				<div className="connecting-dots">
					<span className="dot" />
					<span className="dot" />
					<span className="dot" />
				</div>
				<span className="status-text">Connecting...</span>
			</div>
		);
	}

	if (state === "listening") {
		return (
			<div className="status-indicator listening">
				<span className="status-text">Listening...</span>
			</div>
		);
	}

	if (state === "success") {
		return (
			<div className="status-indicator success">
				<span className="checkmark-badge" aria-label="Success" role="img">
					<svg
						className="checkmark-circle-icon"
						viewBox="0 0 24 24"
						width="30"
						height="30"
						fill="none"
					>
						<title>Success</title>
						<circle cx="12" cy="12" r="9" />
						<polyline points="8.5 12.5 11 15 15.5 9.5" />
					</svg>
				</span>
			</div>
		);
	}

	if (state === "error") {
		return (
			<div className="status-indicator error">
				<svg
					className="error-icon"
					viewBox="0 0 24 24"
					width="24"
					height="24"
					fill="none"
					stroke="currentColor"
					strokeWidth="3"
					aria-label="Error"
					role="img"
				>
					<title>Error</title>
					<line x1="18" y1="6" x2="6" y2="18" />
					<line x1="6" y1="6" x2="18" y2="18" />
				</svg>
			</div>
		);
	}

	if (state === "processing") {
		return (
			<div className="status-indicator processing">
				<span className="shimmering-text">Transcribing...</span>
			</div>
		);
	}

	return null;
}

function getIndicatorState(state: OverlayState): IndicatorState | null {
	if (state === "hidden" || state === "recording") {
		return null;
	}

	return state;
}

function getAriaStatusText(state: OverlayState, errorMessage?: string): string {
	switch (state) {
		case "connecting":
			return "Connecting";
		case "listening":
			return "Listening";
		case "recording":
			return "Recording";
		case "processing":
			return "Transcribing";
		case "success":
			return "Transcription copied";
		case "error":
			return errorMessage ? `Error: ${errorMessage}` : "Error";
		case "hidden":
		default:
			return "";
	}
}

export function App() {
	const { overlayState, errorMessage } = useDaemonState();
	const styles = getStateStyles(overlayState);

	const isRecording = overlayState === "recording";
	const isProcessing = overlayState === "processing";
	const nextIndicatorState = getIndicatorState(overlayState);
	const ariaStatusText = getAriaStatusText(overlayState, errorMessage);
	const [currentIndicator, setCurrentIndicator] =
		useState<AnimatedIndicator | null>(
			nextIndicatorState ? { state: nextIndicatorState, key: 0 } : null,
		);
	const [leavingIndicator, setLeavingIndicator] =
		useState<AnimatedIndicator | null>(null);
	const [isAnimatingIndicator, setIsAnimatingIndicator] = useState(false);
	const [waveformExiting, setWaveformExiting] = useState(false);
	const indicatorTimeoutRef = useRef<number | null>(null);
	const waveformTimeoutRef = useRef<number | null>(null);
	const transitionKeyRef = useRef(0);

	const showWaveform = isRecording || waveformExiting;

	useEffect(() => {
		window.electronAPI?.notifyReady();
	}, []);

	useEffect(() => {
		if (nextIndicatorState === currentIndicator?.state) {
			return;
		}

		if (indicatorTimeoutRef.current !== null) {
			window.clearTimeout(indicatorTimeoutRef.current);
			indicatorTimeoutRef.current = null;
		}

		if (nextIndicatorState === null) {
			setLeavingIndicator(null);
			setCurrentIndicator(null);
			setIsAnimatingIndicator(false);
			return;
		}

		transitionKeyRef.current += 1;
		const nextIndicator: AnimatedIndicator = {
			state: nextIndicatorState,
			key: transitionKeyRef.current,
		};

		setLeavingIndicator(currentIndicator);
		setCurrentIndicator(nextIndicator);
		setIsAnimatingIndicator(true);

		indicatorTimeoutRef.current = window.setTimeout(() => {
			setLeavingIndicator(null);
			setIsAnimatingIndicator(false);
			indicatorTimeoutRef.current = null;
		}, 320);
	}, [nextIndicatorState, currentIndicator]);

	useEffect(() => {
		if (overlayState === "recording") {
			if (waveformTimeoutRef.current !== null) {
				window.clearTimeout(waveformTimeoutRef.current);
				waveformTimeoutRef.current = null;
			}
			setWaveformExiting(false);
			return;
		}

		if (overlayState === "processing") {
			setWaveformExiting(true);

			if (waveformTimeoutRef.current !== null) {
				window.clearTimeout(waveformTimeoutRef.current);
			}

			waveformTimeoutRef.current = window.setTimeout(() => {
				setWaveformExiting(false);
				waveformTimeoutRef.current = null;
			}, 180);
			return;
		}

		if (waveformTimeoutRef.current !== null) {
			window.clearTimeout(waveformTimeoutRef.current);
			waveformTimeoutRef.current = null;
		}
		setWaveformExiting(false);
	}, [overlayState]);

	useEffect(() => {
		return () => {
			if (indicatorTimeoutRef.current !== null) {
				window.clearTimeout(indicatorTimeoutRef.current);
			}

			if (waveformTimeoutRef.current !== null) {
				window.clearTimeout(waveformTimeoutRef.current);
			}
		};
	}, []);

	if (overlayState === "hidden") {
		return null;
	}

	return (
		<div
			className={`overlay-container state-${overlayState}`}
			style={{
				width: "100%",
				height: "100%",
				background: styles.background,
				borderRadius: "8px",
				display: styles.display,
				alignItems: "center",
				justifyContent: "center",
				position: "relative",
				opacity: styles.opacity,
				transition: "background 0.3s ease, opacity 0.3s ease",
			}}
		>
			{showWaveform && (
				<LiveWaveform
					active={isRecording}
					processing={isProcessing}
					mode="static"
					barColor="rgba(255, 255, 255, 0.9)"
					barWidth={3}
					barGap={2}
					barRadius={1.5}
					height={50}
					fadeEdges={true}
					style={{
						width: "100%",
						height: "100%",
						opacity: waveformExiting ? 0 : 1,
						transition: "opacity 0.18s ease-out",
					}}
				/>
			)}

			<div className="status-stack" aria-hidden="true">
				{leavingIndicator && isAnimatingIndicator && (
					<div
						className="status-layer status-layer-leave"
						key={`leave-${leavingIndicator.key}`}
					>
						<StatusIndicator state={leavingIndicator.state} />
					</div>
				)}
				{currentIndicator && (
					<div
						className={`status-layer ${isAnimatingIndicator ? "status-layer-enter" : ""}`}
						key={`current-${currentIndicator.key}`}
					>
						<StatusIndicator state={currentIndicator.state} />
					</div>
				)}
			</div>

			<output className="sr-only" aria-live="polite" aria-atomic="true">
				{ariaStatusText}
			</output>

			{overlayState === "error" && errorMessage && (
				<span className="error-message">{errorMessage}</span>
			)}
		</div>
	);
}
