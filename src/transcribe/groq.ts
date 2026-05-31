import Groq from "groq-sdk";
import { toFile } from "groq-sdk/uploads";
import { loadConfig } from "../config/loader";
import { TranscriptionError } from "../utils/errors";
import { logError, logger } from "../utils/logger";
import { withRetry } from "../utils/retry";
import { createPcmWavChunks, type WavAudioChunk } from "./wav-chunker";

const BASE_TRANSCRIPTION_PROMPT = [
	"Technical English dictation about software development, Linux, and AI.",
	"Preserve commands, filenames, acronyms, project names, and code terms exactly.",
	"When the speaker clearly dictates structure, prefer literal symbols for braces, brackets, parentheses, colons, commas, quotes, and slashes.",
	"Preserve numbered list cues like first, second, and third when spoken.",
].join(" ");
const MAX_TRANSCRIPTION_PROMPT_CHARS = 896;

function fitBoostWordsInPrompt(boostWords: string[]): string[] {
	const prefix = `${BASE_TRANSCRIPTION_PROMPT} Prefer these terms: `;
	const suffix = ".";
	const availableChars =
		MAX_TRANSCRIPTION_PROMPT_CHARS - prefix.length - suffix.length;
	if (availableChars <= 0) return [];

	const terms: string[] = [];
	let usedChars = 0;

	for (const word of boostWords) {
		const term = word.trim().replace(/\s+/g, " ");
		if (!term) continue;

		const separatorLength = terms.length === 0 ? 0 : 2;
		const nextLength = separatorLength + term.length;
		if (usedChars + nextLength > availableChars) break;

		terms.push(term);
		usedChars += nextLength;
	}

	return terms;
}

function buildTranscriptionPrompt(boostWords: string[]): string {
	const fittedBoostWords = fitBoostWordsInPrompt(boostWords);
	if (fittedBoostWords.length === 0) {
		return BASE_TRANSCRIPTION_PROMPT;
	}

	return `${BASE_TRANSCRIPTION_PROMPT} Prefer these terms: ${fittedBoostWords.join(", ")}.`;
}

function getErrorStatus(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null || !("status" in error)) {
		return undefined;
	}

	const { status } = error as { status?: unknown };
	return typeof status === "number" ? status : undefined;
}

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

export interface GroqChunkedTranscriptionRequest {
	rawAudioBuffer: Buffer;
	fallbackAudioBuffer: Buffer;
	fallbackFormat: "opus" | "wav";
	language?: string;
	boostWords?: string[];
	recordingDurationMs?: number;
	chunking: GroqChunkingOptions;
}

export interface GroqChunkedTranscriptionResult {
	text: string;
	chunking: GroqChunkingMetrics;
}

const GROQ_CHUNKING_FAILURE_REASON_KEY = "groqChunkingFailureReason";

export { buildTranscriptionPrompt, MAX_TRANSCRIPTION_PROMPT_CHARS };

function getErrorMessage(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("message" in error)) {
		return undefined;
	}

	const { message } = error as { message?: unknown };
	return typeof message === "string" ? message : undefined;
}

function normalizeTranscriptParts(parts: string[]): string {
	return parts
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
}

function getFailureReason(error: unknown): string {
	const message = getErrorMessage(error);
	return message && message.length > 0 ? message : String(error);
}

function attachGroqChunkingFailureReason(
	error: unknown,
	reason: string,
): unknown {
	if (typeof error === "object" && error !== null) {
		Object.defineProperty(error, GROQ_CHUNKING_FAILURE_REASON_KEY, {
			value: reason,
			configurable: true,
		});
		return error;
	}

	const wrapped = new Error(reason);
	Object.defineProperty(wrapped, GROQ_CHUNKING_FAILURE_REASON_KEY, {
		value: reason,
		configurable: true,
	});
	return wrapped;
}

export function getGroqChunkingFailureReason(
	error: unknown,
): string | undefined {
	if (typeof error !== "object" || error === null) {
		return undefined;
	}

	const reason = (error as Record<string, unknown>)[
		GROQ_CHUNKING_FAILURE_REASON_KEY
	];
	return typeof reason === "string" ? reason : undefined;
}

async function mapWithConcurrency<T, U>(
	items: T[],
	concurrency: number,
	mapper: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
	const workerCount = Math.min(
		Math.max(1, Math.floor(concurrency)),
		items.length,
	);
	const results: Array<U | undefined> = new Array(items.length);
	let nextIndex = 0;

	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (true) {
				const index = nextIndex;
				nextIndex++;

				if (index >= items.length) {
					return;
				}

				const item = items[index];
				if (item === undefined) {
					return;
				}

				results[index] = await mapper(item, index);
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

export class GroqClient {
	private _client: Groq | null = null;
	private static readonly REQUEST_TIMEOUT_MS = 30000;
	private static readonly REQUEST_TIMEOUT_LONG_MS = 45000;
	private static readonly LONG_RECORDING_THRESHOLD_MS = 120000;

	private get client(): Groq {
		if (!this._client) {
			const config = loadConfig();
			this._client = new Groq({
				apiKey: config.apiKeys.groq,
			});
		}
		return this._client;
	}

	public reset(): void {
		this._client = null;
	}

	public async checkConnection(): Promise<boolean> {
		try {
			return await withRetry(
				async () => {
					const models = await this.client.models.list();
					return !!models?.data;
				},
				{
					operationName: "Groq Connectivity Check",
					maxRetries: 2,
					backoffs: [100, 200],
					timeout: 10000,
					shouldRetry: (error: unknown) => {
						const status = getErrorStatus(error);
						return status === undefined || status >= 500 || status === 429;
					},
				},
			);
		} catch (error: unknown) {
			if (getErrorStatus(error) === 401) {
				throw new TranscriptionError(
					"Groq",
					"GROQ_INVALID_KEY",
					"Groq: Invalid API Key",
				);
			}
			logError("Groq connectivity check failed", error, {
				operation: "checkConnection",
			});
			throw error;
		}
	}

	public async transcribe(
		audioBuffer: Buffer,
		language: string = "en",
		boostWords: string[] = [],
		format: "opus" | "wav" = "opus",
		recordingDurationMs?: number,
	): Promise<string> {
		try {
			const requestTimeoutMs =
				recordingDurationMs &&
				recordingDurationMs >= GroqClient.LONG_RECORDING_THRESHOLD_MS
					? GroqClient.REQUEST_TIMEOUT_LONG_MS
					: GroqClient.REQUEST_TIMEOUT_MS;

			return await withRetry(
				async (signal) => {
					const filename = format === "opus" ? "audio.opus" : "audio.wav";
					const mimeType = format === "opus" ? "audio/opus" : "audio/wav";
					const file = await toFile(audioBuffer, filename, {
						type: mimeType,
					});
					const prompt = buildTranscriptionPrompt(boostWords);

					const completion = await this.client.audio.transcriptions.create(
						{
							file,
							model: "whisper-large-v3",
							language: language,
							prompt: prompt,
							temperature: 0,
							response_format: "json",
						},
						{
							signal,
							timeout: requestTimeoutMs,
							maxRetries: 0,
						},
					);

					const text = completion.text.trim();
					logger.debug(
						{
							model: "whisper-large-v3",
							language,
							boostWordsCount: boostWords.length,
							promptLength: prompt.length,
							textLength: text.length,
						},
						"Groq transcription success",
					);
					return text;
				},
				{
					operationName: "Groq Transcription",
					maxRetries: 2,
					backoffs: [100, 200],
					timeout: requestTimeoutMs,
					shouldRetry: (error: unknown) => {
						if (getErrorMessage(error)?.includes("timed out")) {
							return false;
						}
						const status = getErrorStatus(error);
						return status === undefined || status >= 500 || status === 429;
					},
				},
			);
		} catch (error: unknown) {
			if (getErrorStatus(error) === 401) {
				throw new TranscriptionError(
					"Groq",
					"GROQ_INVALID_KEY",
					"Groq: Invalid API Key",
				);
			}
			if (getErrorStatus(error) === 429) {
				throw new TranscriptionError(
					"Groq",
					"RATE_LIMIT_EXCEEDED",
					"Groq: Rate limit exceeded",
				);
			}
			if (getErrorMessage(error)?.includes("timed out")) {
				throw new TranscriptionError(
					"Groq",
					"TIMEOUT",
					"Groq: Request timed out",
				);
			}
			logError("Groq transcription failed", error, {
				language,
				boostWordsCount: boostWords.length,
			});
			throw error;
		}
	}

	private buildChunkMetrics(
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

	private async transcribeChunkFallback(
		request: GroqChunkedTranscriptionRequest,
		failureReason: string,
		chunkCount: number,
	): Promise<GroqChunkedTranscriptionResult> {
		logger.warn(
			{
				failureReason,
				chunkCount,
				fallbackFormat: request.fallbackFormat,
				recordingDurationMs: request.recordingDurationMs,
			},
			"Groq chunked transcription failed; falling back to full audio",
		);

		const text = await this.transcribe(
			request.fallbackAudioBuffer,
			request.language,
			request.boostWords,
			request.fallbackFormat,
			request.recordingDurationMs,
		);

		return {
			text,
			chunking: this.buildChunkMetrics(request.chunking, {
				chunkCount,
				fallback: true,
				failureReason,
			}),
		};
	}

	public async transcribeChunked(
		request: GroqChunkedTranscriptionRequest,
	): Promise<GroqChunkedTranscriptionResult> {
		const language = request.language ?? "en";
		const boostWords = request.boostWords ?? [];
		const recordingDurationMs = request.recordingDurationMs ?? 0;
		const { chunking } = request;

		if (
			!chunking.enabled ||
			recordingDurationMs < chunking.minDurationSeconds * 1000
		) {
			const text = await this.transcribe(
				request.fallbackAudioBuffer,
				language,
				boostWords,
				request.fallbackFormat,
				request.recordingDurationMs,
			);
			return {
				text,
				chunking: this.buildChunkMetrics(chunking),
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
				const text = await this.transcribe(
					request.fallbackAudioBuffer,
					language,
					boostWords,
					request.fallbackFormat,
					request.recordingDurationMs,
				);
				return {
					text,
					chunking: this.buildChunkMetrics(chunking),
				};
			}
		} catch (error: unknown) {
			const failureReason = `chunk_preparation_failed: ${getFailureReason(error)}`;
			if (chunking.fallbackToFullAudio) {
				return this.transcribeChunkFallback(request, failureReason, 0);
			}
			throw attachGroqChunkingFailureReason(error, failureReason);
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

			const transcripts = await mapWithConcurrency(
				chunks,
				chunking.maxConcurrency,
				async (chunk) =>
					this.transcribe(
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
				chunking: this.buildChunkMetrics(chunking, {
					used: true,
					chunkCount: chunks.length,
				}),
			};
		} catch (error: unknown) {
			const failureReason = `chunk_request_failed: ${getFailureReason(error)}`;
			if (chunking.fallbackToFullAudio) {
				return this.transcribeChunkFallback(
					request,
					failureReason,
					chunks.length,
				);
			}
			throw attachGroqChunkingFailureReason(error, failureReason);
		}
	}
}
