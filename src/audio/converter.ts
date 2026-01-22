import { spawn } from "node:child_process";
import { logger, logError } from "../utils/logger";
import { AppError } from "../utils/errors";

export async function convertAudio(inputBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-i", "pipe:0",
      "-ar", "16000",
      "-ac", "1",
      "-c:a", "pcm_s16le",
      "-f", "wav",
      "pipe:1"
    ]);

    const chunks: Buffer[] = [];
    let stderr = "";

    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("error", (err: any) => {
      if (err.code === "ENOENT") {
        reject(new AppError("FFMPEG_FAILURE", "FFmpeg is not installed"));
      } else {
        reject(new AppError("CONVERSION_FAILED", `FFmpeg process error: ${err.message}`));
      }
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        logError("Audio conversion failed", new Error(stderr));
        reject(new AppError("CONVERSION_FAILED", `FFmpeg exited with code ${code}`));
      }
    });

    ffmpeg.stdin.write(inputBuffer);
    ffmpeg.stdin.end();
  });
}
