import { type ChildProcess, spawn } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	unlinkSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { convertAudio } from "../audio/converter";
import { type AudioLevelPayload, AudioRecorder } from "../audio/recorder";
import type { Config } from "../config/schema";
import { configService } from "../config/service";
import { ClipboardAccessError, ClipboardManager } from "../output/clipboard";
import { notify } from "../output/notification";
import type { DaemonStatus } from "../shared/ipc-types";
import { appendStatsAggregateEntry } from "../stats/aggregate";
import { DeepgramTranscriber } from "../transcribe/deepgram";
import {
	DeepgramStreamingTranscriber,
	type StreamingFailureReason,
	type StreamingStopReason,
} from "../transcribe/deepgram-streaming";
import { GroqClient, getGroqChunkingFailureReason } from "../transcribe/groq";
import { buildContextLexicon } from "../transcribe/lexicon";
import { assessLongRecordingQuality } from "../transcribe/long-recording";
import {
	type MergeReason,
	type MergeResult,
	type MergeStrategy,
	TranscriptMerger,
} from "../transcribe/merger";
import type { TranscriptQualityReason } from "../transcribe/quality";
import { validateTranscript } from "../transcribe/quality";
import { recoverTranscriptQuality } from "../transcribe/recovery";
import { ErrorTemplates, formatUserError } from "../utils/error-templates";
import { errorIncludes, getErrorCode } from "../utils/errors";
import { appendHistory } from "../utils/history";
import { logError, logger } from "../utils/logger";
import { incrementTranscriptionCount, loadStats } from "../utils/stats";
import { checkHotkeyConflict } from "./conflict";
import { HotkeyListener } from "./hotkey";
import { getIPCServer, type IPCServer } from "./ipc";

const HALLUCINATION_MAX_CHARS = 50;
const projectRoot = join(import.meta.dir, "..", "..");

// Common Whisper hallucination patterns (from YouTube training data)
const HALLUCINATION_PATTERNS = [
	/thank you for watching/i,
	/thanks for watching/i,
	/please subscribe/i,
	/don't forget to like/i,
	/like and subscribe/i,
	/hit the bell/i,
];

function containsHallucination(text: string): boolean {
	return HALLUCINATION_PATTERNS.some((pattern) => pattern.test(text));
}

// --- Instrumentation types ---

type AudioFormatStrategy = "opus" | "raw";

interface TranscriptionMetrics {
	// Timings (ms, -1 = skipped)
	totalMs: number;
	processingMs: number; // user-perceived latency (up to clipboard write)
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
	mergeReason: MergeReason | null;
	validationReasons: TranscriptQualityReason[];
	validationRetryCount: number;
	validationFallbackSource: "none" | "groq" | "deepgram";
	trimmedHallucinationSuffix: boolean;
	longRecordingMode: boolean;
	longRecordingFallbackSource: "none" | "groq" | "deepgram";
	suspiciousMergeExpansion: boolean;
	deepgramStopReason: StreamingStopReason | null;

	// Deepgram early-stop observability
	deepgramStopWallMs: number;
	deepgramCriticalPathMs: number;
	deepgramOverlapMs: number;
	deepgramStartedEarly: boolean;
	deepgramFinalizeWaitMs: number;
	deepgramCloseWaitMs: number;
	deepgramEndpointingMs: number;
	deepgramReceivedFinalChunk: boolean;
	deepgramHadSpeechFinal: boolean;
	groqChunkingEnabled: boolean;
	groqChunkingUsed: boolean;
	groqChunkCount: number;
	groqChunkDurationSeconds: number;
	groqChunkOverlapSeconds: number;
	groqChunkFallback: boolean;
	groqChunkFailureReason: string | null;

	// Outcome
	engine: string;
	textLength: number;
	groqTextLength: number;
	deepgramTextLength: number;
	groqSttModel: string;
	deepgramModel: string;
	mergeModel: string;
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
	private static readonly OVERLAY_AUDIO_LEVEL_INTERVAL_MS = 33;
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
	private overlayLogFile: string;
	private overlayRestartTimer?: NodeJS.Timeout;
	private overlayStopRequested = false;
	private overlayRestartAttempts: number[] = [];
	private lastOverlayAudioLevelAt = 0;
	private smoothedOverlayLevel = 0;
	private contextLexicon: string[] = [];
	private providerBoostWords: string[] = [];

	private static readonly OVERLAY_RESTART_INITIAL_DELAY_MS = 250;
	private static readonly OVERLAY_RESTART_MAX_DELAY_MS = 2000;
	private static readonly OVERLAY_RESTART_WINDOW_MS = 60000;
	private static readonly OVERLAY_RESTART_MAX_ATTEMPTS = 5;

	constructor() {
		this.config = configService.get();
		this.recorder = new AudioRecorder();
		this.hotkeyListener = new HotkeyListener();
		this.groq = new GroqClient();
		this.deepgram = new DeepgramTranscriber();
		this.merger = new TranscriptMerger();
		this.refreshContextLexicon();
		this.clipboard = new ClipboardManager();
		this.ipcServer = getIPCServer();
		const configDir = join(homedir(), ".config", "hypr", "vox");
		this.pidFile = join(configDir, "daemon.pid");
		this.stateFile = join(configDir, "daemon.state");
		this.overlayPidFile = join(configDir, "overlay.pid");
		this.overlayLogFile = join(this.config.paths.logs, "overlay.log");

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
				this.refreshContextLexicon();
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

	private refreshContextLexicon(): void {
		const configuredBoostWords = this.config.transcription.boostWords || [];
		if (this.config.transcription.lexiconEnabled) {
			this.contextLexicon = buildContextLexicon({
				rootDir: projectRoot,
				boostWords: configuredBoostWords,
			});
		} else {
			this.contextLexicon = [];
		}
		this.providerBoostWords = this.mergeProviderBoostWords(
			configuredBoostWords,
			this.contextLexicon,
		);
		this.merger.setContextLexicon(this.contextLexicon);
	}

	private mergeProviderBoostWords(...wordLists: string[][]): string[] {
		const seen = new Set<string>();
		const merged: string[] = [];

		for (const words of wordLists) {
			for (const rawWord of words) {
				const word = rawWord.trim().replace(/\s+/g, " ");
				if (!word) continue;

				const key = word.toLowerCase();
				if (seen.has(key)) continue;

				seen.add(key);
				merged.push(word);
			}
		}

		return merged;
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

	private handleRecorderLevel(payload: AudioLevelPayload): void {
		if (!this.config.overlay?.enabled || this.status !== "recording") {
			return;
		}

		if (this.ipcServer.clientCount === 0) {
			return;
		}

		if (
			payload.timestamp - this.lastOverlayAudioLevelAt <
			DaemonService.OVERLAY_AUDIO_LEVEL_INTERVAL_MS
		) {
			return;
		}

		this.lastOverlayAudioLevelAt = payload.timestamp;
		this.smoothedOverlayLevel =
			this.smoothedOverlayLevel * 0.7 + payload.level * 0.3;

		this.ipcServer.broadcastAudioLevel(
			Math.min(1, this.smoothedOverlayLevel),
			payload.peak,
			payload.timestamp,
		);
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

	private pruneOverlayRestartAttempts(now = Date.now()): void {
		this.overlayRestartAttempts = this.overlayRestartAttempts.filter(
			(at) => now - at <= DaemonService.OVERLAY_RESTART_WINDOW_MS,
		);
	}

	private removeOverlayPidFile(expectedPid?: number): void {
		try {
			if (expectedPid !== undefined) {
				const raw = readFileSync(this.overlayPidFile, "utf8").trim();
				const currentPid = parseInt(raw, 10);
				if (currentPid !== expectedPid) {
					return;
				}
			}
			unlinkSync(this.overlayPidFile);
		} catch (e) {
			logger.debug({ err: e }, "Failed to remove overlay PID file");
		}
	}

	private scheduleOverlayRestart(reason: string): void {
		if (
			this.overlayStopRequested ||
			this.overlayRestartTimer ||
			!this.config.overlay?.enabled ||
			!this.config.overlay?.autoStart
		) {
			return;
		}

		const now = Date.now();
		this.pruneOverlayRestartAttempts(now);
		if (
			this.overlayRestartAttempts.length >=
			DaemonService.OVERLAY_RESTART_MAX_ATTEMPTS
		) {
			logger.error(
				{
					reason,
					attempts: this.overlayRestartAttempts.length,
					windowMs: DaemonService.OVERLAY_RESTART_WINDOW_MS,
					logFile: this.overlayLogFile,
				},
				"Overlay crashed too often; automatic restart disabled",
			);
			return;
		}

		this.overlayRestartAttempts.push(now);
		const restartDelayMs = Math.min(
			DaemonService.OVERLAY_RESTART_INITIAL_DELAY_MS *
				2 ** (this.overlayRestartAttempts.length - 1),
			DaemonService.OVERLAY_RESTART_MAX_DELAY_MS,
		);

		logger.warn(
			{
				reason,
				delayMs: restartDelayMs,
				attempt: this.overlayRestartAttempts.length,
				logFile: this.overlayLogFile,
			},
			"Scheduling overlay restart",
		);

		this.overlayRestartTimer = setTimeout(() => {
			this.overlayRestartTimer = undefined;
			this.startOverlay("restart");
		}, restartDelayMs);
	}

	private resolveOverlayLaunchCommand(overlayPath: string): {
		command: string;
		args: string[];
		mode: "electron_direct" | "bun_fallback";
	} {
		const directElectronPath = join(
			overlayPath,
			"node_modules",
			".bin",
			"electron",
		);
		if (existsSync(directElectronPath)) {
			return {
				command: directElectronPath,
				args: ["."],
				mode: "electron_direct",
			};
		}

		return {
			command: "bun",
			args: ["run", "start"],
			mode: "bun_fallback",
		};
	}

	private startOverlay(trigger: "startup" | "restart" = "startup"): void {
		if (!this.config.overlay?.enabled || !this.config.overlay?.autoStart) {
			return;
		}

		if (
			this.overlayProcess &&
			this.overlayProcess.exitCode === null &&
			this.overlayProcess.signalCode === null
		) {
			return;
		}

		this.overlayStopRequested = false;

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
				const launch = this.resolveOverlayLaunchCommand(overlayPath);

				// Explicitly pass display environment for Wayland/X11 compatibility
				const uid = process.getuid?.() ?? 1000;
				const overlayEnv: NodeJS.ProcessEnv = { ...process.env };
				let overlayLogFd: number | undefined;

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

				mkdirSync(this.config.paths.logs, { recursive: true, mode: 0o700 });
				overlayLogFd = openSync(this.overlayLogFile, "a");

				this.overlayProcess = spawn(launch.command, launch.args, {
					cwd: overlayPath,
					detached: true,
					stdio: ["ignore", overlayLogFd, overlayLogFd],
					env: overlayEnv,
				});

				this.overlayProcess.on("error", (err) => {
					logger.warn({ err }, "Overlay process error");
					this.scheduleOverlayRestart("spawn_error");
				});

				const overlayPid = this.overlayProcess.pid;
				this.overlayProcess.on("exit", (code, signal) => {
					if (this.overlayProcess?.pid === overlayPid) {
						this.overlayProcess = undefined;
					}
					this.removeOverlayPidFile(overlayPid);
					logger.warn(
						{
							pid: overlayPid,
							code,
							signal,
							stopRequested: this.overlayStopRequested,
							logFile: this.overlayLogFile,
						},
						"Overlay process exited",
					);
					if (!this.overlayStopRequested) {
						this.scheduleOverlayRestart("process_exit");
					}
				});

				this.overlayProcess.unref();

				const pid = this.overlayProcess.pid;
				if (pid) {
					writeFile(this.overlayPidFile, pid.toString()).catch((e) => {
						logger.debug({ err: e }, "Failed to write overlay PID file");
					});
				}

				if (overlayLogFd !== undefined) {
					closeSync(overlayLogFd);
				}

				if (trigger === "startup") {
					this.overlayRestartAttempts = [];
				}

				logger.info(
					{
						pid,
						logFile: this.overlayLogFile,
						trigger,
						launchMode: launch.mode,
					},
					"Overlay started",
				);
			} catch (error) {
				logError("Failed to start overlay", error);
				this.scheduleOverlayRestart("start_failure");
			}
		})();
	}

	private stopOverlay(): void {
		this.overlayStopRequested = true;
		if (this.overlayRestartTimer) {
			clearTimeout(this.overlayRestartTimer);
			this.overlayRestartTimer = undefined;
		}

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

		this.removeOverlayPidFile();
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
			this.lastOverlayAudioLevelAt = 0;
			this.smoothedOverlayLevel = 0;
			this.setStatus("recording");
			this.notifyStateChange("Recording Started", "Listening...");
		});

		this.recorder.on("stop", (audioBuffer: Buffer, duration: number) => {
			this.lastOverlayAudioLevelAt = 0;
			this.smoothedOverlayLevel = 0;
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

		this.recorder.on("level", (payload: AudioLevelPayload) => {
			this.handleRecorderLevel(payload);
		});

		this.recorder.on("error", (err: Error) => {
			this.lastOverlayAudioLevelAt = 0;
			this.smoothedOverlayLevel = 0;
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
						this.config.transcription.deepgramBoosting
							? this.providerBoostWords
							: [],
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
			processingMs: 0,
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
			audioFormatStrategy: "raw", // Will be set based on compression decision
			mergeStrategy: "skip_no_speech",
			mergeReason: null,
			validationReasons: [],
			validationRetryCount: 0,
			validationFallbackSource: "none",
			trimmedHallucinationSuffix: false,
			longRecordingMode: false,
			longRecordingFallbackSource: "none",
			suspiciousMergeExpansion: false,
			deepgramStopReason: null,
			deepgramStopWallMs: -1,
			deepgramCriticalPathMs: -1,
			deepgramOverlapMs: 0,
			deepgramStartedEarly: false,
			deepgramFinalizeWaitMs: -1,
			deepgramCloseWaitMs: -1,
			deepgramEndpointingMs: -1,
			deepgramReceivedFinalChunk: false,
			deepgramHadSpeechFinal: false,
			groqChunkingEnabled: this.config.transcription.groqChunking.enabled,
			groqChunkingUsed: false,
			groqChunkCount: 0,
			groqChunkDurationSeconds:
				this.config.transcription.groqChunking.chunkSeconds,
			groqChunkOverlapSeconds:
				this.config.transcription.groqChunking.overlapSeconds,
			groqChunkFallback: false,
			groqChunkFailureReason: null,
			engine: "",
			textLength: 0,
			groqTextLength: 0,
			deepgramTextLength: 0,
			groqSttModel: "whisper-large-v3",
			deepgramModel: "nova-3",
			mergeModel: this.config.transcription.mergeModel,
		};

		try {
			const language = this.config.transcription.language;
			const boostWords = this.providerBoostWords;
			const deepgramBoostWords = this.config.transcription.deepgramBoosting
				? boostWords
				: [];

			// Declarations before conversion so the early Deepgram promise
			// can write into these variables while ffmpeg runs.
			let groqErr: unknown = null;
			let deepgramErr: unknown = null;
			let groqText = "";
			let deepgramText = "";
			let streamingChunkCount = -1;

			const deepgramStreaming = this.deepgramStreaming;
			const useStreaming =
				this.config.transcription.streaming && deepgramStreaming !== undefined;

			// --- Start Deepgram stop early (streaming only) ---
			// deepgramStreaming.stop() does NOT depend on the converted audio
			// buffer — it only closes the WebSocket.  Starting it here overlaps
			// the stop teardown with ffmpeg conversion.
			type DgStopTimed = {
				result: {
					text: string;
					chunkCount: number;
					stopReason: StreamingStopReason;
					finalizeWaitMs: number;
					closeWaitMs: number;
					endpointingMs: number;
					receivedFinalChunk: boolean;
					hadSpeechFinal: boolean;
				};
				durationMs: number;
			};
			let deepgramStopPromise: Promise<DgStopTimed> | null = null;

			if (useStreaming) {
				metrics.deepgramStartedEarly = true;
				deepgramStopPromise = timeAsync(() =>
					deepgramStreaming.stop().catch((err) => {
						deepgramErr = err;
						return {
							text: "",
							chunkCount: -1,
							stopReason: "not_connected" as const,
							finalizeWaitMs: -1,
							closeWaitMs: -1,
							endpointingMs: -1,
							receivedFinalChunk: false,
							hadSpeechFinal: false,
						};
					}),
				);
			}

			// --- Stage: Audio conversion (conditional) ---
			// Determine if compression should be applied based on config
			const compressionMode = this.config.audio.compression;
			const compressionThreshold = this.config.audio.compressionThreshold;
			const bufferSize = audioBuffer.length;

			let shouldCompress: boolean;
			if (compressionMode === "always") {
				shouldCompress = true;
			} else if (compressionMode === "never") {
				shouldCompress = false;
			} else {
				// "auto" mode: compress only if buffer exceeds threshold
				shouldCompress = bufferSize >= compressionThreshold;
			}

			let audioBufferToTranscribe: Buffer;
			if (shouldCompress) {
				const conversion = await timeAsync(() => convertAudio(audioBuffer));
				audioBufferToTranscribe = conversion.result;
				metrics.conversionMs = conversion.durationMs;
				metrics.convertedAudioBytes = audioBufferToTranscribe.length;
				metrics.audioFormatStrategy = "opus";
				logger.debug(
					{
						mode: compressionMode,
						threshold: compressionThreshold,
						bufferSize,
						compressed: true,
					},
					"Audio compression applied",
				);
			} else {
				// Skip compression, use raw WAV
				audioBufferToTranscribe = audioBuffer;
				metrics.conversionMs = 0;
				metrics.convertedAudioBytes = audioBuffer.length;
				metrics.audioFormatStrategy = "raw";
				logger.debug(
					{
						mode: compressionMode,
						threshold: compressionThreshold,
						bufferSize,
						compressed: false,
					},
					"Audio compression skipped",
				);
			}

			// --- Stage: Parallel transcription ---
			const audioFormat =
				metrics.audioFormatStrategy === "opus" ? "opus" : "wav";

			const transcribeGroqAudio = async (): Promise<string> => {
				const groqChunking = this.config.transcription.groqChunking;

				if (!groqChunking.enabled) {
					return this.groq.transcribe(
						audioBufferToTranscribe,
						language,
						boostWords,
						audioFormat,
						duration,
					);
				}

				try {
					const result = await this.groq.transcribeChunked({
						rawAudioBuffer: audioBuffer,
						fallbackAudioBuffer: audioBufferToTranscribe,
						fallbackFormat: audioFormat,
						language,
						boostWords,
						recordingDurationMs: duration,
						chunking: groqChunking,
					});

					metrics.groqChunkingEnabled = result.chunking.enabled;
					metrics.groqChunkingUsed = result.chunking.used;
					metrics.groqChunkCount = result.chunking.chunkCount;
					metrics.groqChunkDurationSeconds =
						result.chunking.chunkDurationSeconds;
					metrics.groqChunkOverlapSeconds = result.chunking.overlapSeconds;
					metrics.groqChunkFallback = result.chunking.fallback;
					metrics.groqChunkFailureReason = result.chunking.failureReason;

					return result.text;
				} catch (error: unknown) {
					const chunkFailureReason = getGroqChunkingFailureReason(error);
					if (chunkFailureReason) {
						metrics.groqChunkFailureReason = chunkFailureReason;
					}
					throw error;
				}
			};

			if (useStreaming) {
				if (!deepgramStopPromise) {
					throw new Error(
						"Deepgram stop promise missing in streaming transcription path",
					);
				}
				// Deepgram stop is already in flight; wait for it in parallel
				// with Groq transcription.
				const [groqTimed, deepgramTimed] = await Promise.all([
					timeAsync(() =>
						transcribeGroqAudio().catch((err) => {
							groqErr = err;
							return "";
						}),
					),
					deepgramStopPromise,
				]);
				metrics.groqMs = groqTimed.durationMs;
				metrics.deepgramStopWallMs = deepgramTimed.durationMs;
				const streamingResult = deepgramTimed.result;
				metrics.deepgramFinalizeWaitMs = streamingResult.finalizeWaitMs;
				metrics.deepgramCloseWaitMs = streamingResult.closeWaitMs;
				metrics.deepgramEndpointingMs = streamingResult.endpointingMs;
				metrics.deepgramReceivedFinalChunk = streamingResult.receivedFinalChunk;
				metrics.deepgramHadSpeechFinal = streamingResult.hadSpeechFinal;
				const deepgramPostConversionTailMs = Math.max(
					0,
					deepgramTimed.durationMs - metrics.conversionMs,
				);
				// Critical-path contribution is only the Deepgram time that still
				// remains after both ffmpeg and Groq have had a chance to hide it.
				metrics.deepgramCriticalPathMs = Math.max(
					0,
					deepgramTimed.durationMs -
						(metrics.conversionMs + groqTimed.durationMs),
				);
				metrics.deepgramOverlapMs = Math.max(
					0,
					deepgramTimed.durationMs - metrics.deepgramCriticalPathMs,
				);
				metrics.deepgramMs = metrics.deepgramCriticalPathMs;
				groqText = groqTimed.result;
				deepgramText = streamingResult.text;
				streamingChunkCount = streamingResult.chunkCount;
				metrics.deepgramStopReason = streamingResult.stopReason;
				logger.debug(
					{
						deepgramStopWallMs: metrics.deepgramStopWallMs,
						deepgramPostConversionTailMs,
						deepgramCriticalPathMs: metrics.deepgramCriticalPathMs,
						deepgramOverlapMs: metrics.deepgramOverlapMs,
						groqMs: metrics.groqMs,
						conversionMs: metrics.conversionMs,
					},
					"Deepgram early-stop overlap metrics",
				);
			} else {
				const [groqTimed, deepgramTimed] = await Promise.all([
					timeAsync(() =>
						transcribeGroqAudio().catch((err) => {
							groqErr = err;
							return "";
						}),
					),
					timeAsync(() =>
						this.deepgram
							.transcribe(
								audioBufferToTranscribe,
								language,
								deepgramBoostWords,
								audioFormat,
							)
							.catch((err) => {
								deepgramErr = err;
								return "";
							}),
					),
				]);
				metrics.groqMs = groqTimed.durationMs;
				metrics.deepgramMs = deepgramTimed.durationMs;
				metrics.deepgramCriticalPathMs = deepgramTimed.durationMs;
				groqText = groqTimed.result;
				deepgramText = deepgramTimed.result;
			}

			metrics.groqTextLength = groqText.length;
			metrics.deepgramTextLength = deepgramText.length;

			if (groqText) {
				// Intentional: keep the raw Groq source text for replaying merge-quality comparisons.
				logger.info(
					{
						provider: "groq",
						text: groqText,
						textLength: groqText.length,
						recordingDurationMs: duration,
					},
					"Groq source transcript",
				);
			}

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

			// Check for hallucinations (short text or known patterns)
			// Only skip if we have strong evidence: no Deepgram text to validate against
			if (groqText && !deepgramText) {
				const isShortHallucination =
					streamingChunkCount === 0 &&
					groqText.length < HALLUCINATION_MAX_CHARS;
				const hasHallucinationPattern = containsHallucination(groqText);

				if (isShortHallucination || hasHallucinationPattern) {
					metrics.mergeStrategy = "skip_hallucination";
					logger.info(
						{
							groqTextLength: groqText.length,
							streamingChunkCount,
							hasPattern: hasHallucinationPattern,
							text: groqText.substring(0, 100),
						},
						"Filtered Groq hallucination (no Deepgram text to validate)",
					);
					notify(
						"No Speech Detected",
						"Recording contained no audible speech.",
						"warning",
					);
					this.setStatus("idle");
					return;
				}
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
				metrics.mergeReason = mergeTimed.result.reason;
			} else {
				finalText = groqText || deepgramText;
				metrics.mergeStrategy = "single_source";
				metrics.mergeReason = groqText
					? "groq_only"
					: deepgramText
						? "deepgram_only"
						: null;
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

			// --- Validation + recovery ---
			const recovery = await recoverTranscriptQuality({
				finalText,
				groqText,
				deepgramText,
				mergeStrategy: metrics.mergeStrategy,
				mergeReason: metrics.mergeReason,
				accuracy,
				repairMerge: async (groq, deepgram, failed, reasons) => {
					const repairTimed = await timeAsync(() =>
						this.merger.repairMerge(groq, deepgram, failed, reasons),
					);
					metrics.mergeMs += repairTimed.durationMs;
					return repairTimed.result;
				},
			});

			if (recovery.repairAttempted) {
				logger.warn(
					{
						reasons: recovery.initialValidation.reasons,
						text: finalText.substring(0, 200),
					},
					"Merged transcript failed validation; retrying repair",
				);
			}

			if (recovery.repairFailed) {
				logger.warn(
					{ reasons: recovery.validation.reasons },
					"Merged transcript repair failed; trying source fallback",
				);
			}

			finalText = recovery.finalText;
			accuracy = recovery.accuracy;
			metrics.mergeStrategy = recovery.mergeStrategy;
			metrics.mergeReason = recovery.mergeReason;
			let finalValidation = recovery.validation;
			metrics.validationReasons = finalValidation.reasons;
			metrics.validationRetryCount = recovery.validationRetryCount;
			metrics.validationFallbackSource = recovery.validationFallbackSource;
			metrics.trimmedHallucinationSuffix = finalValidation.trimmedSuffix;

			const longRecordingQuality = assessLongRecordingQuality({
				recordingDurationMs: duration,
				finalText,
				groqText,
				deepgramText,
			});
			metrics.longRecordingMode = longRecordingQuality.isLongRecording;
			metrics.suspiciousMergeExpansion =
				longRecordingQuality.suspiciousMergeExpansion;
			metrics.longRecordingFallbackSource = longRecordingQuality.fallbackSource;

			if (
				longRecordingQuality.suspiciousMergeExpansion &&
				longRecordingQuality.fallbackText
			) {
				logger.warn(
					{
						fallbackSource: longRecordingQuality.fallbackSource,
						finalTextLength: finalText.length,
						groqTextLength: groqText.length,
						deepgramTextLength: deepgramText.length,
						duration,
					},
					"Long recording merge expanded beyond source transcripts; using source fallback",
				);
				finalText = longRecordingQuality.fallbackText;
				finalValidation = validateTranscript(finalText);
				finalText = finalValidation.text;
				accuracy = undefined;
				metrics.mergeStrategy = "single_source";
				metrics.mergeReason =
					longRecordingQuality.fallbackSource === "groq"
						? "groq_only"
						: "deepgram_only";
				metrics.validationReasons = finalValidation.reasons;
				metrics.trimmedHallucinationSuffix = finalValidation.trimmedSuffix;
			}

			if (!finalValidation.valid) {
				logger.error(
					{
						reasons: finalValidation.reasons,
						text: finalText.substring(0, 200),
						textLength: finalText.length,
						duration,
					},
					"Transcript validation failed after retry and fallback",
				);
				notify(
					"Transcription Error",
					"Output quality check failed. Please try again.",
					"error",
				);
				throw new Error(
					`Transcript validation failed: ${finalValidation.reasons.join(", ")}`,
				);
			}

			if (metrics.validationReasons.length > 0) {
				logger.info(
					{
						reasons: metrics.validationReasons,
						retryCount: metrics.validationRetryCount,
						fallbackSource: metrics.validationFallbackSource,
						trimmedSuffix: metrics.trimmedHallucinationSuffix,
					},
					"Transcript validation recovered output",
				);
			}

			// --- Stage: Clipboard ---
			const clipboardTimed = await timeAsync(() =>
				this.clipboard.append(finalText),
			);
			metrics.clipboardMs = clipboardTimed.durationMs;

			// processingTime captures user-perceived latency (up to clipboard write).
			// The stages below (history + notification) are awaited but post-clipboard
			// bookkeeping — their latency is tracked separately in historyAppendMs /
			// notificationEnqueueMs and included in totalMs but not processingTime.
			const processingTime = Date.now() - totalStart;
			metrics.processingMs = processingTime;

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
					groqSttModel: metrics.groqSttModel,
					deepgramModel: metrics.deepgramModel,
					mergeModel: metrics.mergeModel,
					mergeStrategy: metrics.mergeStrategy,
					validationReasons: metrics.validationReasons,
				}),
			);
			metrics.historyAppendMs = historyTimed.durationMs;

			void appendStatsAggregateEntry({
				timestamp: new Date().toISOString(),
				processingMs: processingTime,
				engine: engineUsed,
				mergeStrategy: metrics.mergeStrategy,
				mergeReason: metrics.mergeReason,
				validationReasons: metrics.validationReasons,
				validationRetryCount: metrics.validationRetryCount,
				validationFallbackSource: metrics.validationFallbackSource,
				groqSttModel: metrics.groqSttModel,
				deepgramModel: metrics.deepgramModel,
				mergeModel: metrics.mergeModel,
			});

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
