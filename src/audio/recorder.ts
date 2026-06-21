import { execSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { type Recording, record } from "node-record-lpcm16";
import { loadConfig } from "../config/loader";
import { AppError, type ErrorCode, hasErrorCode } from "../utils/errors";
import { logError, logger } from "../utils/logger";
import { withRetry } from "../utils/retry";
import { PcmStreamExtractor } from "./pcm-stream";

export interface AudioLevelPayload {
	level: number;
	peak: number;
	waveform: number[];
	timestamp: number;
}

export interface PcmAudioPayload {
	pcm: Buffer;
	timestamp: number;
	sampleRate: 16000;
	channels: 1;
	bitsPerSample: 16;
}

type RecordingFactory = typeof record;

const WAVEFORM_FFT_SIZE = 256;
const WAVEFORM_BIN_COUNT = 24;

/**
 * Build the same kind of speech-frequency spectrum the former Web Audio
 * analyser exposed to the Electron overlay. Values are normalized to 0..1.
 */
export function buildWaveformBins(
	samples: Int16Array,
	binCount = WAVEFORM_BIN_COUNT,
): number[] {
	if (samples.length === 0 || binCount <= 0) return [];

	const real = new Float64Array(WAVEFORM_FFT_SIZE);
	const imaginary = new Float64Array(WAVEFORM_FFT_SIZE);
	const sourceStart = Math.max(0, samples.length - WAVEFORM_FFT_SIZE);
	const targetStart = Math.max(0, WAVEFORM_FFT_SIZE - samples.length);
	const copyLength = Math.min(samples.length, WAVEFORM_FFT_SIZE);

	for (let index = 0; index < copyLength; index++) {
		const windowIndex = targetStart + index;
		const window =
			0.5 -
			0.5 * Math.cos((2 * Math.PI * windowIndex) / (WAVEFORM_FFT_SIZE - 1));
		real[windowIndex] = ((samples[sourceStart + index] ?? 0) / 32768) * window;
	}

	// In-place radix-2 FFT.
	for (let index = 1, reversed = 0; index < WAVEFORM_FFT_SIZE; index++) {
		let bit = WAVEFORM_FFT_SIZE >> 1;
		for (; reversed & bit; bit >>= 1) reversed ^= bit;
		reversed ^= bit;
		if (index < reversed) {
			[real[index], real[reversed]] = [real[reversed] ?? 0, real[index] ?? 0];
		}
	}

	for (let size = 2; size <= WAVEFORM_FFT_SIZE; size <<= 1) {
		const angle = (-2 * Math.PI) / size;
		const stepReal = Math.cos(angle);
		const stepImaginary = Math.sin(angle);
		for (let start = 0; start < WAVEFORM_FFT_SIZE; start += size) {
			let twiddleReal = 1;
			let twiddleImaginary = 0;
			for (let offset = 0; offset < size / 2; offset++) {
				const even = start + offset;
				const odd = even + size / 2;
				const oddReal = real[odd] ?? 0;
				const oddImaginary = imaginary[odd] ?? 0;
				const productReal =
					oddReal * twiddleReal - oddImaginary * twiddleImaginary;
				const productImaginary =
					oddReal * twiddleImaginary + oddImaginary * twiddleReal;
				const evenReal = real[even] ?? 0;
				const evenImaginary = imaginary[even] ?? 0;

				real[odd] = evenReal - productReal;
				imaginary[odd] = evenImaginary - productImaginary;
				real[even] = evenReal + productReal;
				imaginary[even] = evenImaginary + productImaginary;

				const nextTwiddleReal =
					twiddleReal * stepReal - twiddleImaginary * stepImaginary;
				twiddleImaginary =
					twiddleReal * stepImaginary + twiddleImaginary * stepReal;
				twiddleReal = nextTwiddleReal;
			}
		}
	}

	const frequencyBinCount = WAVEFORM_FFT_SIZE / 2;
	const startBin = Math.floor(frequencyBinCount * 0.05);
	const endBin = Math.floor(frequencyBinCount * 0.4);
	const result: number[] = [];

	for (let outputIndex = 0; outputIndex < binCount; outputIndex++) {
		const rangeStart = Math.floor(
			startBin + ((endBin - startBin) * outputIndex) / binCount,
		);
		const rangeEnd = Math.max(
			rangeStart + 1,
			Math.floor(
				startBin + ((endBin - startBin) * (outputIndex + 1)) / binCount,
			),
		);
		let strongest = 0;
		for (let fftIndex = rangeStart; fftIndex < rangeEnd; fftIndex++) {
			const magnitude = Math.hypot(
				real[fftIndex] ?? 0,
				imaginary[fftIndex] ?? 0,
			);
			strongest = Math.max(strongest, magnitude / (WAVEFORM_FFT_SIZE * 0.25));
		}

		// Match the former analyser's -85 dB to -25 dB display range.
		const decibels = 20 * Math.log10(Math.max(strongest, 1e-6));
		result.push(Math.max(0, Math.min(1, (decibels + 85) / 60)));
	}

	return result;
}

export interface AudioRecorderOptions {
	createRecording?: RecordingFactory;
	loadConfigFn?: typeof loadConfig;
}

export function assertAudioBackendAvailable(
	check: () => void = () => execSync("arecord --version", { stdio: "ignore" }),
): void {
	try {
		check();
	} catch (_e) {
		throw new AppError(
			"AUDIO_BACKEND_MISSING",
			"Audio recording backend 'arecord' is not installed or not in PATH.",
		);
	}
}

export class AudioRecorder extends EventEmitter {
	private recording: Recording | null = null;
	private readonly createRecording: RecordingFactory;
	private readonly loadConfigFn: typeof loadConfig;
	private chunks: Buffer[] = [];
	private startTime: number = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private warningTimer4m: ReturnType<typeof setTimeout> | null = null;
	private warningTimer430m: ReturnType<typeof setTimeout> | null = null;
	private minDuration: number = 600;
	private maxDuration: number = 600000;
	private isStopping: boolean = false;
	private pcmExtractor = new PcmStreamExtractor();
	// Samples carried between arecord chunks so the overlay receives a steady
	// stream of ~16 ms frames instead of one coarse frame per 125 ms chunk.
	private levelPending: Int16Array = new Int16Array(0);

	constructor(options: AudioRecorderOptions = {}) {
		super();
		this.createRecording = options.createRecording ?? record;
		this.loadConfigFn = options.loadConfigFn ?? loadConfig;
		this.loadSettings();
	}

	private loadSettings() {
		try {
			const config = this.loadConfigFn();
			this.minDuration = (config.behavior.clipboard.minDuration || 0.6) * 1000;
			this.maxDuration = (config.behavior.clipboard.maxDuration || 600) * 1000;
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
		this.pcmExtractor.reset();
		this.levelPending = new Int16Array(0);
		this.startTime = Date.now();

		const config = this.loadConfigFn();
		let startEmitted = false;

		await withRetry(
			async () => {
				return new Promise<void>((resolve, reject) => {
					try {
						this.recording = this.createRecording({
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

						if (!startEmitted) {
							this.setupTimers();
							logger.info(
								{ device: config.behavior.audioDevice },
								"Recording started",
							);
							this.emit("start");
							startEmitted = true;
						}

						stream.on("data", (chunk: Buffer | string) => {
							if (!streamStarted) {
								streamStarted = true;
								resolve();
							}
							const bufferChunk = Buffer.isBuffer(chunk)
								? chunk
								: Buffer.from(chunk, "binary");
							this.chunks.push(bufferChunk);
							const pcmChunk = this.pcmExtractor.accept(bufferChunk);
							if (pcmChunk) {
								const timestamp = Date.now();
								this.emitAudioFrames(pcmChunk.pcm, timestamp);
								this.emit("pcm-data", {
									...pcmChunk,
									timestamp,
								} satisfies PcmAudioPayload);
							}
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
	}

	private setupTimers() {
		this.cleanupTimers();
		const warningAt80Pct = Math.floor(this.maxDuration * 0.8);
		const warningAt90Pct = Math.floor(this.maxDuration * 0.9);
		const warning80Label = this.formatDurationMs(warningAt80Pct);
		const warning90Label = this.formatDurationMs(warningAt90Pct);
		const maxDurationLabel = this.formatDurationMs(this.maxDuration);

		this.warningTimer4m = setTimeout(() => {
			logger.warn(`Recording limit approaching (${warning80Label})`);
			this.emit("warning", `Recording limit approaching (${warning80Label})`);
		}, warningAt80Pct);

		this.warningTimer430m = setTimeout(() => {
			logger.warn(`Recording limit approaching (${warning90Label})`);
			this.emit("warning", `Recording limit approaching (${warning90Label})`);
		}, warningAt90Pct);

		this.timer = setTimeout(() => {
			logger.warn(
				`Recording limit reached (${maxDurationLabel}). Auto-stopping.`,
			);
			this.emit(
				"warning",
				`Recording limit reached (${maxDurationLabel}). Stopping...`,
			);
			this.stop();
		}, this.maxDuration);
	}

	private formatDurationMs(durationMs: number): string {
		const totalSeconds = Math.floor(durationMs / 1000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;

		if (seconds === 0) {
			return `${minutes}m`;
		}

		return `${minutes}m ${seconds}s`;
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
		this.cleanupTimers();
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

	/**
	 * arecord delivers one ~125 ms chunk roughly every 128 ms, so a single
	 * level reading per chunk only gives the overlay ~8 fps of heavily averaged
	 * data. Slicing each chunk into {@link WAVEFORM_FFT_SIZE}-sample hops (16 ms
	 * at 16 kHz) emits ~60 fps of frame-accurate level/spectrum instead, with
	 * each frame's RMS, peak, and FFT computed over the same window. Leftover
	 * samples are carried into the next chunk so no audio is dropped.
	 */
	private emitAudioFrames(chunk: Buffer, chunkTimestamp: number): void {
		const evenLength = Math.floor(chunk.length / 2) * 2;
		const aligned =
			evenLength > 0 ? Buffer.from(chunk.subarray(0, evenLength)) : null;
		const incoming = aligned
			? new Int16Array(aligned.buffer, aligned.byteOffset, evenLength / 2)
			: new Int16Array(0);

		const combined = new Int16Array(this.levelPending.length + incoming.length);
		combined.set(this.levelPending, 0);
		combined.set(incoming, this.levelPending.length);

		const hop = WAVEFORM_FFT_SIZE;
		const hopCount = Math.floor(combined.length / hop);
		if (hopCount === 0) {
			this.levelPending = combined;
			return;
		}

		const hopDurationMs = (hop / 16000) * 1000;
		for (let frame = 0; frame < hopCount; frame++) {
			const window = combined.subarray(frame * hop, (frame + 1) * hop);
			// Space timestamps by the audio time each hop represents so the
			// daemon's per-frame throttle forwards every hop instead of
			// collapsing the burst into a single wall-clock millisecond.
			const timestamp = Math.round(
				chunkTimestamp - (hopCount - 1 - frame) * hopDurationMs,
			);
			this.emit("level", {
				...this.frameFromSamples(window),
				timestamp,
			} satisfies AudioLevelPayload);
		}

		this.levelPending = combined.slice(hopCount * hop);
	}

	private frameFromSamples(
		samples: Int16Array,
	): Omit<AudioLevelPayload, "timestamp"> {
		let sumSquares = 0;
		let peak = 0;

		for (let i = 0; i < samples.length; i++) {
			const sample = samples[i] as number;
			const normalized = Math.abs(sample) / 32768;
			sumSquares += normalized * normalized;
			if (normalized > peak) {
				peak = normalized;
			}
		}

		const rms = Math.sqrt(sumSquares / (samples.length || 1));

		return {
			level: Math.min(1, rms),
			peak: Math.min(1, peak),
			waveform: buildWaveformBins(samples),
		};
	}
}
