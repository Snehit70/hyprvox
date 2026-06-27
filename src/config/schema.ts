import { z } from "zod";
import { DeepgramApiKeySchema } from "./api-keys";

/**
 * Custom validator for boost words count.
 * Ensures the total number of words across all entries does not exceed 450.
 */
export const boostWordsValidator = (words: string[] | undefined) => {
	if (!words) return true;
	const totalWords = words.reduce((count, entry) => {
		return (
			count +
			entry
				.trim()
				.split(/\s+/)
				.filter((w) => w.length > 0).length
		);
	}, 0);
	return totalWords <= 450;
};

// Valid hotkey parts for validation
// Includes generic modifiers, specific modifiers, and standard keys
const VALID_HOTKEY_PARTS = new Set([
	// Generic Modifiers
	"CTRL",
	"CONTROL",
	"ALT",
	"SHIFT",
	"META",
	"SUPER",
	"WIN",
	"COMMAND",
	"CMD",
	"OPTION",

	// Specific Modifiers
	"LEFT CTRL",
	"RIGHT CTRL",
	"LEFT CONTROL",
	"RIGHT CONTROL",
	"LEFT ALT",
	"RIGHT ALT",
	"LEFT SHIFT",
	"RIGHT SHIFT",
	"LEFT META",
	"RIGHT META",

	// Alphanumeric
	..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
	..."0123456789".split(""),

	// Function Keys
	..."123456789".split("").map((n) => `F${n}`),
	..."10 11 12 13 14 15 16 17 18 19 20 21 22 23 24"
		.split(" ")
		.map((n) => `F${n}`),

	// Navigation & Editing
	"SPACE",
	"ENTER",
	"RETURN",
	"TAB",
	"ESC",
	"ESCAPE",
	"BACKSPACE",
	"DELETE",
	"INSERT",
	"HOME",
	"END",
	"PAGE UP",
	"PAGE DOWN",
	"UP",
	"DOWN",
	"LEFT",
	"RIGHT",
	"UP ARROW",
	"DOWN ARROW",
	"LEFT ARROW",
	"RIGHT ARROW",
	"PRINTSCREEN",
	"PRINT SCREEN",
	"SCROLL LOCK",
	"PAUSE",
	"BREAK",

	// Locks
	"CAPS LOCK",
	"NUM LOCK",

	// Symbols (Common names)
	"MINUS",
	"EQUAL",
	"EQUALS",
	"BRACKET LEFT",
	"BRACKET RIGHT",
	"SEMICOLON",
	"QUOTE",
	"BACKQUOTE",
	"BACKSLASH",
	"COMMA",
	"PERIOD",
	"SLASH",
	"GRAVE",
	"TILDE",
	"BACKTICK",
	"SQUARE BRACKET OPEN",
	"SQUARE BRACKET CLOSE",
	"DOT",

	// Numpad
	"NUMPAD 0",
	"NUMPAD 1",
	"NUMPAD 2",
	"NUMPAD 3",
	"NUMPAD 4",
	"NUMPAD 5",
	"NUMPAD 6",
	"NUMPAD 7",
	"NUMPAD 8",
	"NUMPAD 9",
	"NUMPAD DIVIDE",
	"NUMPAD MULTIPLY",
	"NUMPAD SUBTRACT",
	"NUMPAD ADD",
	"NUMPAD ENTER",
	"NUMPAD DECIMAL",
	"NUMPAD DOT",
]);

/**
 * Validates a hotkey string.
 * Supports "Modifier+Key" format (e.g., "Ctrl+Space", "Right Control").
 * Also accepts "disabled" to disable the built-in hotkey listener.
 * Case-insensitive.
 */
export const hotkeyValidator = (hotkey: string) => {
	if (!hotkey || hotkey.trim().length === 0) return false;

	// Allow "disabled" as a special value to disable hotkey listener
	if (hotkey.trim().toLowerCase() === "disabled") return true;

	const parts = hotkey.split("+").map((p) => p.trim().toUpperCase());

	// Check if all parts are valid
	const allValid = parts.every((part) => VALID_HOTKEY_PARTS.has(part));
	if (!allValid) return false;

	// Ideally, ensure at least one part is a key (not just modifiers),
	// but "Right Control" is a valid trigger in some contexts.
	// For now, just ensuring parts are valid names is sufficient for configuration safety.

	return true;
};

const defaultBehavior = {
	hotkey: "Right Control",
	toggleMode: true,
	notifications: true,
	clipboard: {
		append: true,
		minDuration: 0.6,
		maxDuration: 600,
	},
};

const defaultPaths = {
	logs: "~/.config/hypr/vox/logs/",
	history: "~/.config/hypr/vox/history.json",
};

const defaultTranscription = {
	language: "en",
	streaming: false,
	deepgramBoosting: false,
	lexiconEnabled: true,
	groqChunking: {
		enabled: false,
		mode: "live",
		minDurationSeconds: 45,
		chunkSeconds: 20,
		overlapSeconds: 1.5,
		maxConcurrency: 3,
		chunkMaxRetries: 1,
		chunkRetryBackoffMs: 250,
		liveFinalizeTimeoutMs: 2500,
		fallbackToFullAudio: true,
		logChunkTranscripts: true,
	},
	debugAudio: {
		enabled: true,
		keepLast: 5,
		directory: "~/.config/hypr/vox/debug-audio",
	},
	statsThresholds: {
		latencyP95WarnMs: 2500,
		latencyP95BadMs: 4000,
		errorWarnCount24h: 5,
		errorBadCount24h: 20,
		qualityWarnCount24h: 3,
		qualityBadCount24h: 10,
	},
	statsCacheTtlMs: 10000,
	statsRenderBudgetMs: 50,
	statsMinSampleSize: 10,
	mergeModel: "llama-3.3-70b-versatile",
	formattingMode: "clean",
} as const;

const defaultAudio = {
	compression: "auto" as const,
	compressionThreshold: 1048576, // 1MB in bytes (~32 seconds of audio)
};

const defaultLiveDictation = {
	enabled: false,
	insertionCommand: "auto" as const,
	retypeFormatted: false,
	soniox: {
		enabled: false,
		triggerKey: "Right Alt",
		paragraphPauseMs: 3000,
		languageHintsStrict: true,
		contextGeneral: [
			{ key: "domain", value: "software development" },
			{ key: "topic", value: "technical architecture and implementation" },
		],
		contextText: "The speaker is dictating technical prompts for AI coding agents, software architecture discussions, code comments, and developer workflow instructions. Content includes programming terminology, API references, database schemas, CLI commands, and system administration tasks.",
	},
};

export const ApiKeysSchema = z.object({
	groq: z
		.string()
		.startsWith("gsk_", { message: "Groq API key must start with 'gsk_'" })
		.min(10, { message: "Groq API key is too short" }),
	groqFallback: z
		.string()
		.startsWith("gsk_", {
			message: "Fallback Groq API key must start with 'gsk_'",
		})
		.min(10, { message: "Fallback Groq API key is too short" })
		.optional(),
	deepgram: DeepgramApiKeySchema,
	soniox: z
		.string()
		.min(1, { message: "Soniox API key is too short" })
		.optional(),
});

export const ApiKeysFileSchema = ApiKeysSchema.partial().refine(
	(keys) =>
		keys.groq !== undefined ||
		keys.deepgram !== undefined ||
		keys.groqFallback !== undefined,
	{
		message: "At least one API key must be provided when apiKeys is present",
	},
);

export const BehaviorSchema = z.object({
	hotkey: z.string().default(defaultBehavior.hotkey).refine(hotkeyValidator, {
		message:
			"Invalid hotkey format. Use 'Modifier+Key' (e.g. 'Ctrl+Space', 'Right Control').",
	}),
	toggleMode: z.boolean().default(defaultBehavior.toggleMode),
	notifications: z.boolean().default(defaultBehavior.notifications),
	clipboard: z
		.object({
			append: z.boolean().default(defaultBehavior.clipboard.append),
			minDuration: z
				.number()
				.min(0.6)
				.default(defaultBehavior.clipboard.minDuration),
			maxDuration: z
				.number()
				.max(600)
				.default(defaultBehavior.clipboard.maxDuration), // 10 minutes in seconds
		})
		.default(defaultBehavior.clipboard),
	audioDevice: z.string().optional(),
});

export const PathsSchema = z.object({
	logs: z.string().default(defaultPaths.logs),
	history: z.string().default(defaultPaths.history),
});

export const GroqChunkingSchema = z
	.object({
		enabled: z.boolean().default(defaultTranscription.groqChunking.enabled),
		mode: z.literal("live").default(defaultTranscription.groqChunking.mode),
		minDurationSeconds: z
			.number()
			.min(1)
			.default(defaultTranscription.groqChunking.minDurationSeconds),
		chunkSeconds: z
			.number()
			.min(1)
			.default(defaultTranscription.groqChunking.chunkSeconds),
		overlapSeconds: z
			.number()
			.min(0)
			.default(defaultTranscription.groqChunking.overlapSeconds),
		maxConcurrency: z
			.number()
			.int()
			.min(1)
			.max(8)
			.default(defaultTranscription.groqChunking.maxConcurrency),
		chunkMaxRetries: z
			.number()
			.int()
			.min(0)
			.max(3)
			.default(defaultTranscription.groqChunking.chunkMaxRetries),
		chunkRetryBackoffMs: z
			.number()
			.min(0)
			.max(5000)
			.default(defaultTranscription.groqChunking.chunkRetryBackoffMs),
		liveFinalizeTimeoutMs: z
			.number()
			.min(1)
			.max(30000)
			.default(defaultTranscription.groqChunking.liveFinalizeTimeoutMs),
		fallbackToFullAudio: z
			.boolean()
			.default(defaultTranscription.groqChunking.fallbackToFullAudio),
		logChunkTranscripts: z
			.boolean()
			.default(defaultTranscription.groqChunking.logChunkTranscripts),
	})
	.refine((value) => value.overlapSeconds < value.chunkSeconds, {
		path: ["overlapSeconds"],
		message: "Groq chunk overlap must be smaller than chunk duration",
	});

export const DebugAudioSchema = z.object({
	enabled: z.boolean().default(defaultTranscription.debugAudio.enabled),
	keepLast: z
		.number()
		.int()
		.min(1)
		.max(100)
		.default(defaultTranscription.debugAudio.keepLast),
	directory: z.string().default(defaultTranscription.debugAudio.directory),
});

export const TranscriptionSchema = z.object({
	boostWords: z.array(z.string()).optional().refine(boostWordsValidator, {
		message: "Boost words limit exceeded: Maximum 450 words allowed.",
	}),
	language: z.enum(["en"]).default(defaultTranscription.language as "en"),
	streaming: z.boolean().default(defaultTranscription.streaming),
	deepgramBoosting: z.boolean().default(defaultTranscription.deepgramBoosting),
	lexiconEnabled: z.boolean().default(defaultTranscription.lexiconEnabled),
	groqChunking: GroqChunkingSchema.default(defaultTranscription.groqChunking),
	debugAudio: DebugAudioSchema.default(defaultTranscription.debugAudio),
	statsThresholds: z
		.object({
			latencyP95WarnMs: z
				.number()
				.min(1)
				.default(defaultTranscription.statsThresholds.latencyP95WarnMs),
			latencyP95BadMs: z
				.number()
				.min(1)
				.default(defaultTranscription.statsThresholds.latencyP95BadMs),
			errorWarnCount24h: z
				.number()
				.min(0)
				.default(defaultTranscription.statsThresholds.errorWarnCount24h),
			errorBadCount24h: z
				.number()
				.min(0)
				.default(defaultTranscription.statsThresholds.errorBadCount24h),
			qualityWarnCount24h: z
				.number()
				.min(0)
				.default(defaultTranscription.statsThresholds.qualityWarnCount24h),
			qualityBadCount24h: z
				.number()
				.min(0)
				.default(defaultTranscription.statsThresholds.qualityBadCount24h),
		})
		.default(defaultTranscription.statsThresholds),
	statsCacheTtlMs: z
		.number()
		.min(1000)
		.default(defaultTranscription.statsCacheTtlMs),
	statsRenderBudgetMs: z
		.number()
		.min(10)
		.default(defaultTranscription.statsRenderBudgetMs),
	statsMinSampleSize: z
		.number()
		.min(1)
		.default(defaultTranscription.statsMinSampleSize),
	mergeModel: z.string().default(defaultTranscription.mergeModel),
	formattingMode: z
		.enum(["verbatim", "clean", "structured"])
		.default(defaultTranscription.formattingMode),
});

export const OverlaySchema = z
	.object({
		enabled: z.boolean().default(true),
		autoStart: z.boolean().default(true),
		binaryPath: z.string().optional(),
	})
	.default({ enabled: true, autoStart: true });

export const AudioSchema = z
	.object({
		compression: z
			.enum(["auto", "always", "never"])
			.default(defaultAudio.compression),
		compressionThreshold: z
			.number()
			.min(0)
			.default(defaultAudio.compressionThreshold),
	})
	.default(defaultAudio);

export const LiveDictationSchema = z
	.object({
		enabled: z.boolean().default(defaultLiveDictation.enabled),
		insertionCommand: z
			.enum(["auto", "wtype", "xdotool"])
			.default(defaultLiveDictation.insertionCommand),
		retypeFormatted: z.boolean().default(defaultLiveDictation.retypeFormatted),
		soniox: z
			.object({
				enabled: z.boolean().default(defaultLiveDictation.soniox.enabled),
				triggerKey: z
					.string()
					.default(defaultLiveDictation.soniox.triggerKey)
					.refine(hotkeyValidator, {
						message:
							"Invalid Soniox trigger key format. Use 'Modifier+Key' (e.g., 'Ctrl+Space', 'Right Alt').",
					}),
				paragraphPauseMs: z
					.number()
					.min(1000, { message: "paragraphPauseMs must be at least 1000ms" })
					.default(defaultLiveDictation.soniox.paragraphPauseMs),
				languageHintsStrict: z
					.boolean()
					.default(defaultLiveDictation.soniox.languageHintsStrict),
				contextGeneral: z
					.array(
						z.object({
							key: z.string(),
							value: z.string(),
						}),
					)
					.default(defaultLiveDictation.soniox.contextGeneral),
				contextText: z
					.string()
					.max(10000, { message: "contextText must be at most 10000 characters" })
					.default(defaultLiveDictation.soniox.contextText),
			})
			.default(defaultLiveDictation.soniox),
	})
	.default(defaultLiveDictation);

export const ConfigSchema = z.object({
	apiKeys: ApiKeysSchema,
	behavior: BehaviorSchema.default(defaultBehavior),
	paths: PathsSchema.default(defaultPaths),
	transcription: TranscriptionSchema.default(defaultTranscription),
	overlay: OverlaySchema,
	audio: AudioSchema,
	liveDictation: LiveDictationSchema,
});

export const ConfigFileSchema = z.object({
	apiKeys: ApiKeysFileSchema.optional(),
	behavior: BehaviorSchema.default(defaultBehavior),
	paths: PathsSchema.default(defaultPaths),
	transcription: TranscriptionSchema.default(defaultTranscription),
	overlay: OverlaySchema,
	audio: AudioSchema,
	liveDictation: LiveDictationSchema,
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * interface representing the raw config file structure before default application
 * (Useful if we want to type the partial JSON read from disk)
 */
export type ConfigFile = z.input<typeof ConfigFileSchema>;
