import { spawn } from "node:child_process";
import { AppError } from "../utils/errors";
import { logError, logger } from "../utils/logger";

export async function convertAudio(inputBuffer: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const inputSize = inputBuffer.length;
		const startTime = Date.now();

		const ffmpeg = spawn("ffmpeg", [
			"-y",
			"-i",
			"pipe:0",
			"-ar",
			"16000",
			"-ac",
			"1",
			"-c:a",
			"libopus",
			"-b:a",
			"32k",
			"-compression_level",
			"0",
			"-frame_duration",
			"60",
			"-f",
			"opus",
			"pipe:1",
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
				reject(
					new AppError(
						"CONVERSION_FAILED",
						`FFmpeg process error: ${err.message}`,
					),
				);
			}
		});

		ffmpeg.on("close", (code) => {
			if (code === 0) {
				const outputBuffer = Buffer.concat(chunks);
				const outputSize = outputBuffer.length;
				const duration = Date.now() - startTime;
				logger.debug(
					{
						inputSize,
						outputSize,
						compressionRatio:
							inputSize > 0
								? `${((1 - outputSize / inputSize) * 100).toFixed(1)}%`
								: "N/A",
						durationMs: duration,
						format: "opus",
					},
					"Audio conversion complete",
				);
				resolve(outputBuffer);
			} else {
				logError("Audio conversion failed", new Error(stderr));
				reject(
					new AppError("CONVERSION_FAILED", `FFmpeg exited with code ${code}`),
				);
			}
		});

		// ffmpeg may exit (e.g. on bad input) before stdin is fully written,
		// producing an EPIPE on the pipe. Without a listener that becomes an
		// unhandled error that crashes the process; the 'close' handler above
		// still rejects with the real exit code/stderr.
		ffmpeg.stdin.on("error", (err) => {
			logger.debug({ err }, "ffmpeg stdin closed before write completed");
		});

		ffmpeg.stdin.write(inputBuffer);
		ffmpeg.stdin.end();
	});
}
