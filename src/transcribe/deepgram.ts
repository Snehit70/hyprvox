import { createClient, type DeepgramClient } from "@deepgram/sdk";
import { loadConfig } from "../config/loader";
import { TranscriptionError } from "../utils/errors";
import { logError, logger } from "../utils/logger";
import { withRetry } from "../utils/retry";
import { sanitizeDeepgramKeyterms } from "./deepgram-boost";

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

export class DeepgramTranscriber {
	private _client: DeepgramClient | null = null;

	private get client(): DeepgramClient {
		if (!this._client) {
			const config = loadConfig();
			this._client = createClient(config.apiKeys.deepgram);
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
					const { result, error } = await this.client.manage.getProjects();
					if (error) throw error;
					return !!result?.projects;
				},
				{
					operationName: "Deepgram Connectivity Check",
					maxRetries: 2,
					backoffs: [100, 200],
					timeout: 10000,
					shouldRetry: (error: unknown) => {
						const status =
							getErrorStatus(error) ||
							(getErrorMessage(error)?.includes("401") ? 401 : undefined);
						return status !== 401;
					},
				},
			);
		} catch (error: unknown) {
			if (
				getErrorStatus(error) === 401 ||
				getErrorMessage(error)?.includes("401")
			) {
				throw new TranscriptionError(
					"Deepgram",
					"DEEPGRAM_INVALID_KEY",
					"Deepgram: Invalid API Key",
				);
			}
			logError("Deepgram connectivity check failed", error, {
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
		const keyterms = sanitizeDeepgramKeyterms(boostWords);

		try {
			return await withRetry(
				async (_signal) => {
					const { result, error } =
						await this.client.listen.prerecorded.transcribeFile(audioBuffer, {
							model: "nova-3",
							smart_format: true,
							punctuate: true,
							language: language,
							...(keyterms.length > 0 ? { keyterm: keyterms } : {}),
						});

					if (error) throw error;

					const text =
						result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
					if (!text) return "";

					logger.info(
						{
							textLength: text.length,
							confidence:
								result?.results?.channels?.[0]?.alternatives?.[0]?.confidence,
							model: "nova-3",
							language,
							boostWordsCount: boostWords.length,
							deepgramKeytermsCount: keyterms.length,
						},
						"Deepgram Nova-3 transcription success",
					);

					return text.trim();
				},
				{
					operationName: "Deepgram Nova-3",
					maxRetries: 2,
					backoffs: [100, 200],
					timeout: 30000,
					shouldRetry: (error: unknown) => {
						const message = getErrorMessage(error);
						const status =
							getErrorStatus(error) ||
							(message?.includes("401") ? 401 : undefined) ||
							(message?.includes("429") ? 429 : undefined);
						return status !== 401 && status !== 429;
					},
				},
			);
		} catch (error: unknown) {
			const message = getErrorMessage(error);
			const status = getErrorStatus(error);
			if (status === 401 || message?.includes("401")) {
				throw new TranscriptionError(
					"Deepgram",
					"DEEPGRAM_INVALID_KEY",
					"Deepgram: Invalid API Key",
				);
			}
			if (status === 429 || message?.includes("429")) {
				throw new TranscriptionError(
					"Deepgram",
					"RATE_LIMIT_EXCEEDED",
					"Deepgram: Rate limit exceeded",
				);
			}
			logError("Deepgram Nova-3 failed, trying fallback", error, {
				language,
				boostWordsCount: boostWords.length,
				deepgramKeytermsCount: keyterms.length,
			});

			try {
				return await withRetry(
					async (_signal) => {
						const { result, error: retryError } =
							await this.client.listen.prerecorded.transcribeFile(audioBuffer, {
								model: "nova-2",
								smart_format: true,
								punctuate: true,
								language: language,
							});

						if (retryError) throw retryError;
						const text =
							result?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ||
							"";

						logger.info(
							{
								textLength: text.length,
								model: "nova-2",
								language,
								boostWordsCount: 0,
								deepgramKeytermsCount: 0,
							},
							"Deepgram Nova-2 fallback success",
						);

						return text;
					},
					{
						operationName: "Deepgram Nova-2 Fallback",
						maxRetries: 2,
						backoffs: [100, 200],
						timeout: 30000,
						shouldRetry: (error: unknown) => {
							const message = getErrorMessage(error);
							const status =
								getErrorStatus(error) ||
								(message?.includes("401") ? 401 : undefined) ||
								(message?.includes("429") ? 429 : undefined);
							return status !== 401 && status !== 429;
						},
					},
				);
			} catch (retryError: unknown) {
				const message = getErrorMessage(retryError);
				const status = getErrorStatus(retryError);
				if (status === 401 || message?.includes("401")) {
					throw new TranscriptionError(
						"Deepgram",
						"DEEPGRAM_INVALID_KEY",
						"Deepgram: Invalid API Key",
					);
				}
				if (status === 429 || message?.includes("429")) {
					throw new TranscriptionError(
						"Deepgram",
						"RATE_LIMIT_EXCEEDED",
						"Deepgram: Rate limit exceeded",
					);
				}
				if (message?.includes("timed out")) {
					throw new TranscriptionError(
						"Deepgram",
						"TIMEOUT",
						"Deepgram: Request timed out",
					);
				}
				logError("Deepgram fallback failed", retryError, {
					language,
					boostWordsCount: 0,
					deepgramKeytermsCount: 0,
				});
				throw retryError;
			}
		}
	}
}
