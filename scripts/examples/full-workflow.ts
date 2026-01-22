import { AudioRecorder } from "../../src/audio/recorder";
import { GroqClient } from "../../src/transcribe/groq";
import { DeepgramTranscriber } from "../../src/transcribe/deepgram";
import { TranscriptMerger } from "../../src/transcribe/merger";

/**
 * Full Workflow Example
 * 
 * Demonstrates the complete flow:
 * 1. Record audio from microphone.
 * 2. Transcribe in parallel using Groq and Deepgram.
 * 3. Merge the results using the LLM-based TranscriptMerger.
 * 
 * Usage:
 * 1. Set GROQ_API_KEY and DEEPGRAM_API_KEY.
 * 2. Run: bun run scripts/examples/full-workflow.ts
 */

async function main() {
  const recorder = new AudioRecorder();
  const groq = new GroqClient();
  const deepgram = new DeepgramTranscriber();
  const merger = new TranscriptMerger();

  console.log("Microphone starting... Speak now!");
  await recorder.start();

  // Record for 5 seconds for this example
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log("Stopping recording...");
  const buffer = await recorder.stop();

  if (!buffer) {
    console.error("No audio was recorded.");
    process.exit(1);
  }

  console.log(`Audio captured (${buffer.length} bytes). Processing...`);

  try {
    // 1. Parallel Transcription
    const [groqText, deepgramText] = await Promise.all([
      groq.transcribe(buffer).catch(e => {
        console.warn("Groq failed:", e.message);
        return "";
      }),
      deepgram.transcribe(buffer).catch(e => {
        console.warn("Deepgram failed:", e.message);
        return "";
      })
    ]);

    console.log("\n--- Raw Transcripts ---");
    console.log("Groq:", groqText || "(failed)");
    console.log("Deepgram:", deepgramText || "(failed)");

    // 2. Intelligent Merging
    console.log("\nMerging transcripts...");
    const finalResult = await merger.merge(groqText, deepgramText);

    console.log("\n--- Final Merged Result ---");
    console.log(finalResult);
    console.log("---------------------------");

  } catch (error: any) {
    console.error("Workflow failed:", error.message);
  }
}

main().catch(console.error);
