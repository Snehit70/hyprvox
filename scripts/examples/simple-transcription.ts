import { GroqClient } from "../../src/transcribe/groq";
import { readFileSync } from "node:fs";

/**
 * Simple Transcription Example
 * 
 * Demonstrates how to use the GroqClient to transcribe an existing WAV file.
 * 
 * Usage:
 * 1. Set GROQ_API_KEY environment variable.
 * 2. Run: bun run scripts/examples/simple-transcription.ts <path-to-audio.wav>
 */

async function main() {
  const audioPath = process.argv[2];
  if (!audioPath) {
    console.error("Please provide a path to a WAV file.");
    console.log("Usage: bun run scripts/examples/simple-transcription.ts <audio.wav>");
    process.exit(1);
  }

  try {
    const audioBuffer = readFileSync(audioPath);
    const groq = new GroqClient();

    console.log("Transcribing with Groq (Whisper Large V3)...");
    const text = await groq.transcribe(audioBuffer);
    
    console.log("\n--- Transcription Result ---");
    console.log(text);
    console.log("----------------------------");
  } catch (error: any) {
    console.error("Transcription failed:", error.message);
    process.exit(1);
  }
}

main();
