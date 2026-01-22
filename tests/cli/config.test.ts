import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { configCommand } from "../../src/cli/config";
import { DEFAULT_CONFIG_FILE } from "../../src/config/loader";
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "voice-cli-cli-test-" + Math.random().toString(36).slice(2));
const TEST_CONFIG_FILE = join(TEST_DIR, "config.json");

mock.module("../../src/config/loader", () => {
  const original = require("../../src/config/loader");
  return {
    ...original,
    DEFAULT_CONFIG_FILE: TEST_CONFIG_FILE
  };
});

describe("CLI: config command", () => {
  let logSpy: any;
  let errorSpy: any;

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(TEST_CONFIG_FILE, JSON.stringify({
      apiKeys: {
        groq: "gsk_test_key_12345",
        deepgram: "4b5c1234567890abcdef1234567890abcdef12"
      }
    }));
    logSpy = mock(console.log);
    errorSpy = mock(console.error);
    (console as any).log = logSpy;
    (console as any).error = errorSpy;
  });

  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch (e) {}
  });

  test("config list should work", async () => {
    await configCommand.parseAsync(["list"], { from: "user" });

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls.map((call: any[]) => JSON.stringify(call)).join("\n");
    expect(output).toContain("gsk_****2345");
    expect(output).toContain("****ef12");
  });

  test("config get should work for specific key", async () => {
    await configCommand.parseAsync(["get", "behavior.hotkey"], { from: "user" });

    expect(logSpy).toHaveBeenCalled();
    expect(logSpy.mock.calls[0]?.[0]).toBe("Right Control");
  });

  test("config set should update value", async () => {
    await configCommand.parseAsync(["set", "behavior.toggleMode", "false"], { from: "user" });

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls.map((call: any[]) => JSON.stringify(call)).join("\n");
    expect(output).toContain("Set");
    expect(output).toContain("behavior.toggleMode");
    expect(output).toContain("false");

    const content = JSON.parse(require("node:fs").readFileSync(TEST_CONFIG_FILE, "utf-8"));
    expect(content.behavior.toggleMode).toBe(false);
  });

  test("config set should validate value via Zod", async () => {
    await configCommand.parseAsync(["set", "apiKeys.groq", "invalid"], { from: "user" });

    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls[0]?.[1]).toContain("apiKeys.groq: Groq API key must start with 'gsk_'");
  });

  test("config set should handle numbers", async () => {
    await configCommand.parseAsync(["set", "behavior.clipboard.minDuration", "1.5"], { from: "user" });

    const content = JSON.parse(require("node:fs").readFileSync(TEST_CONFIG_FILE, "utf-8"));
    expect(content.behavior.clipboard.minDuration).toBe(1.5);
  });
});
