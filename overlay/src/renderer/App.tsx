import { useEffect } from "react";
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

function StatusIndicator({ state }: { state: OverlayState }) {
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

	return null;
}

export function App() {
	const { overlayState, errorMessage } = useDaemonState();
	const styles = getStateStyles(overlayState);

	const isRecording = overlayState === "recording";
	const isProcessing = overlayState === "processing";
	const showWaveform =
		overlayState === "recording" || overlayState === "processing";

	useEffect(() => {
		window.electronAPI?.notifyReady();
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

			<StatusIndicator state={overlayState} />

			{overlayState === "error" && errorMessage && (
				<span className="error-message">{errorMessage}</span>
			)}
		</div>
	);
}
