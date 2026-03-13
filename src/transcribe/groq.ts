import Groq from "groq-sdk";
import { loadConfig } from "../config/loader";
import { TranscriptionError } from "../utils/errors";
import { logError, logger } from "../utils/logger";
import { withRetry } from "../utils/retry";

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
					shouldRetry: (error: any) => {
						return error?.status !== 401;
					},
				},
			);
		} catch (error: any) {
			if (error?.status === 401) {
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
	): Promise<string> {
		try {
			return await withRetry(
				async (signal) => {
					const file = new File([audioBuffer], "audio.opus", {
						type: "audio/opus",
					});
					const prompt =
						boostWords.length > 0
							? `Keywords: ${boostWords.join(", ")}`
							: undefined;

					const completion = await this.client.audio.transcriptions.create(
						{
							file: file as any,
							model: "whisper-large-v3",
							language: language,
							prompt: prompt,
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
					shouldRetry: (error: any) => {
						const status = error?.status;
						return status !== 401;
					},
				},
			);
		} catch (error: any) {
			if (error?.status === 401) {
				throw new TranscriptionError(
					"Groq",
					"GROQ_INVALID_KEY",
					"Groq: Invalid API Key",
				);
			}
			if (error?.status === 429) {
				throw new TranscriptionError(
					"Groq",
					"RATE_LIMIT_EXCEEDED",
					"Groq: Rate limit exceeded",
				);
			}
			if (error?.message?.includes("timed out")) {
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
