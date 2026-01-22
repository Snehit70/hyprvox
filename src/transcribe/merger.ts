import Groq from "groq-sdk";
import { loadConfig } from "../config/loader";
import { logError } from "../utils/logger";
import { withRetry } from "../utils/retry";

export class TranscriptMerger {
  private client: Groq;

  constructor() {
    const config = loadConfig();
    this.client = new Groq({
      apiKey: config.apiKeys.groq,
    });
  }

  public async merge(groqText: string, deepgramText: string): Promise<string> {
    if (!groqText && !deepgramText) return "";
    if (!groqText) return deepgramText;
    if (!deepgramText) return groqText;

    if (groqText === deepgramText) return deepgramText;

    try {
      const completion = await withRetry(async (signal) => {
        return await this.client.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `You are an expert editor. I will provide two transcripts of the same audio.
Transcript 1 (Groq Whisper): Accurate words, technical terms.
Transcript 2 (Deepgram Nova): Good formatting, punctuation, casing.

Your task: Merge them into a single perfect transcript.
Rules:
1. Trust Transcript 1 for specific words, spelling, and technical terms.
2. Trust Transcript 2 for punctuation, casing, and number formatting.
3. Remove any hallucinations (repeated phrases, non-speech, silence).
4. Output ONLY the final merged text. Do not add any preamble or quotes.`,
            },
            {
              role: "user",
              content: `Transcript 1:
${groqText}

Transcript 2:
${deepgramText}`,
            },
          ],
          model: "llama-3.3-70b-versatile",
          temperature: 0.1,
          max_tokens: 4096,
        }, { 
          signal,
          timeout: 30000,
          maxRetries: 0
        });
      }, {
        operationName: "LLM Merge",
        maxRetries: 2,
        backoffs: [100, 200],
        timeout: 30000,
        shouldRetry: (error: any) => {
          const status = error?.status;
          return status !== 401;
        }
      });

      const merged = completion.choices[0]?.message?.content?.trim();
      return merged || deepgramText;
    } catch (error: any) {
      if (error?.status === 429) {
        logError("LLM merge skipped (Rate Limit exceeded after retries)", error);
      } else if (error?.message?.includes("timed out")) {
        logError("LLM merge skipped (Timeout)", error);
      } else {
        logError("LLM merge failed", error);
      }
      return deepgramText;
    }
  }
}
