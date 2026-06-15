import { notify } from "../output/notification";
import { ErrorTemplates, formatUserError } from "../utils/error-templates";
import { errorIncludes, getErrorCode } from "../utils/errors";
import { logError, logger } from "../utils/logger";

export function handleProviderTranscriptionError(
	err: unknown,
	failedService: "Groq" | "Deepgram",
): void {
	const code = getErrorCode(err);

	if (
		code === "GROQ_INVALID_KEY" ||
		code === "DEEPGRAM_INVALID_KEY" ||
		errorIncludes(err, "Invalid API Key")
	) {
		const template =
			failedService === "Groq"
				? ErrorTemplates.API.GROQ_INVALID_KEY
				: ErrorTemplates.API.DEEPGRAM_INVALID_KEY;
		notify("Configuration Error", formatUserError(template), "error");
		return;
	}

	if (
		code === "RATE_LIMIT_EXCEEDED" ||
		errorIncludes(err, "Rate limit exceeded")
	) {
		const template = ErrorTemplates.API.RATE_LIMIT_EXCEEDED(failedService);
		notify("Rate Limit", formatUserError(template), "error");
		return;
	}

	if (code === "TIMEOUT" || errorIncludes(err, "timed out")) {
		logger.warn(`${failedService} API timed out`);
		return;
	}

	logError(`${failedService} failed`, err);
}
