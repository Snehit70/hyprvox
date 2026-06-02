import type { Config } from "../config/schema";
import type { StreamingStopReason } from "../transcribe/deepgram-streaming";
import {
	createGroqChunkingMetrics,
	type GroqChunkingMetrics,
} from "../transcribe/groq-chunking";
import type { MergeReason, MergeStrategy } from "../transcribe/merger";
import type { TranscriptQualityReason } from "../transcribe/quality";

export type AudioFormatStrategy = "opus" | "raw";

export interface TranscriptionMetrics {
	totalMs: number;
	processingMs: number;
	conversionMs: number;
	groqMs: number;
	deepgramMs: number;
	mergeMs: number;
	clipboardMs: number;
	statsWriteMs: number;
	historyAppendMs: number;
	notificationEnqueueMs: number;
	rawAudioBytes: number;
	recordingDurationMs: number;
	convertedAudioBytes: number;
	streamingEnabled: boolean;
	audioFormatStrategy: AudioFormatStrategy;
	mergeStrategy: MergeStrategy | "skip_no_speech" | "skip_hallucination";
	mergeReason: MergeReason | null;
	validationReasons: TranscriptQualityReason[];
	validationRetryCount: number;
	validationFallbackSource: "none" | "groq" | "deepgram";
	trimmedHallucinationSuffix: boolean;
	longRecordingMode: boolean;
	longRecordingFallbackSource: "none" | "groq" | "deepgram";
	suspiciousMergeExpansion: boolean;
	deepgramStopReason: StreamingStopReason | null;
	deepgramStopWallMs: number;
	deepgramCriticalPathMs: number;
	deepgramOverlapMs: number;
	deepgramStartedEarly: boolean;
	deepgramFinalizeWaitMs: number;
	deepgramCloseWaitMs: number;
	deepgramEndpointingMs: number;
	deepgramReceivedFinalChunk: boolean;
	deepgramHadSpeechFinal: boolean;
	groqChunkingEnabled: boolean;
	groqChunkingUsed: boolean;
	groqChunkCount: number;
	groqChunkDurationSeconds: number;
	groqChunkOverlapSeconds: number;
	groqChunkFallback: boolean;
	groqChunkFailureReason: string | null;
	groqChunkMode: "live";
	groqLiveCompletedBeforeStop: boolean;
	groqLivePreStopCompletedChunks: number;
	groqLivePostStopWaitMs: number;
	groqLiveFinalizeTimedOut: boolean;
	groqLiveFinalTailMs: number;
	groqLiveBackgroundRequestMs: number;
	groqLiveDroppedChunks: number;
	groqLiveRecoveredChunks: number;
	groqLiveQualityFallback: boolean;
	groqLiveQualityFallbackReason: string | null;
	engine: string;
	textLength: number;
	groqTextLength: number;
	deepgramTextLength: number;
	groqSttModel: string;
	deepgramModel: string;
	mergeModel: string;
}

type GroqChunkingMetricFields = Pick<
	TranscriptionMetrics,
	| "groqChunkingEnabled"
	| "groqChunkingUsed"
	| "groqChunkCount"
	| "groqChunkDurationSeconds"
	| "groqChunkOverlapSeconds"
	| "groqChunkFallback"
	| "groqChunkFailureReason"
	| "groqChunkMode"
	| "groqLiveCompletedBeforeStop"
	| "groqLivePreStopCompletedChunks"
	| "groqLivePostStopWaitMs"
	| "groqLiveFinalizeTimedOut"
	| "groqLiveFinalTailMs"
	| "groqLiveBackgroundRequestMs"
	| "groqLiveDroppedChunks"
	| "groqLiveRecoveredChunks"
	| "groqLiveQualityFallback"
	| "groqLiveQualityFallbackReason"
>;

export function toGroqChunkingMetricFields(
	chunking: GroqChunkingMetrics,
): GroqChunkingMetricFields {
	return {
		groqChunkingEnabled: chunking.enabled,
		groqChunkingUsed: chunking.used,
		groqChunkCount: chunking.chunkCount,
		groqChunkDurationSeconds: chunking.chunkDurationSeconds,
		groqChunkOverlapSeconds: chunking.overlapSeconds,
		groqChunkFallback: chunking.fallback,
		groqChunkFailureReason: chunking.failureReason,
		groqChunkMode: chunking.mode,
		groqLiveCompletedBeforeStop: chunking.liveCompletedBeforeStop,
		groqLivePreStopCompletedChunks: chunking.livePreStopCompletedChunks,
		groqLivePostStopWaitMs: chunking.livePostStopWaitMs,
		groqLiveFinalizeTimedOut: chunking.liveFinalizeTimedOut,
		groqLiveFinalTailMs: chunking.liveFinalTailMs,
		groqLiveBackgroundRequestMs: chunking.liveBackgroundRequestMs,
		groqLiveDroppedChunks: chunking.liveDroppedChunks,
		groqLiveRecoveredChunks: chunking.liveRecoveredChunks,
		groqLiveQualityFallback: false,
		groqLiveQualityFallbackReason: null,
	};
}

export function createInitialTranscriptionMetrics(
	config: Config,
	rawAudioBytes: number,
	recordingDurationMs: number,
): TranscriptionMetrics {
	const initialGroqChunkingMetrics = createGroqChunkingMetrics(
		config.transcription.groqChunking,
	);

	return {
		totalMs: 0,
		processingMs: 0,
		conversionMs: -1,
		groqMs: -1,
		deepgramMs: -1,
		mergeMs: -1,
		clipboardMs: -1,
		statsWriteMs: -1,
		historyAppendMs: -1,
		notificationEnqueueMs: -1,
		rawAudioBytes,
		recordingDurationMs,
		convertedAudioBytes: -1,
		streamingEnabled: !!config.transcription.streaming,
		audioFormatStrategy: "raw",
		mergeStrategy: "skip_no_speech",
		mergeReason: null,
		validationReasons: [],
		validationRetryCount: 0,
		validationFallbackSource: "none",
		trimmedHallucinationSuffix: false,
		longRecordingMode: false,
		longRecordingFallbackSource: "none",
		suspiciousMergeExpansion: false,
		deepgramStopReason: null,
		deepgramStopWallMs: -1,
		deepgramCriticalPathMs: -1,
		deepgramOverlapMs: 0,
		deepgramStartedEarly: false,
		deepgramFinalizeWaitMs: -1,
		deepgramCloseWaitMs: -1,
		deepgramEndpointingMs: -1,
		deepgramReceivedFinalChunk: false,
		deepgramHadSpeechFinal: false,
		...toGroqChunkingMetricFields(initialGroqChunkingMetrics),
		engine: "",
		textLength: 0,
		groqTextLength: 0,
		deepgramTextLength: 0,
		groqSttModel: "whisper-large-v3",
		deepgramModel: "nova-3",
		mergeModel: config.transcription.mergeModel,
	};
}
