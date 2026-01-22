import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { loadConfig } from "../src/config/loader";
import { writeFileSync, unlinkSync, chmodSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "voice-cli-test-" + Math.random().toString(36).slice(2));
const CONFIG_FILE = join(TEST_DIR, "config.json");

describe("Config Loader", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.GROQ_API_KEY = "";
    process.env.DEEPGRAM_API_KEY = "";
  });

  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch (e) {}
  });

  test("should load valid config from file", () => {
    const configData = {
      apiKeys: {
        groq: "gsk_1234567890",
        deepgram: "12345678-1234-1234-1234-1234567890ab",
      },
    };
    writeFileSync(CONFIG_FILE, JSON.stringify(configData));
    chmodSync(CONFIG_FILE, 0o600);

    const config = loadConfig(CONFIG_FILE);
    expect(config.apiKeys.groq).toBe("gsk_1234567890");
    expect(config.apiKeys.deepgram).toBe("12345678-1234-1234-1234-1234567890ab");
  });

  test("should fallback to env vars if keys missing in file", () => {
    writeFileSync(CONFIG_FILE, JSON.stringify({}));
    chmodSync(CONFIG_FILE, 0o600);

    process.env.GROQ_API_KEY = "gsk_env_key_12345";
    process.env.DEEPGRAM_API_KEY = "11111111-2222-3333-4444-555555555555";

    const config = loadConfig(CONFIG_FILE);
    expect(config.apiKeys.groq).toBe("gsk_env_key_12345");
    expect(config.apiKeys.deepgram).toBe("11111111-2222-3333-4444-555555555555");
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
        deepgram: "12345678-1234-1234-1234-1234567890ab",
      },
    };
    writeFileSync(CONFIG_FILE, JSON.stringify(configData));
    chmodSync(CONFIG_FILE, 0o600);

    expect(() => loadConfig(CONFIG_FILE)).toThrow("Groq API key must start with 'gsk_'");
  });

  test("should validate Deepgram API key format", () => {
    const configData = {
      apiKeys: {
        groq: "gsk_1234567890",
        deepgram: "invalid-uuid",
      },
    };
    writeFileSync(CONFIG_FILE, JSON.stringify(configData));
    chmodSync(CONFIG_FILE, 0o600);

    expect(() => loadConfig(CONFIG_FILE)).toThrow("Deepgram API key must be a valid UUID");
  });

  test("should validate valid boost words", () => {
    const configData = {
      apiKeys: {
        groq: "gsk_1234567890",
        deepgram: "12345678-1234-1234-1234-1234567890ab",
      },
      transcription: {
        boostWords: ["React", "TypeScript", "Artificial Intelligence"],
        language: "en"
      }
    };
    writeFileSync(CONFIG_FILE, JSON.stringify(configData));
    chmodSync(CONFIG_FILE, 0o600);

    const config = loadConfig(CONFIG_FILE);
    expect(config.transcription.boostWords).toEqual(["React", "TypeScript", "Artificial Intelligence"]);
  });

  test("should reject boost words exceeding limit", () => {
    // Generate 451 words
    const manyWords = Array(451).fill("word");
    
    const configData = {
      apiKeys: {
        groq: "gsk_1234567890",
        deepgram: "12345678-1234-1234-1234-1234567890ab",
      },
      transcription: {
        boostWords: manyWords,
        language: "en"
      }
    };
    writeFileSync(CONFIG_FILE, JSON.stringify(configData));
    chmodSync(CONFIG_FILE, 0o600);

    expect(() => loadConfig(CONFIG_FILE)).toThrow("Boost words limit exceeded");
  });

  test("should warn if permissions are not 600", () => {
     const configData = {
      apiKeys: {
        groq: "gsk_1234567890",
        deepgram: "12345678-1234-1234-1234-1234567890ab",
      },
    };
    writeFileSync(CONFIG_FILE, JSON.stringify(configData));
    chmodSync(CONFIG_FILE, 0o644); // User read/write, Group read, Others read

    const warnSpy = mock(console.warn);
    const originalWarn = console.warn;
    console.warn = warnSpy;

    loadConfig(CONFIG_FILE);

    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0]?.[0]).toContain("WARNING: Config file permissions");
    
    console.warn = originalWarn;
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
          deepgram: "12345678-1234-1234-1234-1234567890ab",
        },
        behavior: {
          hotkey: hotkey,
        }
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
      "+A" // Leading plus
    ];

    for (const hotkey of invalidHotkeys) {
      const configData = {
        apiKeys: {
          groq: "gsk_1234567890",
          deepgram: "12345678-1234-1234-1234-1234567890ab",
        },
        behavior: {
          hotkey: hotkey,
        }
      };
      writeFileSync(CONFIG_FILE, JSON.stringify(configData));
      chmodSync(CONFIG_FILE, 0o600);
      
      expect(() => loadConfig(CONFIG_FILE)).toThrow("Invalid hotkey format");
    }
  });
});
