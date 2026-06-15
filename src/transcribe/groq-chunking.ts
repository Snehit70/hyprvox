export type GroqAudioFormat = "opus" | "wav";

export interface GroqChunkingOptions {
	enabled: boolean;
	mode: "live";
	minDurationSeconds: number;
	chunkSeconds: number;
	overlapSeconds: number;
	maxConcurrency: number;
	chunkMaxRetries: number;
	chunkRetryBackoffMs: number;
	liveFinalizeTimeoutMs: number;
	fallbackToFullAudio: boolean;
	logChunkTranscripts: boolean;
}

export interface GroqChunkingMetrics {
	enabled: boolean;
	mode: "live";
	used: boolean;
	chunkCount: number;
	chunkDurationSeconds: number;
	overlapSeconds: number;
	fallback: boolean;
	failureReason: string | null;
	liveCompletedBeforeStop: boolean;
	livePreStopCompletedChunks: number;
	livePostStopWaitMs: number;
	liveFinalizeTimedOut: boolean;
	liveFinalTailMs: number;
	liveBackgroundRequestMs: number;
	liveDroppedChunks: number;
	liveRecoveredChunks: number;
}

export type GroqSingleFileTranscriber = (
	audioBuffer: Buffer,
	language: string,
	boostWords: string[],
	format: GroqAudioFormat,
	recordingDurationMs?: number,
	contextHint?: string,
	signal?: AbortSignal,
) => Promise<string>;

export class GroqChunkingError extends Error {
	public override readonly name = "GroqChunkingError";
	public readonly chunking: GroqChunkingMetrics;
	public override readonly cause: unknown;

	public constructor(
		message: string,
		chunking: GroqChunkingMetrics,
		cause: unknown,
	) {
		super(message);
		this.chunking = chunking;
		this.cause = cause;
	}
}

export function createGroqChunkingMetrics(
	chunking: GroqChunkingOptions,
	overrides: Partial<GroqChunkingMetrics> = {},
): GroqChunkingMetrics {
	return {
		enabled: chunking.enabled,
		mode: chunking.mode,
		used: false,
		chunkCount: 0,
		chunkDurationSeconds: chunking.chunkSeconds,
		overlapSeconds: chunking.overlapSeconds,
		fallback: false,
		failureReason: null,
		liveCompletedBeforeStop: false,
		livePreStopCompletedChunks: 0,
		livePostStopWaitMs: -1,
		liveFinalizeTimedOut: false,
		liveFinalTailMs: -1,
		liveBackgroundRequestMs: -1,
		liveDroppedChunks: 0,
		liveRecoveredChunks: 0,
		...overrides,
	};
}

export function normalizeTranscriptParts(parts: string[]): string {
	return parts
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
}

function getErrorMessage(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("message" in error)) {
		return undefined;
	}

	const { message } = error as { message?: unknown };
	return typeof message === "string" ? message : undefined;
}

export function getFailureReason(error: unknown): string {
	const message = getErrorMessage(error);
	return message && message.length > 0 ? message : String(error);
}
