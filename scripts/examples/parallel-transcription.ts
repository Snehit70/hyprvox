import { GroqClient } from "../../src/transcribe/groq";
import { DeepgramTranscriber } from "../../src/transcribe/deepgram";
import { readFileSync } from "node:fs";

/**
 * Parallel Transcription Example
 * 
 * Demonstrates how to run Groq and Deepgram transcriptions in parallel
 * to improve reliability and performance.
 * 
 * Usage:
 * 1. Set GROQ_API_KEY and DEEPGRAM_API_KEY environment variables.
 * 2. Run: bun run scripts/examples/parallel-transcription.ts <path-to-audio.wav>
 */

async function main() {
  const audioPath = process.argv[2];
  if (!audioPath) {
    console.error("Please provide a path to a WAV file.");
    process.exit(1);
  }

  try {
    const audioBuffer = readFileSync(audioPath);
    const groq = new GroqClient();
    const deepgram = new DeepgramTranscriber();

    console.log("Starting parallel transcription...");
    const start = Date.now();

    const [groqResult, deepgramResult] = await Promise.allSettled([
      groq.transcribe(audioBuffer),
      deepgram.transcribe(audioBuffer)
    ]);

    const duration = Date.now() - start;
    console.log(`Finished in ${duration}ms\n`);

    if (groqResult.status === "fulfilled") {
      console.log("[Groq Result]:", groqResult.value);
    } else {
      console.error("[Groq Failed]:", groqResult.reason.message);
    }

    if (deepgramResult.status === "fulfilled") {
      console.log("[Deepgram Result]:", deepgramResult.value);
    } else {
      console.error("[Deepgram Failed]:", deepgramResult.reason.message);
    }

  } catch (error: any) {
    console.error("Fatal error:", error.message);
    process.exit(1);
  }
}

main();
