import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { saveConfig } from "../src/config/writer";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type ConfigFile } from "../src/config/schema";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    mkdirSync: vi.fn(actual.mkdirSync),
    writeFileSync: vi.fn(actual.writeFileSync),
    existsSync: vi.fn(actual.existsSync),
  };
});

const TEST_DIR = join(tmpdir(), "voice-cli-writer-test-" + Math.random().toString(36).slice(2));
const CONFIG_FILE = join(TEST_DIR, "config.json");

describe("Config Writer", () => {
  beforeEach(() => {
    // We use the mocked existsSync but since we didn't override it yet, it works normally
    if (fs.existsSync(TEST_DIR)) {
        try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (e) {}
    }
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
        try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (e) {}
    }
  });

  test("should write valid config to file", () => {
    const config: ConfigFile = {
      behavior: {
        hotkey: "Ctrl+Space",
      },
    };

    saveConfig(config, CONFIG_FILE);

    expect(fs.existsSync(CONFIG_FILE)).toBe(true);
    const content = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    expect(content.behavior.hotkey).toBe("Ctrl+Space");
    expect(content.behavior.toggleMode).toBe(true); 
  });

  test("should create directory if it does not exist", () => {
    const config: ConfigFile = {};
    saveConfig(config, CONFIG_FILE);
    expect(fs.existsSync(TEST_DIR)).toBe(true);
    expect(fs.existsSync(CONFIG_FILE)).toBe(true);
  });

  test("should set file permissions to 600", () => {
    const config: ConfigFile = {};
    saveConfig(config, CONFIG_FILE);
    const stats = fs.statSync(CONFIG_FILE);
    const mode = stats.mode & 0o777;
    
    expect(mode).toBe(0o600);
  });

  test("should throw error on invalid config", () => {
    const config = {
      behavior: {
        clipboard: {
           minDuration: 0.1
        }
      }
    } as any; 

    expect(() => saveConfig(config, CONFIG_FILE)).toThrow("Config validation failed");
  });
  
  test("should throw error on invalid boost words", () => {
      const words = Array(500).fill("word");
      const config = {
          transcription: {
              boostWords: words
          }
      };
      
      expect(() => saveConfig(config as any, CONFIG_FILE)).toThrow("Boost words limit exceeded");
  });

  test("should throw error if mkdirSync fails", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => {
      throw new Error("Permission denied");
    });

    const config: ConfigFile = {};
    const expectedMessage = "Failed to save configuration";
    expect(() => saveConfig(config, CONFIG_FILE)).toThrow(expectedMessage);
    
    try {
      saveConfig(config, CONFIG_FILE);
    } catch (e: any) {
      expect(e.context.message).toBe("Permission denied");
    }
  });

  test("should throw error if writeFileSync fails", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error("Disk full");
    });

    const config: ConfigFile = {};
    const expectedMessage = "Failed to save configuration";
    expect(() => saveConfig(config, CONFIG_FILE)).toThrow(expectedMessage);

    try {
      saveConfig(config, CONFIG_FILE);
    } catch (e: any) {
      expect(e.context.message).toBe("Disk full");
    }
  });
});
