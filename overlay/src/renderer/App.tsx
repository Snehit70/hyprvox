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
				<svg
					className="checkmark"
					viewBox="0 0 24 24"
					width="24"
					height="24"
					fill="none"
					stroke="currentColor"
					strokeWidth="3"
					aria-label="Success"
					role="img"
				>
					<title>Success</title>
					<polyline points="20 6 9 17 4 12" />
				</svg>
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

export function App() {
	const { overlayState, errorMessage } = useDaemonState();
	const styles = getStateStyles(overlayState);

	const isRecording = overlayState === "recording";
	const isProcessing = overlayState === "processing";
	const showWaveform = overlayState === "recording";
	const nextIndicatorState = getIndicatorState(overlayState);
	const [currentIndicator, setCurrentIndicator] =
		useState<IndicatorState | null>(nextIndicatorState);
	const [leavingIndicator, setLeavingIndicator] =
		useState<IndicatorState | null>(null);
	const [isAnimatingIndicator, setIsAnimatingIndicator] = useState(false);
	const indicatorTimeoutRef = useRef<number | null>(null);

	useEffect(() => {
		window.electronAPI?.notifyReady();
	}, []);

	useEffect(() => {
		if (nextIndicatorState === currentIndicator) {
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

		setLeavingIndicator(currentIndicator);
		setCurrentIndicator(nextIndicatorState);
		setIsAnimatingIndicator(true);

		indicatorTimeoutRef.current = window.setTimeout(() => {
			setLeavingIndicator(null);
			setIsAnimatingIndicator(false);
			indicatorTimeoutRef.current = null;
		}, 280);
	}, [nextIndicatorState, currentIndicator]);

	useEffect(() => {
		return () => {
			if (indicatorTimeoutRef.current !== null) {
				window.clearTimeout(indicatorTimeoutRef.current);
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
					style={{ width: "100%", height: "100%" }}
				/>
			)}

			<div className="status-stack" aria-hidden="true">
				{leavingIndicator && isAnimatingIndicator && (
					<div className="status-layer status-layer-leave">
						<StatusIndicator state={leavingIndicator} />
					</div>
				)}
				{currentIndicator && (
					<div
						className={`status-layer ${isAnimatingIndicator ? "status-layer-enter" : ""}`}
					>
						<StatusIndicator state={currentIndicator} />
					</div>
				)}
			</div>

			{overlayState === "error" && errorMessage && (
				<span className="error-message">{errorMessage}</span>
			)}
		</div>
	);
}
