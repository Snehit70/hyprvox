import { z } from "zod";

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
		maxDuration: 300,
	},
};

const defaultPaths = {
	logs: "~/.config/voice-cli/logs/",
	history: "~/.config/voice-cli/history.json",
};

const defaultTranscription = {
	language: "en",
	streaming: false,
	mergeModel: "llama-3.3-70b-versatile",
} as const;

export const ApiKeysSchema = z.object({
	groq: z
		.string()
		.startsWith("gsk_", { message: "Groq API key must start with 'gsk_'" })
		.min(10, { message: "Groq API key is too short" }),
	deepgram: z
		.string()
		.min(32, { message: "Deepgram API key is too short" })
		.max(40, { message: "Deepgram API key is too long" })
		.refine(
			(val) => {
				// Allow 40-character hex string OR standard UUID format
				const is40CharHex = /^[a-fA-F0-9]{40}$/.test(val);
				const isUUID =
					/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(
						val,
					);
				return is40CharHex || isUUID;
			},
			{
				message:
					"Deepgram API key must be a 40-character hex string or a valid UUID format",
			},
		),
});

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
				.max(300)
				.default(defaultBehavior.clipboard.maxDuration), // 5 minutes in seconds
		})
		.default(defaultBehavior.clipboard),
	audioDevice: z.string().optional(),
});

export const PathsSchema = z.object({
	logs: z.string().default(defaultPaths.logs),
	history: z.string().default("~/.config/voice-cli/history.json"),
});

export const TranscriptionSchema = z.object({
	boostWords: z.array(z.string()).optional().refine(boostWordsValidator, {
		message: "Boost words limit exceeded: Maximum 450 words allowed.",
	}),
	language: z.enum(["en"]).default(defaultTranscription.language as "en"),
	streaming: z.boolean().default(defaultTranscription.streaming),
	mergeModel: z.string().default(defaultTranscription.mergeModel),
});

export const OverlaySchema = z
	.object({
		enabled: z.boolean().default(true),
		autoStart: z.boolean().default(true),
		binaryPath: z.string().optional(),
	})
	.default({ enabled: true, autoStart: true });

export const ConfigSchema = z.object({
	apiKeys: ApiKeysSchema,
	behavior: BehaviorSchema.default(defaultBehavior),
	paths: PathsSchema.default(defaultPaths),
	transcription: TranscriptionSchema.default(defaultTranscription),
	overlay: OverlaySchema,
});

export const ConfigFileSchema = z.object({
	apiKeys: ApiKeysSchema.optional(),
	behavior: BehaviorSchema.default(defaultBehavior),
	paths: PathsSchema.default(defaultPaths),
	transcription: TranscriptionSchema.default(defaultTranscription),
	overlay: OverlaySchema,
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * interface representing the raw config file structure before default application
 * (Useful if we want to type the partial JSON read from disk)
 */
export type ConfigFile = z.input<typeof ConfigFileSchema>;
