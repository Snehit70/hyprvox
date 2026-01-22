import Groq from "groq-sdk";
import { withRetry } from "../utils/retry";
import { writeFileSync, unlinkSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../config/loader";
import { logger, logError } from "../utils/logger";

export class GroqClient {
  private client: Groq;

  constructor() {
    const config = loadConfig();
    this.client = new Groq({
      apiKey: config.apiKeys.groq,
    });
  }


  public async transcribe(audioBuffer: Buffer, language: string = "en", boostWords: string[] = []): Promise<string> {
    const tempFile = join(tmpdir(), `voice-cli-${randomUUID()}.wav`);
    
    try {
      writeFileSync(tempFile, audioBuffer);
      
      return await withRetry(async (signal) => {
        const stream = createReadStream(tempFile);
        const prompt = boostWords.length > 0 ? `Keywords: ${boostWords.join(", ")}` : undefined;

        const completion = await this.client.audio.transcriptions.create({
          file: stream,
          model: "whisper-large-v3",
          language: language,
          prompt: prompt,
          response_format: "json",
        }, { 
          signal,
          timeout: 30000,
          maxRetries: 0
        });

        return completion.text.trim();
      }, {
        operationName: "Groq Transcription",
        maxRetries: 2,
        backoffs: [100, 200],
        timeout: 30000,
        shouldRetry: (error: any) => {
          const status = error?.status;
          return status !== 401;
        }
      });
    } catch (error: any) {
      if (error?.status === 401) {
        throw new Error("Groq: Invalid API Key");
      }
      if (error?.status === 429) {
        throw new Error("Groq: Rate limit exceeded. Please wait a moment before trying again.");
      }
      if (error?.message?.includes("timed out")) {
        throw new Error("Groq: Request timed out");
      }
      logError("Groq transcription failed", error);
      throw error;
    } finally {
      try {
        unlinkSync(tempFile);
      } catch (e) {
        
      }
    }
  }
}
