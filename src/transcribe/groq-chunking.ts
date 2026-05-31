import { logger } from "../utils/logger";
import { createPcmWavChunks, type WavAudioChunk } from "./wav-chunker";

export type GroqAudioFormat = "opus" | "wav";

export interface GroqChunkingOptions {
	enabled: boolean;
	minDurationSeconds: number;
	chunkSeconds: number;
	overlapSeconds: number;
	maxConcurrency: number;
	fallbackToFullAudio: boolean;
}

export interface GroqChunkingMetrics {
	enabled: boolean;
	used: boolean;
	chunkCount: number;
	chunkDurationSeconds: number;
	overlapSeconds: number;
	fallback: boolean;
	failureReason: string | null;
}

export type GroqSingleFileTranscriber = (
	audioBuffer: Buffer,
	language: string,
	boostWords: string[],
	format: GroqAudioFormat,
	recordingDurationMs?: number,
) => Promise<string>;

export interface GroqRecordingTranscriptionRequest {
	rawAudioBuffer: Buffer;
	fallbackAudioBuffer: Buffer;
	fallbackFormat: GroqAudioFormat;
	language?: string;
	boostWords?: string[];
	recordingDurationMs?: number;
	chunking: GroqChunkingOptions;
	transcribe: GroqSingleFileTranscriber;
}

export interface GroqRecordingTranscriptionResult {
	text: string;
	chunking: GroqChunkingMetrics;
}

export class GroqChunkedTranscriptionError extends Error {
	public override readonly name = "GroqChunkedTranscriptionError";
	public readonly chunking: GroqChunkingMetrics;
	public readonly cause: unknown;

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
		used: false,
		chunkCount: 0,
		chunkDurationSeconds: chunking.chunkSeconds,
		overlapSeconds: chunking.overlapSeconds,
		fallback: false,
		failureReason: null,
		...overrides,
	};
}

function normalizeTranscriptParts(parts: string[]): string {
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

function getFailureReason(error: unknown): string {
	const message = getErrorMessage(error);
	return message && message.length > 0 ? message : String(error);
}

async function mapChunksWithConcurrency(
	chunks: WavAudioChunk[],
	concurrency: number,
	mapper: (chunk: WavAudioChunk) => Promise<string>,
): Promise<string[]> {
	const workerCount = Math.min(
		Math.max(1, Math.floor(concurrency)),
		chunks.length,
	);
	const results: Array<string | undefined> = new Array(chunks.length);
	let nextIndex = 0;

	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (true) {
				const index = nextIndex;
				nextIndex++;

				if (index >= chunks.length) {
					return;
				}

				const chunk = chunks[index];
				if (!chunk) {
					return;
				}

				results[index] = await mapper(chunk);
			}
		}),
	);

	return results.map((result, index) => {
		if (result === undefined) {
			throw new Error(`Missing result for Groq chunk ${index}`);
		}
		return result;
	});
}

async function transcribeFullAudioFallback(
	request: GroqRecordingTranscriptionRequest,
	language: string,
	boostWords: string[],
	failureReason: string,
	chunkCount: number,
	cause: unknown,
): Promise<GroqRecordingTranscriptionResult> {
	const chunking = createGroqChunkingMetrics(request.chunking, {
		chunkCount,
		fallback: true,
		failureReason,
	});

	if (!request.chunking.fallbackToFullAudio) {
		throw new GroqChunkedTranscriptionError(failureReason, chunking, cause);
	}

	logger.warn(
		{
			failureReason,
			chunkCount,
			fallbackFormat: request.fallbackFormat,
			recordingDurationMs: request.recordingDurationMs,
		},
		"Groq chunked transcription failed; falling back to full audio",
	);

	try {
		const text = await request.transcribe(
			request.fallbackAudioBuffer,
			language,
			boostWords,
			request.fallbackFormat,
			request.recordingDurationMs,
		);

		return { text, chunking };
	} catch (fallbackError: unknown) {
		throw new GroqChunkedTranscriptionError(
			failureReason,
			chunking,
			fallbackError,
		);
	}
}

export async function transcribeGroqRecording(
	request: GroqRecordingTranscriptionRequest,
): Promise<GroqRecordingTranscriptionResult> {
	const language = request.language ?? "en";
	const boostWords = request.boostWords ?? [];
	const recordingDurationMs = request.recordingDurationMs ?? 0;
	const { chunking } = request;

	if (
		!chunking.enabled ||
		recordingDurationMs < chunking.minDurationSeconds * 1000
	) {
		const text = await request.transcribe(
			request.fallbackAudioBuffer,
			language,
			boostWords,
			request.fallbackFormat,
			request.recordingDurationMs,
		);
		return {
			text,
			chunking: createGroqChunkingMetrics(chunking),
		};
	}

	let chunks: WavAudioChunk[];
	let durationSeconds = 0;
	let dataBytesClamped = false;
	let dataBytesTrimmed = false;
	try {
		const plan = createPcmWavChunks(request.rawAudioBuffer, {
			chunkSeconds: chunking.chunkSeconds,
			overlapSeconds: chunking.overlapSeconds,
			minDurationSeconds: chunking.minDurationSeconds,
		});
		chunks = plan.chunks;
		durationSeconds = plan.durationSeconds;
		dataBytesClamped = plan.dataBytesClamped;
		dataBytesTrimmed = plan.dataBytesTrimmed;

		if (!plan.chunked) {
			const text = await request.transcribe(
				request.fallbackAudioBuffer,
				language,
				boostWords,
				request.fallbackFormat,
				request.recordingDurationMs,
			);
			return {
				text,
				chunking: createGroqChunkingMetrics(chunking),
			};
		}
	} catch (error: unknown) {
		const failureReason = `chunk_preparation_failed: ${getFailureReason(error)}`;
		return transcribeFullAudioFallback(
			request,
			language,
			boostWords,
			failureReason,
			0,
			error,
		);
	}

	try {
		logger.info(
			{
				chunkCount: chunks.length,
				chunkSeconds: chunking.chunkSeconds,
				overlapSeconds: chunking.overlapSeconds,
				maxConcurrency: chunking.maxConcurrency,
				durationSeconds,
				dataBytesClamped,
				dataBytesTrimmed,
			},
			"Groq chunked transcription started",
		);

		const transcripts = await mapChunksWithConcurrency(
			chunks,
			chunking.maxConcurrency,
			async (chunk) =>
				request.transcribe(
					chunk.buffer,
					language,
					boostWords,
					"wav",
					Math.round(chunk.durationSeconds * 1000),
				),
		);
		const text = normalizeTranscriptParts(transcripts);

		logger.info(
			{
				chunkCount: chunks.length,
				textLength: text.length,
			},
			"Groq chunked transcription success",
		);

		return {
			text,
			chunking: createGroqChunkingMetrics(chunking, {
				used: true,
				chunkCount: chunks.length,
			}),
		};
	} catch (error: unknown) {
		const failureReason = `chunk_request_failed: ${getFailureReason(error)}`;
		return transcribeFullAudioFallback(
			request,
			language,
			boostWords,
			failureReason,
			chunks.length,
			error,
		);
	}
}
