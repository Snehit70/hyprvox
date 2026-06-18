import type { ConfigFile } from "../config/schema";
import { getErrorMessage } from "../utils/errors";

export type VerificationProvider = "groq" | "deepgram";
export type VerificationStatus = "pass" | "fail" | "warn" | "skip";

export interface ProviderVerificationResult {
	provider: VerificationProvider;
	status: VerificationStatus;
	message: string;
	blocking: boolean;
}

export interface SetupVerificationReport {
	results: ProviderVerificationResult[];
	hasBlockingFailure: boolean;
	offline: boolean;
}

export interface ProviderAuthTransport {
	groq?: () => Promise<void>;
	deepgram?: () => Promise<void>;
}

function getNestedStatus(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const record = error as Record<string, unknown>;
	const status = record.status ?? record.code;
	if (typeof status === "number") return status;

	const response = record.response;
	if (typeof response === "object" && response !== null) {
		const responseStatus = (response as Record<string, unknown>).status;
		if (typeof responseStatus === "number") return responseStatus;
	}

	return undefined;
}

function getStringCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const code = (error as Record<string, unknown>).code;
	return typeof code === "string" ? code : undefined;
}

function isInvalidAuthError(error: unknown): boolean {
	const status = getNestedStatus(error);
	if (status === 401 || status === 403) return true;

	const code = getStringCode(error);
	if (code === "GROQ_INVALID_KEY" || code === "DEEPGRAM_INVALID_KEY") {
		return true;
	}

	const message = getErrorMessage(error).toLowerCase();
	return (
		message.includes("invalid api key") ||
		message.includes("unauthorized") ||
		message.includes("forbidden") ||
		message.includes("401") ||
		message.includes("403")
	);
}

function isOfflineError(error: unknown): boolean {
	if (getNestedStatus(error) !== undefined) return false;
	const code = getStringCode(error);
	if (
		code &&
		[
			"ABORT_ERR",
			"ECONNREFUSED",
			"ECONNRESET",
			"ENETUNREACH",
			"ENOTFOUND",
			"ETIMEDOUT",
			"EAI_AGAIN",
			"UND_ERR_CONNECT_TIMEOUT",
		].includes(code)
	) {
		return true;
	}

	const message = getErrorMessage(error).toLowerCase();
	return (
		message.includes("fetch failed") ||
		message.includes("network") ||
		message.includes("offline") ||
		message.includes("timed out")
	);
}

function providerKey(
	config: ConfigFile,
	provider: VerificationProvider,
): string | undefined {
	return config.apiKeys?.[provider];
}

async function verifyProvider(
	provider: VerificationProvider,
	config: ConfigFile,
	transport: ProviderAuthTransport,
): Promise<ProviderVerificationResult> {
	if (!providerKey(config, provider)) {
		return {
			provider,
			status: "skip",
			message: "API key is not configured.",
			blocking: false,
		};
	}

	const check = transport[provider];
	if (!check) {
		return {
			provider,
			status: "skip",
			message: "No auth check transport is available.",
			blocking: false,
		};
	}

	try {
		await check();
		return {
			provider,
			status: "pass",
			message: "Authenticated request succeeded.",
			blocking: false,
		};
	} catch (error) {
		if (isInvalidAuthError(error)) {
			return {
				provider,
				status: "fail",
				message: `Authentication failed: ${getErrorMessage(error)}`,
				blocking: true,
			};
		}

		return {
			provider,
			status: "warn",
			message: `${isOfflineError(error) ? "Network/offline check failed" : "Connectivity check failed"}: ${getErrorMessage(error)}`,
			blocking: false,
		};
	}
}

export async function verifyProviderAuth(
	config: ConfigFile,
	transport: ProviderAuthTransport,
): Promise<SetupVerificationReport> {
	const results = await Promise.all([
		verifyProvider("groq", config, transport),
		verifyProvider("deepgram", config, transport),
	]);

	return {
		results,
		hasBlockingFailure: results.some((result) => result.blocking),
		offline: results.some(
			(result) =>
				result.status === "warn" &&
				result.message.toLowerCase().includes("network/offline"),
		),
	};
}
