import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loadConfig } from "../src/config/loader";

const TEST_DIR = join(
	tmpdir(),
	`hyprvox-test-${Math.random().toString(36).slice(2)}`,
);
const CONFIG_FILE = join(TEST_DIR, "config.json");

describe("Config Loader", () => {
	beforeEach(() => {
		if (!require("node:fs").existsSync(TEST_DIR)) {
			mkdirSync(TEST_DIR, { recursive: true });
		}
		delete process.env.GROQ_API_KEY;
		delete process.env.GROQ_FALLBACK_API_KEY;
		delete process.env.DEEPGRAM_API_KEY;
		vi.clearAllMocks();
	});

	afterEach(() => {
		try {
			rmSync(TEST_DIR, { recursive: true, force: true });
		} catch (_e) {}
	});

	test("should load valid config from file", () => {
		const configData = {
			apiKeys: {
				groq: "gsk_1234567890",
				groqFallback: "gsk_abcdefghij",
				deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
			},
		};
		writeFileSync(CONFIG_FILE, JSON.stringify(configData));
		chmodSync(CONFIG_FILE, 0o600);

		const config = loadConfig(CONFIG_FILE);
		expect(config.apiKeys.groq).toBe("gsk_1234567890");
		expect(config.apiKeys.groqFallback).toBe("gsk_abcdefghij");
		expect(config.apiKeys.deepgram).toBe(
			"4b5c1234-5678-90ab-cdef-1234567890ab",
		);
	});

	test("should load fallback Groq API key from env if missing in file", () => {
		const configData = {
			apiKeys: {
				groq: "gsk_1234567890",
				deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
			},
		};
		writeFileSync(CONFIG_FILE, JSON.stringify(configData));
		chmodSync(CONFIG_FILE, 0o600);
		process.env.GROQ_FALLBACK_API_KEY = "gsk_env_fallback_12345";

		const config = loadConfig(CONFIG_FILE, true);
		expect(config.apiKeys.groqFallback).toBe("gsk_env_fallback_12345");
	});

	test("should load config when file does not exist (env fallback)", () => {
		const NON_EXISTENT_FILE = join(TEST_DIR, "non-existent.json");
		process.env.GROQ_API_KEY = "gsk_env_key";
		process.env.DEEPGRAM_API_KEY = "4b5c1234-5678-90ab-cdef-1234567890ab";

		const config = loadConfig(NON_EXISTENT_FILE);
		expect(config.apiKeys.groq).toBe("gsk_env_key");
		expect(config.apiKeys.deepgram).toBe(
			"4b5c1234-5678-90ab-cdef-1234567890ab",
		);
	});

	test("should fallback to env vars if keys missing in file", () => {
		writeFileSync(CONFIG_FILE, JSON.stringify({}));
		chmodSync(CONFIG_FILE, 0o600);

		process.env.GROQ_API_KEY = "gsk_env_key_12345";
		process.env.DEEPGRAM_API_KEY = "4b5c1234-5678-90ab-cdef-1234567890ab";

		const config = loadConfig(CONFIG_FILE);
		expect(config.apiKeys.groq).toBe("gsk_env_key_12345");
		expect(config.apiKeys.deepgram).toBe(
			"4b5c1234-5678-90ab-cdef-1234567890ab",
		);
	});

	test("should throw error if keys are missing in both file and env", () => {
		writeFileSync(CONFIG_FILE, JSON.stringify({}));
		chmodSync(CONFIG_FILE, 0o600);

		// Ensure env is empty
		delete process.env.GROQ_API_KEY;
		delete process.env.DEEPGRAM_API_KEY;

		expect(() => loadConfig(CONFIG_FILE)).toThrow("Config validation failed");
	});

	test("should validate Groq API key format", () => {
		const configData = {
			apiKeys: {
				groq: "invalid_key",
				deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
			},
		};
		writeFileSync(CONFIG_FILE, JSON.stringify(configData));
		chmodSync(CONFIG_FILE, 0o600);

		expect(() => loadConfig(CONFIG_FILE)).toThrow(
			"Groq API key must start with 'gsk_'",
		);
	});

	test("should validate Deepgram API key format", () => {
		const configData = {
			apiKeys: {
				groq: "gsk_1234567890",
				deepgram: "short",
			},
		};
		writeFileSync(CONFIG_FILE, JSON.stringify(configData));
		chmodSync(CONFIG_FILE, 0o600);

		expect(() => loadConfig(CONFIG_FILE)).toThrow(
			"Deepgram API key is too short",
		);
	});

	test("should reject too long Deepgram API key", () => {
		const configData = {
			apiKeys: {
				groq: "gsk_1234567890",
				deepgram: "a".repeat(41),
			},
		};
		writeFileSync(CONFIG_FILE, JSON.stringify(configData));
		chmodSync(CONFIG_FILE, 0o600);

		expect(() => loadConfig(CONFIG_FILE)).toThrow(
			"Deepgram API key is too long",
		);
	});

	test("should validate valid boost words", () => {
		const configData = {
			apiKeys: {
				groq: "gsk_1234567890",
				deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
			},
			transcription: {
				boostWords: ["React", "TypeScript", "Artificial Intelligence"],
				language: "en",
			},
		};
		writeFileSync(CONFIG_FILE, JSON.stringify(configData));
		chmodSync(CONFIG_FILE, 0o600);

		const config = loadConfig(CONFIG_FILE);
		expect(config.transcription.boostWords).toEqual([
			"React",
			"TypeScript",
			"Artificial Intelligence",
		]);
		expect(config.transcription.deepgramBoosting).toBe(false);
	});

	test("should allow opting into Deepgram boosting", () => {
		const configData = {
			apiKeys: {
				groq: "gsk_1234567890",
				deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
			},
			transcription: {
				boostWords: ["Hyprland", "Waybar"],
				deepgramBoosting: true,
				language: "en",
			},
		};
		writeFileSync(CONFIG_FILE, JSON.stringify(configData));
		chmodSync(CONFIG_FILE, 0o600);

		const config = loadConfig(CONFIG_FILE);
		expect(config.transcription.deepgramBoosting).toBe(true);
	});

	test("should validate formatting mode", () => {
		const configData = {
			apiKeys: {
				groq: "gsk_1234567890",
				deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
			},
			transcription: {
				formattingMode: "verbatim",
				language: "en",
			},
		};
		writeFileSync(CONFIG_FILE, JSON.stringify(configData));
		chmodSync(CONFIG_FILE, 0o600);

		const config = loadConfig(CONFIG_FILE);
		expect(config.transcription.formattingMode).toBe("verbatim");
	});

	test("should default formatting mode to clean", () => {
		const configData = {
			apiKeys: {
				groq: "gsk_1234567890",
				deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
			},
		};
		writeFileSync(CONFIG_FILE, JSON.stringify(configData));
		chmodSync(CONFIG_FILE, 0o600);

		const config = loadConfig(CONFIG_FILE);
		expect(config.transcription.formattingMode).toBe("clean");
	});

	test("should apply Groq chunking defaults", () => {
		const configData = {
			apiKeys: {
				groq: "gsk_1234567890",
				deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
			},
		};
		writeFileSync(CONFIG_FILE, JSON.stringify(configData));
		chmodSync(CONFIG_FILE, 0o600);

		const config = loadConfig(CONFIG_FILE);
		expect(config.transcription.groqChunking).toEqual({
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
		});
		expect(config.transcription.debugAudio).toEqual({
			enabled: true,
			keepLast: 5,
			directory: join(homedir(), ".config", "hypr", "vox", "debug-audio"),
		});
	});

	test("should load valid Groq chunking config", () => {
		const configData = {
			apiKeys: {
				groq: "gsk_1234567890",
				deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
			},
			transcription: {
				groqChunking: {
					enabled: true,
					mode: "live",
					minDurationSeconds: 60,
					chunkSeconds: 30,
					overlapSeconds: 2,
					maxConcurrency: 4,
					chunkMaxRetries: 2,
					chunkRetryBackoffMs: 500,
					liveFinalizeTimeoutMs: 3000,
					fallbackToFullAudio: false,
					logChunkTranscripts: false,
				},
				debugAudio: {
					enabled: false,
					keepLast: 9,
					directory: "~/captures",
				},
			},
		};
		writeFileSync(CONFIG_FILE, JSON.stringify(configData));
		chmodSync(CONFIG_FILE, 0o600);

		const config = loadConfig(CONFIG_FILE);
		expect(config.transcription.groqChunking).toEqual(
			configData.transcription.groqChunking,
		);
		expect(config.transcription.debugAudio).toEqual({
			enabled: false,
			keepLast: 9,
			directory: join(homedir(), "captures"),
		});
	});

	test("should reject invalid Groq chunking config", () => {
		const invalidCases = [
			[{ minDurationSeconds: 0 }, "Too small"],
			[{ chunkSeconds: 0 }, "Too small"],
			[
				{ chunkSeconds: 20, overlapSeconds: 20 },
				"Groq chunk overlap must be smaller than chunk duration",
			],
			[{ maxConcurrency: 0 }, "Too small"],
			[{ maxConcurrency: 9 }, "Too big"],
		] as const;

		for (const [groqChunking, expectedMessage] of invalidCases) {
			const configData = {
				apiKeys: {
					groq: "gsk_1234567890",
					deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
				},
				transcription: {
					groqChunking,
				},
			};
			writeFileSync(CONFIG_FILE, JSON.stringify(configData));
			chmodSync(CONFIG_FILE, 0o600);

			expect(() => loadConfig(CONFIG_FILE)).toThrow(expectedMessage);
		}
	});

	test("should reject invalid debug audio config", () => {
		const configData = {
			apiKeys: {
				groq: "gsk_1234567890",
				deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
			},
			transcription: {
				debugAudio: {
					enabled: true,
					keepLast: 0,
				},
			},
		};
		writeFileSync(CONFIG_FILE, JSON.stringify(configData));
		chmodSync(CONFIG_FILE, 0o600);

		expect(() => loadConfig(CONFIG_FILE)).toThrow("Too small");
	});

	test("should allow maxDuration up to 600 seconds", () => {
		const configData = {
			apiKeys: {
				groq: "gsk_1234567890",
				deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
			},
			behavior: {
				clipboard: {
					maxDuration: 600,
				},
			},
		};
		writeFileSync(CONFIG_FILE, JSON.stringify(configData));
		chmodSync(CONFIG_FILE, 0o600);

		const config = loadConfig(CONFIG_FILE);
		expect(config.behavior.clipboard.maxDuration).toBe(600);
	});

	test("should reject maxDuration above 600 seconds", () => {
		const configData = {
			apiKeys: {
				groq: "gsk_1234567890",
				deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
			},
			behavior: {
				clipboard: {
					maxDuration: 601,
				},
			},
		};
		writeFileSync(CONFIG_FILE, JSON.stringify(configData));
		chmodSync(CONFIG_FILE, 0o600);

		expect(() => loadConfig(CONFIG_FILE)).toThrow("Too big");
	});

	test("should reject boost words exceeding limit", () => {
		// Generate 451 words
		const manyWords = Array(451).fill("word");

		const configData = {
			apiKeys: {
				groq: "gsk_1234567890",
				deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
			},
			transcription: {
				boostWords: manyWords,
				language: "en",
			},
		};
		writeFileSync(CONFIG_FILE, JSON.stringify(configData));
		chmodSync(CONFIG_FILE, 0o600);

		expect(() => loadConfig(CONFIG_FILE)).toThrow("Boost words limit exceeded");
	});

	test("should warn if permissions are not 600", () => {
		const configData = {
			apiKeys: {
				groq: "gsk_1234567890",
				deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
			},
		};
		writeFileSync(CONFIG_FILE, JSON.stringify(configData));
		chmodSync(CONFIG_FILE, 0o644); // User read/write, Group read, Others read

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		loadConfig(CONFIG_FILE);

		expect(warnSpy).toHaveBeenCalled();
		expect(warnSpy.mock.calls[0]?.[0]).toContain(
			"WARNING: Config file permissions",
		);

		warnSpy.mockRestore();
	});

	test("should resolve paths with ~", () => {
		const configData = {
			apiKeys: {
				groq: "gsk_1234567890",
				deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
			},
			paths: {
				logs: "~/logs",
				history: "~/history.json",
			},
		};
		writeFileSync(CONFIG_FILE, JSON.stringify(configData));
		chmodSync(CONFIG_FILE, 0o600);

		const config = loadConfig(CONFIG_FILE);
		expect(config.paths.logs).toBe(join(homedir(), "logs"));
		expect(config.paths.history).toBe(join(homedir(), "history.json"));
	});

	test("should throw error if config file is corrupted", () => {
		writeFileSync(CONFIG_FILE, "invalid json {");
		chmodSync(CONFIG_FILE, 0o600);

		expect(() => loadConfig(CONFIG_FILE)).toThrow(
			"Configuration file is corrupted",
		);
	});

	test("should validate valid hotkeys", () => {
		const validHotkeys = [
			"F8",
			"Right Control",
			"Ctrl+Space",
			"Alt+Shift+K",
			"Meta+Enter",
			"NUMPAD 0",
		];

		for (const hotkey of validHotkeys) {
			const configData = {
				apiKeys: {
					groq: "gsk_1234567890",
					deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
				},
				behavior: {
					hotkey: hotkey,
				},
			};
			writeFileSync(CONFIG_FILE, JSON.stringify(configData));
			chmodSync(CONFIG_FILE, 0o600);

			const config = loadConfig(CONFIG_FILE);
			expect(config.behavior.hotkey).toBe(hotkey);
		}
	});

	test("should reject invalid hotkeys", () => {
		const invalidHotkeys = [
			"InvalidKeyName",
			"Ctrl-Space", // Wrong separator
			"Super+BadKey",
			"",
			"   ",
			"Ctrl+", // Trailing plus
			"+A", // Leading plus
		];

		for (const hotkey of invalidHotkeys) {
			const configData = {
				apiKeys: {
					groq: "gsk_1234567890",
					deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
				},
				behavior: {
					hotkey: hotkey,
				},
			};
			writeFileSync(CONFIG_FILE, JSON.stringify(configData));
			chmodSync(CONFIG_FILE, 0o600);

			expect(() => loadConfig(CONFIG_FILE)).toThrow("Invalid hotkey format");
		}
	});
});
