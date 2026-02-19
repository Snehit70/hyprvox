export type ErrorCode =
	| "GROQ_INVALID_KEY"
	| "DEEPGRAM_INVALID_KEY"
	| "RATE_LIMIT_EXCEEDED"
	| "TIMEOUT"
	| "BOTH_SERVICES_FAILED"
	| "INVALID_API_KEY_FORMAT"
	| "BOOST_WORDS_LIMIT"
	| "INVALID_HOTKEY"
	| "RECORDING_TOO_SHORT"
	| "MAX_DURATION_REACHED"
	| "NO_MICROPHONE"
	| "PERMISSION_DENIED"
	| "DEVICE_BUSY"
	| "SILENT_AUDIO"
	| "FFMPEG_FAILURE"
	| "CONVERSION_FAILED"
	| "ALREADY_RECORDING"
	| "CRASH_LIMIT_REACHED"
	| "APPEND_FAILED"
	| "ACCESS_DENIED"
	| "VALIDATION_FAILED"
	| "FILE_PERMISSIONS"
	| "CORRUPTED"
	| "WRITE_FAILED"
	| "AUDIO_BACKEND_MISSING"
	| "UNKNOWN_ERROR";

export class AppError extends Error {
	public readonly code: ErrorCode;
	public readonly context?: Record<string, unknown>;

	constructor(
		code: ErrorCode,
		message: string,
		context?: Record<string, unknown>,
	) {
		super(message);
		this.code = code;
		this.context = context;
		this.name = "AppError";
		Object.setPrototypeOf(this, AppError.prototype);
	}
}

export class TranscriptionError extends AppError {
	public readonly provider: string;

	constructor(
		provider: string,
		code: ErrorCode,
		message: string,
		context?: Record<string, unknown>,
	) {
		super(code, message, { ...context, provider });
		this.provider = provider;
		this.name = "TranscriptionError";
	}
}

export function isAppError(error: unknown): error is AppError {
	return error instanceof AppError;
}

export function hasErrorCode(error: unknown, code: ErrorCode): boolean {
	return isAppError(error) && error.code === code;
}

export function getErrorCode(error: unknown): ErrorCode | undefined {
	return isAppError(error) ? error.code : undefined;
}

export function isErrorWithName(error: unknown, name: string): boolean {
	return error instanceof Error && error.name === name;
}

export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export function errorIncludes(error: unknown, text: string): boolean {
	return error instanceof Error && error.message.includes(text);
}
