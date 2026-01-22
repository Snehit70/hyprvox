import { createClient, type DeepgramClient } from "@deepgram/sdk";
import { loadConfig } from "../config/loader";
import { logger, logError } from "../utils/logger";
import { withRetry } from "../utils/retry";

export class DeepgramTranscriber {
  private client: DeepgramClient;

  constructor() {
    const config = loadConfig();
    this.client = createClient(config.apiKeys.deepgram);
  }

  public async transcribe(audioBuffer: Buffer, language: string = "en", boostWords: string[] = []): Promise<string> {
    try {
      return await withRetry(async () => {
        const { result, error } = await this.client.listen.prerecorded.transcribeFile(
          audioBuffer,
          {
            model: "nova-3",
            smart_format: true,
            punctuate: true,
            language: language,
            keywords: boostWords,
          }
        );

        if (error) throw error;
        
        const text = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
        if (!text) return "";
        return text.trim();
      }, {
        operationName: "Deepgram Nova-3",
        maxRetries: 2,
        backoffs: [100, 200],
        timeout: 30000
      });
    } catch (error) {
      logError("Deepgram Nova-3 failed, trying fallback", error);
      
      try {
        return await withRetry(async () => {
          const { result, error: retryError } = await this.client.listen.prerecorded.transcribeFile(
            audioBuffer,
            {
              model: "nova-2",
              smart_format: true,
              punctuate: true,
              language: language,
              keywords: boostWords,
            }
          );

          if (retryError) throw retryError;
          return result?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || "";
        }, {
          operationName: "Deepgram Nova-2 Fallback",
          maxRetries: 2,
          backoffs: [100, 200],
          timeout: 30000
        });
      } catch (retryError) {
        logError("Deepgram fallback failed", retryError);
        throw retryError;
      }
    }
  }
}
