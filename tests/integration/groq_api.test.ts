import { describe, it, expect } from "vitest";
import { GroqClient } from "../../src/transcribe/groq";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("Groq API Integration", () => {
  const apiKey = process.env.GROQ_API_KEY;
  const isRealKey = apiKey && apiKey.startsWith("gsk_") && apiKey.length > 20;

  it("should connect to Groq API", async () => {
    if (!isRealKey) return;
    try {
      const client = new GroqClient();
      const isConnected = await client.checkConnection();
      expect(isConnected).toBe(true);
    } catch (error: any) {
      if (error.message.includes("Invalid API Key")) {
        console.warn("Skipping Groq Integration test: Invalid API Key found in environment");
        return;
      }
      throw error;
    }
  });

  it("should transcribe a minimal audio buffer", async () => {
    if (!isRealKey) return;
    try {
      const client = new GroqClient();
      
      const sampleRate = 16000;
      const numSamples = 16000;
      const buffer = Buffer.alloc(44 + numSamples * 2);
      
      buffer.write("RIFF", 0);
      buffer.writeUInt32LE(36 + numSamples * 2, 4);
      buffer.write("WAVE", 8);
      buffer.write("fmt ", 12);
      buffer.writeUInt32LE(16, 16);
      buffer.writeUInt16LE(1, 20);
      buffer.writeUInt16LE(1, 22);
      buffer.writeUInt32LE(sampleRate, 24);
      buffer.writeUInt32LE(sampleRate * 2, 28);
      buffer.writeUInt16LE(2, 32);
      buffer.writeUInt16LE(16, 34);
      buffer.write("data", 36);
      buffer.writeUInt32LE(numSamples * 2, 40);

      const text = await client.transcribe(buffer);
      expect(typeof text).toBe("string");
    } catch (error: any) {
      if (error.message.includes("Invalid API Key")) {
        console.warn("Skipping Groq Integration test: Invalid API Key found in environment");
        return;
      }
      throw error;
    }
  });
});
