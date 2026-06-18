import { z } from "zod";

export const DeepgramApiKeySchema = z
	.string()
	.min(32, { message: "Deepgram API key is too short" })
	.max(40, { message: "Deepgram API key is too long" })
	.refine(
		(value) => {
			const is40CharHex = /^[a-fA-F0-9]{40}$/.test(value);
			const isUuid =
				/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(
					value,
				);
			return is40CharHex || isUuid;
		},
		{
			message:
				"Deepgram API key must be a 40-character hex string or a valid UUID format",
		},
	);

export function isValidDeepgramApiKey(value: unknown): value is string {
	return DeepgramApiKeySchema.safeParse(value).success;
}

export function isConfiguredGroqApiKey(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.startsWith("gsk_") &&
		value.length >= 10
	);
}

export function hasConfiguredTranscriptionApiKeys(config: {
	apiKeys?: {
		groq?: unknown;
		deepgram?: unknown;
	};
}): boolean {
	return (
		isConfiguredGroqApiKey(config.apiKeys?.groq) &&
		isValidDeepgramApiKey(config.apiKeys?.deepgram)
	);
}
