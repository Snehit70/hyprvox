import { unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { convertAudio } from "../audio/converter";
import { AudioRecorder } from "../audio/recorder";
import { loadConfig } from "../config/loader";
import { ClipboardAccessError, ClipboardManager } from "../output/clipboard";
import { notify } from "../output/notification";
import { DeepgramTranscriber } from "../transcribe/deepgram";
import { DeepgramStreamingTranscriber } from "../transcribe/deepgram-streaming";
import { GroqClient } from "../transcribe/groq";
import { TranscriptMerger } from "../transcribe/merger";
import { ErrorTemplates, formatUserError } from "../utils/error-templates";
import type { ErrorCode } from "../utils/errors";
import { AppError } from "../utils/errors";
import { appendHistory } from "../utils/history";
import { logError, logger } from "../utils/logger";
import { incrementTranscriptionCount, loadStats } from "../utils/stats";
import { checkHotkeyConflict } from "./conflict";
import { HotkeyListener } from "./hotkey";

const HALLUCINATION_MAX_CHARS = 20;

type DaemonStatus =
	| "idle"
	| "starting"
	| "recording"
	| "stopping"
	| "processing"
	| "error";

export interface DaemonState {
	status: DaemonStatus;
	pid: number;
	uptime: number;
	lastTranscription?: string;
	transcriptionCountToday: number;
	transcriptionCountTotal: number;
	errorCount: number;
	lastError?: string;
}

export class DaemonService {
	private status: DaemonStatus = "idle";
	private recorder: AudioRecorder;
	private hotkeyListener: HotkeyListener;
	private groq: GroqClient;
	private deepgram: DeepgramTranscriber;
	private deepgramStreaming?: DeepgramStreamingTranscriber;
	private streamingDataHandler?: (chunk: Buffer) => void;
	private merger: TranscriptMerger;
	private clipboard: ClipboardManager;
	private pidFile: string;
	private stateFile: string;
	private lastTranscription?: Date;
	private transcriptionCountToday: number = 0;
	private transcriptionCountTotal: number = 0;
	private errorCount: number = 0;
	private lastError?: string;
	private startTime: number = Date.now();
	private signalHandler: () => void;
	private keepAliveInterval?: NodeJS.Timeout;
	private cancelPending = false;

	constructor() {
		this.recorder = new AudioRecorder();
		this.hotkeyListener = new HotkeyListener();
		this.groq = new GroqClient();
		this.deepgram = new DeepgramTranscriber();
		this.merger = new TranscriptMerger();
		this.clipboard = new ClipboardManager();
		const configDir = join(homedir(), ".config", "voice-cli");
		this.pidFile = join(configDir, "daemon.pid");
		this.stateFile = join(configDir, "daemon.state");

		const stats = loadStats();
		this.transcriptionCountToday = stats.today;
		this.transcriptionCountTotal = stats.total;

		this.signalHandler = () => {
			logger.info("Received SIGUSR1 signal, toggling recording");
			this.handleTrigger();
		};

		this.setupListeners();
		this.setupSignalHandlers();
	}

	private setupSignalHandlers() {
		process.on("SIGUSR1", this.signalHandler);
	}

	private updateState() {
		const state: DaemonState = {
			status: this.status,
			pid: process.pid,
			uptime: Math.floor((Date.now() - this.startTime) / 1000),
			lastTranscription: this.lastTranscription?.toISOString(),
			transcriptionCountToday: this.transcriptionCountToday,
			transcriptionCountTotal: this.transcriptionCountTotal,
			errorCount: this.errorCount,
			lastError: this.lastError,
		};
		try {
			writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
			logger.debug({ status: this.status }, "Daemon state updated");
		} catch (e) {
			logError("Failed to update daemon state file", e, {
				stateFile: this.stateFile,
			});
		}
	}

	private setStatus(status: DaemonStatus, error?: string) {
		const oldStatus = this.status;
		this.status = status;
		if (status === "starting" || status === "recording") {
			this.lastError = undefined;
		}
		if (error) {
			this.lastError = error;
		}

		if (oldStatus !== status) {
			logger.info(
				{ from: oldStatus, to: status },
				`Daemon status changed: ${status}`,
			);
		}

		this.updateState();
	}

	private setupListeners() {
		this.hotkeyListener.on("trigger", () => this.handleTrigger());

		this.recorder.on("start", () => {
			this.setStatus("recording");
			notify("Recording Started", "Listening...", "info");
		});

		this.recorder.on("stop", (audioBuffer: Buffer, duration: number) => {
			this.setStatus("processing");
			notify("Recording Stopped", "Processing transcription...", "info");
			this.processAudio(audioBuffer, duration);
		});

		this.recorder.on("warning", (msg: string) => {
			notify("Warning", msg, "warning");
		});

		this.recorder.on("error", (err: Error) => {
			this.errorCount++;
			this.setStatus("error", err.message);

			if (this.streamingDataHandler) {
				this.recorder.off("data", this.streamingDataHandler);
				this.streamingDataHandler = undefined;
			}
			if (this.deepgramStreaming) {
				this.deepgramStreaming
					.stop()
					.catch((e) =>
						logError("Failed to stop streaming on recorder error", e),
					);
				this.deepgramStreaming = undefined;
			}

			let title = "Error";
			let message = err.message;

			const code = (err as any).code as ErrorCode;

			if (code === "NO_MICROPHONE") {
				title = "Microphone Error";
				message = formatUserError(ErrorTemplates.AUDIO.NO_MICROPHONE);
			} else if (code === "AUDIO_BACKEND_MISSING") {
				title = "System Error";
				message = formatUserError(ErrorTemplates.AUDIO.AUDIO_BACKEND_MISSING);
			} else if (code === "PERMISSION_DENIED") {
				title = "Microphone Error";
				message = formatUserError(ErrorTemplates.AUDIO.PERMISSION_DENIED);
			} else if (code === "DEVICE_BUSY") {
				title = "Microphone Error";
				message = formatUserError(ErrorTemplates.AUDIO.DEVICE_BUSY);
			} else if (code === "RECORDING_TOO_SHORT") {
				title = "Recording Error";
				message = formatUserError(ErrorTemplates.AUDIO.RECORDING_TOO_SHORT);
			} else if (code === "SILENT_AUDIO") {
				title = "Recording Error";
				message = formatUserError(ErrorTemplates.AUDIO.SILENT_AUDIO);
			} else if (
				message.toLowerCase().includes("permission denied") ||
				message.toLowerCase().includes("microphone")
			) {
				title = "Microphone Error";
			}

			notify(title, message, "error");
		});
	}

	public async start() {
		try {
			writeFileSync(this.pidFile, process.pid.toString());
			this.updateState();

			const config = loadConfig();
			const hotkeyDisabled =
				config.behavior.hotkey.toLowerCase() === "disabled";

			const isWayland =
				!!process.env.WAYLAND_DISPLAY ||
				process.env.XDG_SESSION_TYPE === "wayland";

			if (!hotkeyDisabled) {
				await checkHotkeyConflict(config.behavior.hotkey);
				this.hotkeyListener.start();
				logger.info("Daemon started. Waiting for hotkey...");

				if (isWayland) {
					logger.warn(
						"Running on Wayland: Built-in hotkeys only work with XWayland windows. For reliable system-wide hotkeys, use compositor bindings or set hotkey to 'disabled'. See docs/WAYLAND.md for details.",
					);
				}
			} else {
				logger.info(
					"Daemon started. Hotkey listener disabled (use compositor bindings or SIGUSR1).",
				);
				this.keepAliveInterval = setInterval(() => {
					this.updateState();
				}, 60000);
			}
		} catch (error) {
			logError("Failed to start daemon", error);
			throw error;
		}
	}

	public stop() {
		this.hotkeyListener.stop();
		this.recorder.stop(true);
		process.off("SIGUSR1", this.signalHandler);
		if (this.keepAliveInterval) {
			clearInterval(this.keepAliveInterval);
		}
		try {
			unlinkSync(this.pidFile);
			unlinkSync(this.stateFile);
		} catch (_e) {}
		logger.info("Daemon stopped");
	}

	private async handleTrigger() {
		if (this.status === "idle" || this.status === "error") {
			this.cancelPending = false;
			try {
				const config = loadConfig();
				this.setStatus("starting");

				if (config.transcription.streaming) {
					if (this.streamingDataHandler) {
						this.recorder.off("data", this.streamingDataHandler);
						logger.debug("Removed old streaming data handler");
					}

					logger.info("Starting Deepgram streaming connection...");
					this.deepgramStreaming = new DeepgramStreamingTranscriber();
					await this.deepgramStreaming.start(
						config.transcription.language,
						config.transcription.boostWords || [],
					);
					logger.info("Deepgram streaming connection established");

					if (this.cancelPending) {
						logger.info("Recording cancelled during setup, cleaning up");
						this.cancelPending = false;
						if (this.streamingDataHandler) {
							this.recorder.off("data", this.streamingDataHandler);
							this.streamingDataHandler = undefined;
						}
						if (this.deepgramStreaming) {
							try {
								await this.deepgramStreaming.stop();
							} catch (e) {
								logError("Failed to stop streaming after cancellation", e);
							}
							this.deepgramStreaming = undefined;
						}
						this.setStatus("idle");
						return;
					}

					this.deepgramStreaming.on("transcript", (text) => {
						logger.info({ text }, "Received streaming transcript chunk");
					});

					let chunkCount = 0;
					let isFirstChunk = true;
					this.streamingDataHandler = (chunk: Buffer) => {
						chunkCount++;
						let audioData = chunk;

						// Strip WAV header from first chunk (44 bytes)
						// Recorder outputs WAV format but Deepgram expects raw PCM (linear16)
						if (isFirstChunk) {
							isFirstChunk = false;
							if (
								chunk.length >= 44 &&
								chunk.subarray(0, 4).toString("ascii") === "RIFF" &&
								chunk.subarray(8, 12).toString("ascii") === "WAVE"
							) {
								audioData = chunk.subarray(44);
								logger.debug(
									{
										originalSize: chunk.length,
										strippedSize: audioData.length,
									},
									"Stripped WAV header from first chunk",
								);
							}
						}

						if (audioData.length === 0) {
							logger.debug(
								{ chunkNumber: chunkCount },
								"Skipping empty chunk (header-only)",
							);
							return;
						}

						logger.debug(
							{ chunkNumber: chunkCount, chunkSize: audioData.length },
							"Handler called with audio chunk",
						);
						if (this.deepgramStreaming) {
							this.deepgramStreaming.send(audioData);
							logger.debug(
								{ chunkNumber: chunkCount },
								"Sent chunk to Deepgram",
							);
						} else {
							logger.error(
								{ chunkNumber: chunkCount },
								"No streaming connection when chunk received!",
							);
						}
					};

					this.recorder.on("data", this.streamingDataHandler);
					logger.info("Streaming data handler attached to recorder");
				}

				if (this.cancelPending) {
					logger.info("Recording cancelled before recorder start, cleaning up");
					this.cancelPending = false;
					if (this.streamingDataHandler) {
						this.recorder.off("data", this.streamingDataHandler);
						this.streamingDataHandler = undefined;
					}
					if (this.deepgramStreaming) {
						try {
							await this.deepgramStreaming.stop();
						} catch (e) {
							logError("Failed to stop streaming after cancellation", e);
						}
						this.deepgramStreaming = undefined;
					}
					this.setStatus("idle");
					return;
				}

				await this.recorder.start();
			} catch (error) {
				this.cancelPending = false;
				logError("Failed to start recording", error);
				if (this.streamingDataHandler) {
					this.recorder.off("data", this.streamingDataHandler);
					this.streamingDataHandler = undefined;
				}
				if (this.deepgramStreaming) {
					try {
						await this.deepgramStreaming.stop();
					} catch (e) {
						logError("Failed to stop streaming after start failure", e);
					}
					this.deepgramStreaming = undefined;
				}
				this.setStatus("idle");
			}
		} else if (this.status === "recording") {
			this.setStatus("stopping");
			await this.recorder.stop();
		} else if (this.status === "starting") {
			this.cancelPending = true;
			logger.info("Recording start cancelled by user");
			notify("Cancelled", "Recording start cancelled", "info");
		} else {
			logger.warn(`Hotkey ignored in state: ${this.status}`);
		}
	}

	private async processAudio(audioBuffer: Buffer, duration: number) {
		try {
			const config = loadConfig();
			const language = config.transcription.language;
			const boostWords = config.transcription.boostWords || [];

			const convertedBuffer = await convertAudio(audioBuffer);

			let groqErr: any = null;
			let deepgramErr: any = null;
			const startTime = Date.now();

			let groqText = "";
			let deepgramText = "";

			let streamingChunkCount = -1; // -1 = batch mode (not streaming)

			if (config.transcription.streaming && this.deepgramStreaming) {
				const [groqResult, streamingResult] = await Promise.all([
					this.groq
						.transcribe(convertedBuffer, language, boostWords)
						.catch((err) => {
							groqErr = err;
							return "";
						}),
					this.deepgramStreaming.stop().catch((err) => {
						deepgramErr = err;
						return { text: "", chunkCount: -1 };
					}),
				]);
				groqText = groqResult;
				deepgramText = streamingResult.text;
				streamingChunkCount = streamingResult.chunkCount;
			} else {
				[groqText, deepgramText] = await Promise.all([
					this.groq
						.transcribe(convertedBuffer, language, boostWords)
						.catch((err) => {
							groqErr = err;
							return "";
						}),
					this.deepgram
						.transcribe(convertedBuffer, language, boostWords)
						.catch((err) => {
							deepgramErr = err;
							return "";
						}),
				]);
			}

			const processingTime = Date.now() - startTime;

			const handleTranscriptionError = (err: any, failedService: string) => {
				const code = err instanceof AppError ? err.code : undefined;

				if (
					code === "GROQ_INVALID_KEY" ||
					code === "DEEPGRAM_INVALID_KEY" ||
					err?.message?.includes("Invalid API Key")
				) {
					const template =
						failedService === "Groq"
							? ErrorTemplates.API.GROQ_INVALID_KEY
							: ErrorTemplates.API.DEEPGRAM_INVALID_KEY;
					notify("Configuration Error", formatUserError(template), "error");
				} else if (
					code === "RATE_LIMIT_EXCEEDED" ||
					err?.message?.includes("Rate limit exceeded")
				) {
					const template =
						ErrorTemplates.API.RATE_LIMIT_EXCEEDED(failedService);
					notify("Rate Limit", formatUserError(template), "error");
				} else if (code === "TIMEOUT" || err?.message?.includes("timed out")) {
					logger.warn(`${failedService} API timed out`);
				} else {
					logError(`${failedService} failed`, err);
				}
			};

			if (!groqText && !deepgramText) {
				if (!groqErr && !deepgramErr) {
					logger.info({ duration }, "No speech detected in recording");
					notify(
						"No Speech Detected",
						"Recording was too short or contained no audible speech.",
						"warning",
					);
					this.setStatus("idle");
					return;
				}

				if (groqErr) handleTranscriptionError(groqErr, "Groq");
				if (deepgramErr) handleTranscriptionError(deepgramErr, "Deepgram");

				const template = ErrorTemplates.API.BOTH_SERVICES_FAILED;
				notify("Transcription Failed", formatUserError(template), "error");

				throw new Error("Both transcription services failed");
			}

			if (
				streamingChunkCount === 0 &&
				!deepgramErr &&
				groqText &&
				groqText.length < HALLUCINATION_MAX_CHARS
			) {
				logger.info(
					{ groqText, streamingChunkCount },
					"Filtered Groq hallucination on silent audio",
				);
				notify(
					"No Speech Detected",
					"Recording contained no audible speech.",
					"warning",
				);
				this.setStatus("idle");
				return;
			}

			let finalText = "";
			if (groqText && deepgramText) {
				finalText = await this.merger.merge(groqText, deepgramText);
			} else {
				finalText = groqText || deepgramText;

				const failedService = !groqText ? "Groq" : "Deepgram";
				const error = !groqText ? groqErr : deepgramErr;

				if (error) {
					handleTranscriptionError(error, failedService);
					notify(
						"Warning",
						`${failedService} failed, using fallback`,
						"warning",
					);
				}
			}

			if (!finalText) {
				throw new Error("No transcription generated");
			}

			await this.clipboard.append(finalText);

			const stats = incrementTranscriptionCount();
			this.transcriptionCountToday = stats.today;
			this.transcriptionCountTotal = stats.total;

			const engineUsed =
				groqText && deepgramText
					? "groq+deepgram"
					: groqText
						? "groq"
						: "deepgram";
			appendHistory({
				timestamp: new Date().toISOString(),
				text: finalText,
				duration,
				engine: engineUsed,
				processingTime,
			});

			notify("Success", "Transcription copied to clipboard", "success");

			logger.info(
				{
					duration,
					processingTime,
					text: finalText,
					textLength: finalText.length,
					groqText,
					groqTextLength: groqText.length,
					deepgramText,
					deepgramTextLength: deepgramText.length,
					models:
						groqText && deepgramText
							? "groq+deepgram+llama"
							: groqText
								? "groq"
								: "deepgram",
				},
				"Transcription complete",
			);
		} catch (error: any) {
			logError("Processing failed", error, { duration });

			let message = "Transcription failed. Check logs.";
			const code = error instanceof AppError ? error.code : undefined;

			if (code === "ACCESS_DENIED" || error instanceof ClipboardAccessError) {
				message = formatUserError(ErrorTemplates.CLIPBOARD.ACCESS_DENIED);
			} else if (code === "APPEND_FAILED") {
				message = formatUserError(ErrorTemplates.CLIPBOARD.APPEND_FAILED);
			} else if (code === "TIMEOUT" || error?.message?.includes("timed out")) {
				message = formatUserError(ErrorTemplates.API.TIMEOUT("Both"));
			} else if (code === "BOTH_SERVICES_FAILED") {
				message = formatUserError(ErrorTemplates.API.BOTH_SERVICES_FAILED);
			} else if (code === "CONVERSION_FAILED" || code === "FFMPEG_FAILURE") {
				const template =
					code === "FFMPEG_FAILURE"
						? ErrorTemplates.AUDIO.FFMPEG_FAILURE
						: ErrorTemplates.AUDIO.CONVERSION_FAILED;
				message = formatUserError(template);
			}

			this.errorCount++;
			this.setStatus("error", message);
			notify("Error", message, "error");
		} finally {
			this.lastTranscription = new Date();
			if (this.status !== "error") {
				this.setStatus("idle");
			}

			if (this.streamingDataHandler) {
				this.recorder.off("data", this.streamingDataHandler);
				this.streamingDataHandler = undefined;
			}
			this.deepgramStreaming = undefined;
		}
	}
}
