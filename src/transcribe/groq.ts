import Groq from "groq-sdk";
import { toFile } from "groq-sdk/uploads";
import { loadConfig } from "../config/loader";
import { TranscriptionError } from "../utils/errors";
import { logError, logger } from "../utils/logger";
import { withRetry } from "../utils/retry";

const BASE_TRANSCRIPTION_PROMPT = [
	"Technical English dictation about software development, Linux, and AI.",
	"Preserve commands, filenames, acronyms, project names, and code terms exactly.",
	"When the speaker clearly dictates structure, prefer literal symbols for braces, brackets, parentheses, colons, commas, quotes, and slashes.",
	"Preserve numbered list cues like first, second, and third when spoken.",
].join(" ");

function buildTranscriptionPrompt(boostWords: string[]): string {
	if (boostWords.length === 0) {
		return BASE_TRANSCRIPTION_PROMPT;
	}

	return `${BASE_TRANSCRIPTION_PROMPT} Prefer these terms: ${boostWords.join(", ")}.`;
}

function getErrorStatus(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null || !("status" in error)) {
		return undefined;
	}

	const { status } = error as { status?: unknown };
	return typeof status === "number" ? status : undefined;
}

function getErrorMessage(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("message" in error)) {
		return undefined;
	}

	const { message } = error as { message?: unknown };
	return typeof message === "string" ? message : undefined;
}

export class GroqClient {
	private _client: Groq | null = null;

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
	): Promise<string> {
		try {
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
							timeout: 30000,
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
					timeout: 30000,
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
