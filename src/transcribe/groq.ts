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
      
      return await withRetry(async () => {
        const stream = createReadStream(tempFile);
        const prompt = boostWords.length > 0 ? `Keywords: ${boostWords.join(", ")}` : undefined;

        const completion = await this.client.audio.transcriptions.create({
          file: stream,
          model: "whisper-large-v3",
          language: language,
          prompt: prompt,
          response_format: "json",
        });

        return completion.text.trim();
      }, {
        operationName: "Groq Transcription",
        maxRetries: 2,
        backoffs: [100, 200],
        timeout: 30000
      });
    } catch (error) {
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
