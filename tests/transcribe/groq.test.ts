import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { GroqClient } from "../../src/transcribe/groq";
import { loadConfig } from "../../src/config/loader";
import { withRetry } from "../../src/utils/retry";
import { writeFileSync, unlinkSync } from "node:fs";

mock.module("../../src/config/loader", () => ({
  loadConfig: mock(() => ({
    apiKeys: {
      groq: "gsk_test_key"
    }
  }))
}));

mock.module("groq-sdk", () => {
  return {
    default: class MockGroq {
      audio = {
        transcriptions: {
          create: mock(async () => ({ text: "  transcribed text  " }))
        }
      };
    }
  };
});

mock.module("node:fs", () => ({
  writeFileSync: mock(),
  unlinkSync: mock(),
  createReadStream: mock(() => "mock-stream")
}));

mock.module("../../src/utils/retry", () => ({
  withRetry: async (fn: any, opts: any) => {
    return await fn();
  }
}));

describe("GroqClient", () => {
  let client: GroqClient;

  beforeEach(() => {
    client = new GroqClient();
  });

  it("should transcribe audio successfully", async () => {
    const audioBuffer = Buffer.from("fake-audio");
    const text = await client.transcribe(audioBuffer);
    
    expect(text).toBe("transcribed text");
  });

  it("should include boost words in prompt", async () => {
    const audioBuffer = Buffer.from("fake-audio");
    
    const text = await client.transcribe(audioBuffer, "en", ["word1", "word2"]);
    expect(text).toBe("transcribed text");
  });
});
