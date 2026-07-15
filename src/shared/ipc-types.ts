export type DaemonStatus =
	| "idle"
	| "starting"
	| "recording"
	| "stopping"
	| "processing"
	| "error";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface DaemonState {
	status: DaemonStatus;
	lastTranscription?: string;
	error?: string;
	timestamp?: number;
}

export interface AudioLevelMessage {
	type: "audio_level";
	level: number;
	peak?: number;
	timestamp: number;
}

export interface ActionMessage {
	type: "action";
	action: "soniox-toggle";
}

// Sent overlay -> daemon once the renderer has painted a state. `forTimestamp`
// echoes the state message's own timestamp, which is what joins this to the
// daemon-side trigger trace.
export interface PerfPaintMessage {
	type: "perf_paint";
	forTimestamp: number;
	paintedAt: number;
}

export type IPCMessage =
	| {
			type: "hello" | "state";
			version?: number;
			status?: DaemonStatus;
			lastTranscription?: string;
			error?: string;
			timestamp?: number;
	  }
	| AudioLevelMessage
	| ActionMessage
	| PerfPaintMessage;
