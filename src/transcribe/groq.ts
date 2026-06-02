import Groq from "groq-sdk";
import { toFile } from "groq-sdk/uploads";
import { loadConfig } from "../config/loader";
import { TranscriptionError } from "../utils/errors";
import { logError, logger } from "../utils/logger";
import { withRetry } from "../utils/retry";

const BASE_TRANSCRIPTION_PROMPT = [
	"Technical English dictation about software development, Linux, and AI.",
	"Likely vocabulary includes commands, file paths, acronyms, project names, and code terms.",
].join(" ");
const MAX_TRANSCRIPTION_PROMPT_CHARS = 896;
const BOOST_WORDS_PREFIX = " Vocabulary: ";
const CONTEXT_PREFIX = " Recent text: ";
const PROMPT_SUFFIX = ".";

function fitBoostWordsInPrompt(boostWords: string[]): string[] {
	const prefix = `${BASE_TRANSCRIPTION_PROMPT}${BOOST_WORDS_PREFIX}`;
	const suffix = PROMPT_SUFFIX;
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

function fitContextHintInPrompt(basePrompt: string, contextHint?: string): string {
	const normalized = contextHint?.trim().replace(/\s+/g, " ");
	if (!normalized) return "";

	const availableChars =
		MAX_TRANSCRIPTION_PROMPT_CHARS -
		basePrompt.length -
		CONTEXT_PREFIX.length -
		PROMPT_SUFFIX.length;
	if (availableChars <= 0) return "";

	if (normalized.length <= availableChars) {
		return normalized;
	}

	const truncated = normalized.slice(0, Math.max(0, availableChars - 3)).trimEnd();
	return truncated.length > 0 ? `${truncated}...` : "";
}

function buildTranscriptionPrompt(
	boostWords: string[],
	contextHint?: string,
): string {
	const fittedBoostWords = fitBoostWordsInPrompt(boostWords);
	let prompt = BASE_TRANSCRIPTION_PROMPT;

	if (fittedBoostWords.length === 0) {
		const fittedContextHint = fitContextHintInPrompt(prompt, contextHint);
		return fittedContextHint.length > 0
			? `${prompt}${CONTEXT_PREFIX}${fittedContextHint}${PROMPT_SUFFIX}`
			: prompt;
	}

	prompt = `${BASE_TRANSCRIPTION_PROMPT}${BOOST_WORDS_PREFIX}${fittedBoostWords.join(", ")}${PROMPT_SUFFIX}`;
	const fittedContextHint = fitContextHintInPrompt(prompt, contextHint);
	return fittedContextHint.length > 0
		? `${prompt}${CONTEXT_PREFIX}${fittedContextHint}${PROMPT_SUFFIX}`
		: prompt;
}

function getErrorStatus(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null || !("status" in error)) {
		return undefined;
	}

	const { status } = error as { status?: unknown };
	return typeof status === "number" ? status : undefined;
}

export { buildTranscriptionPrompt, MAX_TRANSCRIPTION_PROMPT_CHARS };

function getErrorMessage(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("message" in error)) {
		return undefined;
	}

	const { message } = error as { message?: unknown };
	return typeof message === "string" ? message : undefined;
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
		contextHint?: string,
		externalSignal?: AbortSignal,
	): Promise<string> {
		try {
			const requestTimeoutMs =
				recordingDurationMs &&
				recordingDurationMs >= GroqClient.LONG_RECORDING_THRESHOLD_MS
					? GroqClient.REQUEST_TIMEOUT_LONG_MS
					: GroqClient.REQUEST_TIMEOUT_MS;

			return await withRetry(
				async (signal) => {
					const requestSignal =
						signal && externalSignal
							? AbortSignal.any([signal, externalSignal])
							: (externalSignal ?? signal);
					const filename = format === "opus" ? "audio.opus" : "audio.wav";
					const mimeType = format === "opus" ? "audio/opus" : "audio/wav";
					const file = await toFile(audioBuffer, filename, {
						type: mimeType,
					});
					const prompt = buildTranscriptionPrompt(boostWords, contextHint);

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
							signal: requestSignal ?? new AbortController().signal,
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
							contextHintLength: contextHint?.length ?? 0,
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
}
