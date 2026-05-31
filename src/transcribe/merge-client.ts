import Groq from "groq-sdk";
import { logger } from "../utils/logger";

type GroqChatRequest = Parameters<Groq["chat"]["completions"]["create"]>[0];

export class GroqMergeClient {
	private client: Groq | null = null;
	private cachedApiKey: string | null = null;

	public reset(): void {
		this.client = null;
		this.cachedApiKey = null;
	}

	public async createCompletionWithFallback(
		primaryApiKey: string,
		fallbackApiKey: string | undefined,
		request: GroqChatRequest,
		signal?: AbortSignal,
	) {
		try {
			return await this.getClient(primaryApiKey).chat.completions.create(
				request,
				{
					signal,
					timeout: 30000,
					maxRetries: 0,
				},
			);
		} catch (error) {
			if (!fallbackApiKey || !this.isRateLimitOrQuotaError(error)) {
				throw error;
			}

			logger.warn(
				{
					reason: error instanceof Error ? error.message : String(error),
				},
				"Primary Groq merge key rate-limited; retrying merge with fallback key",
			);

			return await this.getClient(fallbackApiKey).chat.completions.create(
				request,
				{
					signal,
					timeout: 30000,
					maxRetries: 0,
				},
			);
		}
	}

	private getClient(apiKey: string): Groq {
		if (!this.client || this.cachedApiKey !== apiKey) {
			this.client = new Groq({ apiKey });
			this.cachedApiKey = apiKey;
		}
		return this.client;
	}

	private isRateLimitOrQuotaError(error: unknown): boolean {
		if (!(error instanceof Error)) {
			return false;
		}
		return /rate_limit|quota|429|tokens per day|limit reached/i.test(
			error.message,
		);
	}
}
