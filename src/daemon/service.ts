import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { convertAudio } from "../audio/converter";
import { AudioRecorder } from "../audio/recorder";
import type { Config } from "../config/schema";
import { configService } from "../config/service";
import { ClipboardAccessError, ClipboardManager } from "../output/clipboard";
import { notify } from "../output/notification";
import type { DaemonStatus } from "../shared/ipc-types";
import { DeepgramTranscriber } from "../transcribe/deepgram";
import {
	DeepgramStreamingTranscriber,
	type StreamingFailureReason,
	type StreamingStopReason,
} from "../transcribe/deepgram-streaming";
import { GroqClient } from "../transcribe/groq";
import {
	type MergeResult,
	type MergeStrategy,
	TranscriptMerger,
} from "../transcribe/merger";
import { ErrorTemplates, formatUserError } from "../utils/error-templates";
import { errorIncludes, getErrorCode } from "../utils/errors";
import { appendHistory } from "../utils/history";
import { logError, logger } from "../utils/logger";
import { incrementTranscriptionCount, loadStats } from "../utils/stats";
import { checkHotkeyConflict } from "./conflict";
import { HotkeyListener } from "./hotkey";
import { getIPCServer, type IPCServer } from "./ipc";

const HALLUCINATION_MAX_CHARS = 20;

// --- Instrumentation types ---

type AudioFormatStrategy = "opus" | "raw";

interface TranscriptionMetrics {
	// Timings (ms, -1 = skipped)
	totalMs: number;
	conversionMs: number;
	groqMs: number;
	deepgramMs: number;
	mergeMs: number;
	clipboardMs: number;
	statsWriteMs: number;
	historyAppendMs: number;
	notificationEnqueueMs: number;

	// Input characteristics
	rawAudioBytes: number;
	recordingDurationMs: number;
	convertedAudioBytes: number;

	// Decisions
	streamingEnabled: boolean;
	audioFormatStrategy: AudioFormatStrategy;
	mergeStrategy: MergeStrategy | "skip_no_speech" | "skip_hallucination";
	deepgramStopReason: StreamingStopReason | null;

	// Outcome
	engine: string;
	textLength: number;
	groqTextLength: number;
	deepgramTextLength: number;
}

async function timeAsync<T>(
	fn: () => Promise<T>,
): Promise<{ result: T; durationMs: number }> {
	const start = Date.now();
	const result = await fn();
	return { result, durationMs: Date.now() - start };
}

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
	private config: Config;
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
	private reloadSignalHandler: () => void;
	private keepAliveInterval?: NodeJS.Timeout;
	private cancelPending = false;
	private ipcServer: IPCServer;
	private stateWriteDebounceTimer?: NodeJS.Timeout;
	private pendingStateWrite = false;
	private overlayProcess?: ChildProcess;
	private overlayPidFile: string;

	constructor() {
		this.config = configService.get();
		this.recorder = new AudioRecorder();
		this.hotkeyListener = new HotkeyListener();
		this.groq = new GroqClient();
		this.deepgram = new DeepgramTranscriber();
		this.merger = new TranscriptMerger();
		this.clipboard = new ClipboardManager();
		this.ipcServer = getIPCServer();
		const configDir = join(homedir(), ".config", "hypr", "vox");
		this.pidFile = join(configDir, "daemon.pid");
		this.stateFile = join(configDir, "daemon.state");
		this.overlayPidFile = join(configDir, "overlay.pid");

		const stats = loadStats();
		this.transcriptionCountToday = stats.today;
		this.transcriptionCountTotal = stats.total;

		this.signalHandler = () => {
			logger.info("Received SIGUSR1 signal, toggling recording");
			this.handleTrigger();
		};

		this.reloadSignalHandler = () => {
			logger.info("Received SIGUSR2 signal, reloading config");
			const result = configService.reload();
			if (result.success && result.config) {
				this.config = result.config;
				this.groq.reset();
				this.deepgram.reset();
				this.merger.reset();
				logger.info("Config reloaded successfully");
				notify("Config Reloaded", "Configuration updated", "info");
			} else {
				logger.warn({ error: result.error }, "Config reload failed");
				notify(
					"Config Reload Failed",
					result.error || "Unknown error",
					"error",
				);
			}
		};

		this.setupListeners();
		this.setupSignalHandlers();
	}

	private setupSignalHandlers() {
		process.on("SIGUSR1", this.signalHandler);
		process.on("SIGUSR2", this.reloadSignalHandler);
	}

	private scheduleStateWrite(): void {
		if (this.stateWriteDebounceTimer) {
			return;
		}
		this.pendingStateWrite = true;
		this.stateWriteDebounceTimer = setTimeout(() => {
			this.stateWriteDebounceTimer = undefined;
			if (this.pendingStateWrite) {
				this.pendingStateWrite = false;
				this.writeStateFile();
			}
		}, 50);
	}

	private async writeStateFile(): Promise<void> {
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
			await writeFile(this.stateFile, JSON.stringify(state, null, 2));
			logger.debug({ status: this.status }, "Daemon state updated");
		} catch (e) {
			logError("Failed to update daemon state file", e, {
				stateFile: this.stateFile,
			});
		}
	}

	private updateState(): void {
		this.ipcServer.broadcastStatus(this.status, {
			lastTranscription: this.lastTranscription?.toISOString(),
			error: this.lastError,
			timestamp: Date.now(),
		});
		this.scheduleStateWrite();
	}

	private getOverlayPath(): string {
		if (this.config.overlay?.binaryPath) {
			return this.config.overlay.binaryPath;
		}
		return join(process.cwd(), "overlay");
	}

	private async waitForProcessExit(
		pid: number,
		timeoutMs = 3000,
	): Promise<void> {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			try {
				process.kill(pid, 0);
				await new Promise((r) => setTimeout(r, 50));
			} catch {
				return;
			}
		}
		logger.debug({ pid, timeoutMs }, "Timeout waiting for process exit");
	}

	private startOverlay(): void {
		if (!this.config.overlay?.enabled || !this.config.overlay?.autoStart) {
			return;
		}

		(async () => {
			try {
				const raw = readFileSync(this.overlayPidFile, "utf8").trim();
				const oldPid = parseInt(raw, 10);
				if (!Number.isNaN(oldPid)) {
					process.kill(oldPid, "SIGTERM");
					logger.debug({ oldPid }, "Terminated stale overlay process");
					await this.waitForProcessExit(oldPid);
				}
			} catch {
				// PID file absent or process already dead
			}

			const overlayPath = this.getOverlayPath();

			if (!existsSync(overlayPath)) {
				logger.warn(
					{ path: overlayPath },
					"Overlay not found, skipping auto-start",
				);
				return;
			}

			try {
				// Explicitly pass display environment for Wayland/X11 compatibility
				const uid = process.getuid?.() ?? 1000;
				const overlayEnv: NodeJS.ProcessEnv = { ...process.env };

				// Only set display vars if already present in parent env — injecting
				// WAYLAND_DISPLAY on a pure X11 system (or DISPLAY on Wayland-only)
				// causes GTK/Electron to attempt a non-existent compositor socket.
				if (!overlayEnv.WAYLAND_DISPLAY && !overlayEnv.DISPLAY) {
					// No display detected at all — fall back to Wayland-first defaults
					overlayEnv.WAYLAND_DISPLAY = "wayland-1";
					overlayEnv.DISPLAY = ":0";
				}

				if (!overlayEnv.XDG_RUNTIME_DIR) {
					overlayEnv.XDG_RUNTIME_DIR = `/run/user/${uid}`;
				}

				logger.debug(
					{
						WAYLAND_DISPLAY: overlayEnv.WAYLAND_DISPLAY,
						DISPLAY: overlayEnv.DISPLAY,
						XDG_RUNTIME_DIR: overlayEnv.XDG_RUNTIME_DIR,
					},
					"Starting overlay with display environment",
				);

				this.overlayProcess = spawn("bun", ["run", "start"], {
					cwd: overlayPath,
					detached: true,
					stdio: "ignore",
					env: overlayEnv,
				});

				this.overlayProcess.on("error", (err) => {
					logger.warn({ err }, "Overlay process error");
				});

				this.overlayProcess.unref();

				const pid = this.overlayProcess.pid;
				if (pid) {
					writeFile(this.overlayPidFile, pid.toString()).catch((e) => {
						logger.debug({ err: e }, "Failed to write overlay PID file");
					});
				}

				logger.info({ pid }, "Overlay started");
			} catch (error) {
				logError("Failed to start overlay", error);
			}
		})();
	}

	private stopOverlay(): void {
		if (this.overlayProcess) {
			try {
				this.overlayProcess.kill("SIGTERM");
			} catch (e) {
				logger.debug({ err: e }, "Failed to kill overlay process");
			}
			this.overlayProcess = undefined;
		}

		try {
			const raw = readFileSync(this.overlayPidFile, "utf8").trim();
			const oldPid = parseInt(raw, 10);
			if (!Number.isNaN(oldPid)) {
				process.kill(oldPid, "SIGTERM");
				logger.debug(
					{ oldPid },
					"Terminated stale overlay from previous session",
				);
			}
		} catch {
			// PID file absent or process already dead
		}

		try {
			unlinkSync(this.overlayPidFile);
		} catch (e) {
			logger.debug({ err: e }, "Failed to remove overlay PID file");
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

	private notifyStateChange(
		title: string,
		message: string,
		type: "info" | "success" | "warning" = "info",
	): void {
		if (this.config.overlay?.enabled) {
			return;
		}
		notify(title, message, type);
	}

	private setupListeners() {
		this.hotkeyListener.on("trigger", () => this.handleTrigger());

		this.recorder.on("start", () => {
			this.setStatus("recording");
			this.notifyStateChange("Recording Started", "Listening...");
		});

		this.recorder.on("stop", (audioBuffer: Buffer, duration: number) => {
			this.setStatus("processing");
			this.notifyStateChange(
				"Recording Stopped",
				"Processing transcription...",
			);
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

			const code = getErrorCode(err);

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
			await writeFile(this.pidFile, process.pid.toString());
			await this.ipcServer.start();
			this.updateState();
			this.startOverlay();

			const hotkeyDisabled =
				this.config.behavior.hotkey.toLowerCase() === "disabled";

			const isWayland =
				!!process.env.WAYLAND_DISPLAY ||
				process.env.XDG_SESSION_TYPE === "wayland";

			if (!hotkeyDisabled) {
				await checkHotkeyConflict(this.config.behavior.hotkey);
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

	public async stop() {
		this.hotkeyListener.stop();
		await this.recorder.stop(true);
		this.stopOverlay();
		process.off("SIGUSR1", this.signalHandler);
		process.off("SIGUSR2", this.reloadSignalHandler);
		if (this.keepAliveInterval) {
			clearInterval(this.keepAliveInterval);
		}
		if (this.stateWriteDebounceTimer) {
			clearTimeout(this.stateWriteDebounceTimer);
		}
		await this.ipcServer.stop();
		for (const file of [this.pidFile, this.stateFile]) {
			try {
				unlinkSync(file);
			} catch (e) {
				logger.debug({ err: e, file }, "Failed to remove file during shutdown");
			}
		}
		logger.info("Daemon stopped");
	}

	private async handleTrigger() {
		if (this.status === "idle" || this.status === "error") {
			this.cancelPending = false;
			try {
				this.setStatus("starting");

				if (this.config.transcription.streaming) {
					if (this.streamingDataHandler) {
						this.recorder.off("data", this.streamingDataHandler);
						logger.debug("Removed old streaming data handler");
					}

					logger.info("Starting Deepgram streaming connection...");
					this.deepgramStreaming = new DeepgramStreamingTranscriber();

					this.deepgramStreaming.on("transcript", (text) => {
						logger.info({ text }, "Received streaming transcript chunk");
					});

					this.deepgramStreaming.on("error", (err) => {
						logger.error({ err }, "Deepgram streaming error");
					});

					this.deepgramStreaming.on(
						"streaming_failed",
						(reason: StreamingFailureReason) => {
							logger.warn(
								{
									reason,
									fallback: "batch mode",
								},
								"Streaming connection lost, will use batch transcription",
							);
							this.notifyStateChange(
								"Streaming Interrupted",
								"Using batch transcription",
								"warning",
							);
						},
					);

					const startPromise = this.deepgramStreaming.start(
						this.config.transcription.language,
					);

					// We catch synchronous errors from start(), but async connection errors go to 'error' event
					startPromise.catch((err) => {
						logError("Failed to initiate Deepgram streaming", err);
					});

					logger.info("Deepgram streaming initiated (background)");

					// Check cancellation immediately (though less likely to be pending this fast)
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
		const totalStart = Date.now();

		// Initialize metrics with defaults
		const metrics: TranscriptionMetrics = {
			totalMs: 0,
			conversionMs: -1,
			groqMs: -1,
			deepgramMs: -1,
			mergeMs: -1,
			clipboardMs: -1,
			statsWriteMs: -1,
			historyAppendMs: -1,
			notificationEnqueueMs: -1,
			rawAudioBytes: audioBuffer.length,
			recordingDurationMs: duration,
			convertedAudioBytes: -1,
			streamingEnabled: !!this.config.transcription.streaming,
			audioFormatStrategy: "opus",
			mergeStrategy: "skip_no_speech",
			deepgramStopReason: null,
			engine: "",
			textLength: 0,
			groqTextLength: 0,
			deepgramTextLength: 0,
		};

		try {
			const language = this.config.transcription.language;
			const boostWords = this.config.transcription.boostWords || [];

			// --- Stage: Audio conversion ---
			const conversion = await timeAsync(() => convertAudio(audioBuffer));
			const convertedBuffer = conversion.result;
			metrics.conversionMs = conversion.durationMs;
			metrics.convertedAudioBytes = convertedBuffer.length;

			// --- Stage: Parallel transcription ---
			let groqErr: unknown = null;
			let deepgramErr: unknown = null;
			let groqText = "";
			let deepgramText = "";
			let streamingChunkCount = -1;

			if (this.config.transcription.streaming && this.deepgramStreaming) {
				const [groqTimed, deepgramTimed] = await Promise.all([
					timeAsync(() =>
						this.groq
							.transcribe(convertedBuffer, language, boostWords)
							.catch((err) => {
								groqErr = err;
								return "";
							}),
					),
					timeAsync(() =>
						this.deepgramStreaming!.stop().catch((err) => {
							deepgramErr = err;
							return {
								text: "",
								chunkCount: -1,
								stopReason: "not_connected" as const,
							};
						}),
					),
				]);
				metrics.groqMs = groqTimed.durationMs;
				metrics.deepgramMs = deepgramTimed.durationMs;
				groqText = groqTimed.result;
				const streamingResult = deepgramTimed.result;
				deepgramText = streamingResult.text;
				streamingChunkCount = streamingResult.chunkCount;
				metrics.deepgramStopReason = streamingResult.stopReason;
			} else {
				const [groqTimed, deepgramTimed] = await Promise.all([
					timeAsync(() =>
						this.groq
							.transcribe(convertedBuffer, language, boostWords)
							.catch((err) => {
								groqErr = err;
								return "";
							}),
					),
					timeAsync(() =>
						this.deepgram.transcribe(convertedBuffer, language).catch((err) => {
							deepgramErr = err;
							return "";
						}),
					),
				]);
				metrics.groqMs = groqTimed.durationMs;
				metrics.deepgramMs = deepgramTimed.durationMs;
				groqText = groqTimed.result;
				deepgramText = deepgramTimed.result;
			}

			metrics.groqTextLength = groqText.length;
			metrics.deepgramTextLength = deepgramText.length;

			const handleTranscriptionError = (
				err: unknown,
				failedService: string,
			) => {
				const code = getErrorCode(err);

				if (
					code === "GROQ_INVALID_KEY" ||
					code === "DEEPGRAM_INVALID_KEY" ||
					errorIncludes(err, "Invalid API Key")
				) {
					const template =
						failedService === "Groq"
							? ErrorTemplates.API.GROQ_INVALID_KEY
							: ErrorTemplates.API.DEEPGRAM_INVALID_KEY;
					notify("Configuration Error", formatUserError(template), "error");
				} else if (
					code === "RATE_LIMIT_EXCEEDED" ||
					errorIncludes(err, "Rate limit exceeded")
				) {
					const template =
						ErrorTemplates.API.RATE_LIMIT_EXCEEDED(failedService);
					notify("Rate Limit", formatUserError(template), "error");
				} else if (code === "TIMEOUT" || errorIncludes(err, "timed out")) {
					logger.warn(`${failedService} API timed out`);
				} else {
					logError(`${failedService} failed`, err);
				}
			};

			// --- Early exits (no speech / hallucination) ---
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
				metrics.mergeStrategy = "skip_hallucination";
				logger.info(
					{ groqTextLength: groqText.length, streamingChunkCount },
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

			// --- Stage: Merge ---
			let finalText = "";
			let accuracy: MergeResult["accuracy"] | undefined;

			if (groqText && deepgramText) {
				const mergeTimed = await timeAsync(() =>
					this.merger.merge(groqText, deepgramText),
				);
				metrics.mergeMs = mergeTimed.durationMs;
				finalText = mergeTimed.result.text;
				accuracy = mergeTimed.result.accuracy;
				metrics.mergeStrategy = mergeTimed.result.strategy;
			} else {
				finalText = groqText || deepgramText;
				metrics.mergeStrategy = "single_source";
				metrics.mergeMs = -1;

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

			// --- Stage: Clipboard ---
			const clipboardTimed = await timeAsync(() =>
				this.clipboard.append(finalText),
			);
			metrics.clipboardMs = clipboardTimed.durationMs;

			// processingTime captures user-perceived latency (up to clipboard write).
			// This excludes history append and notification which are fire-and-forget
			// bookkeeping after the user already has the transcription.
			// Contrast with metrics.totalMs which includes all pipeline stages.
			const processingTime = Date.now() - totalStart;

			// --- Stage: Stats write ---
			const statsTimed = await timeAsync(() => incrementTranscriptionCount());
			metrics.statsWriteMs = statsTimed.durationMs;
			this.transcriptionCountToday = statsTimed.result.today;
			this.transcriptionCountTotal = statsTimed.result.total;

			// --- Stage: History append ---
			const engineUsed =
				groqText && deepgramText
					? "groq+deepgram"
					: groqText
						? "groq"
						: "deepgram";
			metrics.engine = engineUsed;

			const historyTimed = await timeAsync(() =>
				appendHistory({
					timestamp: new Date().toISOString(),
					text: finalText,
					duration,
					engine: engineUsed,
					processingTime,
				}),
			);
			metrics.historyAppendMs = historyTimed.durationMs;

			// --- Stage: Notification ---
			const notifyTimed = await timeAsync(async () =>
				this.notifyStateChange(
					"Success",
					"Transcription copied to clipboard",
					"success",
				),
			);
			metrics.notificationEnqueueMs = notifyTimed.durationMs;

			// --- Finalize metrics ---
			metrics.totalMs = Date.now() - totalStart;
			metrics.textLength = finalText.length;

			// --- Outcome log (no full text) ---
			logger.info(
				{
					engine: engineUsed,
					textLength: finalText.length,
					recordingDurationMs: duration,
					processingMs: processingTime,
					mergeStrategy: metrics.mergeStrategy,
					...(accuracy ? { mergeConfidence: accuracy.confidence } : {}),
				},
				"Transcription complete",
			);

			// --- Performance log (structured, filterable) ---
			logger.info({ type: "perf", ...metrics }, "Transcription performance");
		} catch (error: unknown) {
			logError("Processing failed", error, { duration });

			let message = "Transcription failed. Check logs.";
			const code = getErrorCode(error);

			if (code === "ACCESS_DENIED" || error instanceof ClipboardAccessError) {
				message = formatUserError(ErrorTemplates.CLIPBOARD.ACCESS_DENIED);
			} else if (code === "APPEND_FAILED") {
				message = formatUserError(ErrorTemplates.CLIPBOARD.APPEND_FAILED);
			} else if (code === "TIMEOUT" || errorIncludes(error, "timed out")) {
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
