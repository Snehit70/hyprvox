import { execSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { type Recording, record } from "node-record-lpcm16";
import { loadConfig } from "../config/loader";
import { AppError, type ErrorCode, hasErrorCode } from "../utils/errors";
import { logError, logger } from "../utils/logger";
import { withRetry } from "../utils/retry";

export class AudioRecorder extends EventEmitter {
	private recording: Recording | null = null;
	private chunks: Buffer[] = [];
	private startTime: number = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private warningTimer4m: ReturnType<typeof setTimeout> | null = null;
	private warningTimer430m: ReturnType<typeof setTimeout> | null = null;
	private minDuration: number = 600;
	private maxDuration: number = 300000;
	private readonly WARNING_4M = 240000;
	private readonly WARNING_430M = 270000;
	private isStopping: boolean = false;

	constructor() {
		super();
		this.loadSettings();
	}

	private loadSettings() {
		try {
			const config = loadConfig();
			this.minDuration = (config.behavior.clipboard.minDuration || 0.6) * 1000;
			this.maxDuration = (config.behavior.clipboard.maxDuration || 300) * 1000;
		} catch (e) {
			// Use defaults if config load fails
			logger.debug(
				{ err: e },
				"Failed to load recorder settings, using defaults",
			);
		}
	}

	public isRecording(): boolean {
		return this.recording !== null;
	}

	public async start(): Promise<void> {
		if (this.isRecording()) {
			throw new AppError("ALREADY_RECORDING", "Already recording");
		}

		this.loadSettings();
		this.chunks = [];
		this.startTime = Date.now();

		const config = loadConfig();

		try {
			execSync("arecord --version", { stdio: "ignore" });
		} catch (_e) {
			throw new AppError(
				"AUDIO_BACKEND_MISSING",
				"Audio recording backend 'arecord' is not installed or not in PATH.",
			);
		}

		await withRetry(
			async () => {
				return new Promise<void>((resolve, reject) => {
					try {
						this.recording = record({
							sampleRate: 16000,
							channels: 1,
							audioType: "wav",
							recorder: "arecord",
							device: config.behavior.audioDevice,
						});

						let stderrOutput = "";
						if (this.recording.process?.stderr) {
							this.recording.process.stderr.on("data", (chunk: Buffer) => {
								stderrOutput += chunk.toString();
							});
						}

						const stream = this.recording.stream();
						let streamStarted = false;

						stream.on("data", (chunk: Buffer | string) => {
							if (!streamStarted) {
								streamStarted = true;
								resolve();
							}
							const bufferChunk = Buffer.isBuffer(chunk)
								? chunk
								: Buffer.from(chunk, "binary");
							this.chunks.push(bufferChunk);
							this.emit("data", bufferChunk);
						});

						stream.once("error", (err: unknown) => {
							if (this.isStopping) {
								return;
							}

							let errorMessage =
								err instanceof Error ? err.message : String(err);
							let errorCode: ErrorCode = "UNKNOWN_ERROR";

							if (stderrOutput) {
								if (
									stderrOutput.includes("No such file or directory") ||
									stderrOutput.includes("No such device")
								) {
									errorMessage =
										"No microphone detected. Please check if your microphone is connected and configured correctly.";
									errorCode = "NO_MICROPHONE";
								} else if (stderrOutput.includes("Device or resource busy")) {
									errorMessage =
										"Microphone is busy. Another application might be using it.";
									errorCode = "DEVICE_BUSY";
								} else if (
									stderrOutput.includes("Permission denied") ||
									stderrOutput.includes("audio open error")
								) {
									errorMessage =
										"Microphone permission denied. Please check your system settings and ensure your user is in the 'audio' group.";
									errorCode = "PERMISSION_DENIED";
								} else {
									errorMessage = `${errorMessage}. Details: ${stderrOutput.trim()}`;
								}
							}

							const enhancedError = new AppError(errorCode, errorMessage, {
								stderr: stderrOutput,
							});

							if (!streamStarted) {
								this.cleanupRecording().finally(() => reject(enhancedError));
							} else {
								logError("Audio stream error", enhancedError, {
									stderr: stderrOutput,
								});
								this.emit("error", enhancedError);
								this.stop(true);
							}
						});

						// Fallback resolve if no data for 500ms but no error yet
						setTimeout(() => {
							if (!streamStarted && this.recording) {
								streamStarted = true;
								resolve();
							}
						}, 500);
					} catch (error) {
						reject(error);
					}
				});
			},
			{
				operationName: "Start recording",
				maxRetries: 2,
				backoffs: [100, 200],
				shouldRetry: (err) => hasErrorCode(err, "DEVICE_BUSY"),
			},
		);

		this.setupTimers();
		logger.info({ device: config.behavior.audioDevice }, "Recording started");
		this.emit("start");
	}

	private setupTimers() {
		this.cleanupTimers();

		this.warningTimer4m = setTimeout(() => {
			logger.warn("Recording limit approaching (4m)");
			this.emit("warning", "Recording limit approaching (4m)");
		}, this.WARNING_4M);

		this.warningTimer430m = setTimeout(() => {
			logger.warn("Recording limit approaching (4m 30s)");
			this.emit("warning", "Recording limit approaching (4m 30s)");
		}, this.WARNING_430M);

		this.timer = setTimeout(() => {
			logger.warn("Recording limit reached (5m). Auto-stopping.");
			this.emit("warning", "Recording limit reached (5m). Stopping...");
			this.stop();
		}, this.maxDuration);
	}

	public async stop(force = false): Promise<Buffer | null> {
		if (!this.isRecording()) {
			return null;
		}

		this.isStopping = true;
		const duration = Date.now() - this.startTime;
		this.cleanupTimers();

		const audioBuffer = Buffer.concat(this.chunks);
		await this.cleanupRecording();

		if (!force) {
			if (duration < this.minDuration) {
				logger.warn(`Recording too short: ${duration}ms`);
				this.emit(
					"error",
					new AppError("RECORDING_TOO_SHORT", "Recording too short"),
				);
				this.isStopping = false;
				return null;
			}

			if (this.isSilent(audioBuffer)) {
				logger.warn("Silent audio detected");
				this.emit("warning", "No audio detected");
			}
		}

		logger.info(
			`Recording stopped. Duration: ${duration}ms. Size: ${audioBuffer.length} bytes`,
		);
		this.emit("stop", audioBuffer, duration);

		this.isStopping = false;

		return audioBuffer;
	}

	private cleanupTimers() {
		if (this.timer) clearTimeout(this.timer);
		if (this.warningTimer4m) clearTimeout(this.warningTimer4m);
		if (this.warningTimer430m) clearTimeout(this.warningTimer430m);
		this.timer = null;
		this.warningTimer4m = null;
		this.warningTimer430m = null;
	}

	private async cleanupRecording(): Promise<void> {
		if (this.recording) {
			try {
				// Wait for the process to actually exit before continuing
				// This prevents race conditions where the 'close' event fires
				// after we've already reset isStopping
				const proc = this.recording.process;
				if (proc) {
					await new Promise<void>((resolve) => {
						proc.once("close", () => resolve());
						this.recording!.stop();
					});
				} else {
					this.recording.stop();
				}
			} catch (e) {
				logError("Error stopping recording", e);
			}
			this.recording = null;
		}
		this.chunks = [];
	}

	private isSilent(buffer: Buffer): boolean {
		if (buffer.length <= 44) return true;

		// Skip WAV header (44 bytes) if it exists
		const dataOffset = buffer.subarray(0, 4).toString() === "RIFF" ? 44 : 0;
		const samplesBuffer = buffer.subarray(dataOffset);

		if (samplesBuffer.length === 0) return true;

		// Ensure we don't have an odd number of bytes for Int16
		const length = Math.floor(samplesBuffer.length / 2) * 2;
		const int16Array = new Int16Array(
			samplesBuffer.buffer,
			samplesBuffer.byteOffset,
			length / 2,
		);

		const sampleCount = int16Array.length;
		const step = Math.max(1, Math.floor(sampleCount / 1000)); // Sample ~1000 points
		let sumSquares = 0;
		let countedSamples = 0;

		for (let i = 0; i < sampleCount; i += step) {
			const sample = int16Array[i] as number;
			sumSquares += sample * sample;
			countedSamples++;
		}

		const rms = Math.sqrt(sumSquares / (countedSamples || 1));
		const threshold = 100; // Low threshold for silence

		return rms < threshold;
	}
}
