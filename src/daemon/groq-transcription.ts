import {
	createGroqChunkingMetrics,
	GroqChunkingError,
	type GroqAudioFormat,
	type GroqChunkingMetrics,
	type GroqChunkingOptions,
} from "../transcribe/groq-chunking";
import type { GroqLiveChunkSession } from "../transcribe/groq-live-chunking";
import { logger } from "../utils/logger";

interface RunGroqTranscriptionInput {
	liveSession?: GroqLiveChunkSession;
	audioBufferToTranscribe: Buffer;
	audioFormat: GroqAudioFormat;
	language: string;
	boostWords: string[];
	recordingDurationMs: number;
	chunking: GroqChunkingOptions;
	transcribe: (
		audioBuffer: Buffer,
		language: string,
		boostWords: string[],
		format: GroqAudioFormat,
		recordingDurationMs?: number,
		contextHint?: string,
		signal?: AbortSignal,
	) => Promise<string>;
}

interface RunGroqTranscriptionResult {
	text: string;
	chunking: GroqChunkingMetrics;
}

export async function runGroqTranscriptionWithLiveSession(
	input: RunGroqTranscriptionInput,
): Promise<RunGroqTranscriptionResult> {
	const {
		liveSession,
		audioBufferToTranscribe,
		audioFormat,
		language,
		boostWords,
		recordingDurationMs,
		chunking,
		transcribe,
	} = input;

	if (liveSession) {
		const liveResult = await liveSession.finish();
		if (liveResult.kind === "ready") {
			return {
				text: liveResult.text,
				chunking: liveResult.chunking,
			};
		}

		if (liveResult.kind === "fallback") {
			if (!chunking.fallbackToFullAudio) {
				throw new GroqChunkingError(
					liveResult.failureReason,
					liveResult.chunking,
					new Error(liveResult.failureReason),
				);
			}

			logger.warn(
				{
					failureReason: liveResult.failureReason,
					recordingDurationMs,
				},
				"Live Groq chunking failed; falling back to full audio",
			);

			try {
				const text = await transcribe(
					audioBufferToTranscribe,
					language,
					boostWords,
					audioFormat,
					recordingDurationMs,
				);
				return {
					text,
					chunking: liveResult.chunking,
				};
			} catch (fallbackError: unknown) {
				throw new GroqChunkingError(
					liveResult.failureReason,
					liveResult.chunking,
					fallbackError,
				);
			}
		}
	}

	const text = await transcribe(
		audioBufferToTranscribe,
		language,
		boostWords,
		audioFormat,
		recordingDurationMs,
	);
	return {
		text,
		chunking: createGroqChunkingMetrics(chunking),
	};
}
