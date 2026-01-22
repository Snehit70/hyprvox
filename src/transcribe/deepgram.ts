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

  /**
   * Checks connectivity to the Deepgram API by fetching projects.
   * This is used for health checks and API key validation.
   */
  public async checkConnection(): Promise<boolean> {
    try {
      return await withRetry(async () => {
        const { result, error } = await this.client.manage.getProjects();
        if (error) throw error;
        return !!(result && result.projects);
      }, {
        operationName: "Deepgram Connectivity Check",
        maxRetries: 2,
        backoffs: [100, 200],
        timeout: 10000,
        shouldRetry: (error: any) => {
          const status = error?.status || (error?.message?.includes("401") ? 401 : undefined);
          return status !== 401;
        }
      });
    } catch (error: any) {
      if (error?.status === 401 || error?.message?.includes("401")) {
        throw new Error("Deepgram: Invalid API Key");
      }
      logError("Deepgram connectivity check failed", error, { operation: "checkConnection" });
      throw error;
    }
  }

  public async transcribe(audioBuffer: Buffer, language: string = "en", boostWords: string[] = []): Promise<string> {
    try {
      return await withRetry(async (_signal) => {
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

        logger.info({ 
          textLength: text.length,
          confidence: result?.results?.channels?.[0]?.alternatives?.[0]?.confidence,
          model: "nova-3",
          language,
          boostWordsCount: boostWords.length
        }, "Deepgram Nova-3 transcription success");

        return text.trim();
      }, {
        operationName: "Deepgram Nova-3",
        maxRetries: 2,
        backoffs: [100, 200],
        timeout: 30000,
        shouldRetry: (error: any) => {
          const status = error?.status || (error?.message?.includes("401") ? 401 : undefined) || (error?.message?.includes("429") ? 429 : undefined);
          return status !== 401 && status !== 429;
        }
      });
    } catch (error: any) {
      if (error?.status === 401 || error?.message?.includes("401")) {
        throw new Error("Deepgram: Invalid API Key");
      }
      if (error?.status === 429 || error?.message?.includes("429")) {
        throw new Error("Deepgram: Rate limit exceeded. Please wait a moment before trying again.");
      }
      logError("Deepgram Nova-3 failed, trying fallback", error, { 
        language, 
        boostWordsCount: boostWords.length 
      });
      
      try {
        return await withRetry(async (_signal) => {
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
          const text = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || "";
          
          logger.info({ 
            textLength: text.length,
            model: "nova-2",
            language,
            boostWordsCount: boostWords.length
          }, "Deepgram Nova-2 fallback success");
          
          return text;
        }, {
          operationName: "Deepgram Nova-2 Fallback",
          maxRetries: 2,
          backoffs: [100, 200],
          timeout: 30000,
          shouldRetry: (error: any) => {
            const status = error?.status || (error?.message?.includes("401") ? 401 : undefined) || (error?.message?.includes("429") ? 429 : undefined);
            return status !== 401;
          }
        });
      } catch (retryError: any) {
        if (retryError?.status === 401 || retryError?.message?.includes("401")) {
          throw new Error("Deepgram: Invalid API Key");
        }
        if (retryError?.status === 429 || retryError?.message?.includes("429")) {
          throw new Error("Deepgram: Rate limit exceeded. Please wait a moment before trying again.");
        }
        if (retryError?.message?.includes("timed out")) {
          throw new Error("Deepgram: Request timed out");
        }
        logError("Deepgram fallback failed", retryError, { 
          language, 
          boostWordsCount: boostWords.length 
        });
        throw retryError;
      }
    }
  }
}
