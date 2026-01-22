import { AudioRecorder } from "../audio/recorder";
import { HotkeyListener } from "./hotkey";
import { checkHotkeyConflict } from "./conflict";
import { GroqClient } from "../transcribe/groq";
import { DeepgramTranscriber } from "../transcribe/deepgram";
import { TranscriptMerger } from "../transcribe/merger";
import { convertAudio } from "../audio/converter";
import { ClipboardManager, ClipboardAccessError } from "../output/clipboard";
import { notify } from "../output/notification";
import { logger, logError } from "../utils/logger";
import { ErrorTemplates, formatUserError } from "../utils/error-templates";
import { loadConfig } from "../config/loader";
import { loadStats, incrementTranscriptionCount } from "../utils/stats";
import { appendHistory } from "../utils/history";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

type DaemonStatus = "idle" | "starting" | "recording" | "stopping" | "processing" | "error";

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

    this.setupListeners();
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
      logError("Failed to update daemon state file", e, { stateFile: this.stateFile });
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
      logger.info({ from: oldStatus, to: status }, `Daemon status changed: ${status}`);
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
      this.processAudio(audioBuffer, duration);
    });

    this.recorder.on("warning", (msg: string) => {
      notify("Warning", msg, "warning");
    });

    this.recorder.on("error", (err: Error) => {
      this.errorCount++;
      this.setStatus("error", err.message);
      
      let title = "Error";
      let message = err.message;

      if ((err as any).code === "NO_MICROPHONE") {
        title = "Microphone Error";
        message = formatUserError(ErrorTemplates.AUDIO.NO_MICROPHONE);
      } else if ((err as any).code === "PERMISSION_DENIED") {
        title = "Microphone Error";
        message = formatUserError(ErrorTemplates.AUDIO.PERMISSION_DENIED);
      } else if ((err as any).code === "DEVICE_BUSY") {
        title = "Microphone Error";
        message = formatUserError(ErrorTemplates.AUDIO.DEVICE_BUSY);
      } else if (message.toLowerCase().includes("permission denied") || message.toLowerCase().includes("microphone")) {
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
      await checkHotkeyConflict(config.behavior.hotkey);

      this.hotkeyListener.start();
      logger.info("Daemon started. Waiting for hotkey...");
    } catch (error) {
      logError("Failed to start daemon", error);
      throw error;
    }
  }

  public stop() {
    this.hotkeyListener.stop();
    this.recorder.stop(true);
    try {
      unlinkSync(this.pidFile);
      unlinkSync(this.stateFile);
    } catch (e) {
      
    }
    logger.info("Daemon stopped");
  }

  private async handleTrigger() {
    if (this.status === "idle" || this.status === "error") {
      try {
        this.setStatus("starting");
        await this.recorder.start();
      } catch (error) {
        this.setStatus("idle");
      }
    } else if (this.status === "recording") {
      this.setStatus("stopping");
      await this.recorder.stop();
    } else {
      logger.warn(`Hotkey ignored in state: ${this.status}`);
    }
  }

  private async processAudio(audioBuffer: Buffer, duration: number) {
    notify("Processing", "Transcribing audio...", "info");
    
    try {
      const config = loadConfig();
      const language = config.transcription.language;
      const boostWords = config.transcription.boostWords || [];

      // Convert audio to optimal format (16kHz WAV Mono)
      const convertedBuffer = await convertAudio(audioBuffer);

      let groqErr: any = null;
      let deepgramErr: any = null;
      const startTime = Date.now();

      const [groqText, deepgramText] = await Promise.all([
        this.groq.transcribe(convertedBuffer, language, boostWords).catch((err) => {
          groqErr = err;
          return "";
        }),
        this.deepgram.transcribe(convertedBuffer, language, boostWords).catch((err) => {
          deepgramErr = err;
          return "";
        }),
      ]);

      const processingTime = Date.now() - startTime;

      const handleTranscriptionError = (err: any, failedService: string) => {
        if (err?.message?.includes("Invalid API Key")) {
          const template = failedService === "Groq" ? ErrorTemplates.API.GROQ_INVALID_KEY : ErrorTemplates.API.DEEPGRAM_INVALID_KEY;
          notify("Configuration Error", formatUserError(template), "error");
        } else if (err?.message?.includes("Rate limit exceeded")) {
          const template = ErrorTemplates.API.RATE_LIMIT_EXCEEDED(failedService);
          notify("Rate Limit", formatUserError(template), "error");
        } else if (err?.message?.includes("timed out")) {
          logger.warn(`${failedService} API timed out`);
        } else {
          logError(`${failedService} failed`, err);
        }
      };

      if (!groqText && !deepgramText) {
        if (groqErr) handleTranscriptionError(groqErr, "Groq");
        if (deepgramErr) handleTranscriptionError(deepgramErr, "Deepgram");

        const template = ErrorTemplates.API.BOTH_SERVICES_FAILED;
        notify("Transcription Failed", formatUserError(template), "error");
        
        throw new Error("Both transcription services failed");
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
        }
        
        notify("Warning", `${failedService} failed, using fallback`, "warning");
      }

      if (!finalText) {
        throw new Error("No transcription generated");
      }

      await this.clipboard.append(finalText);
      
      const stats = incrementTranscriptionCount();
      this.transcriptionCountToday = stats.today;
      this.transcriptionCountTotal = stats.total;

      const engineUsed = groqText && deepgramText ? "groq+deepgram" : (groqText ? "groq" : "deepgram");
      appendHistory({
        timestamp: new Date().toISOString(),
        text: finalText,
        duration,
        engine: engineUsed,
        processingTime
      });

      notify("Success", "Transcription copied to clipboard", "success");
      
      logger.info({ 
        duration, 
        processingTime,
        text: finalText,
        textLength: finalText.length,
        groqText,
        groqTextLength: groqText.length,
        deepgramText,
        deepgramTextLength: deepgramText.length,
        models: groqText && deepgramText ? "groq+deepgram+llama" : (groqText ? "groq" : "deepgram")
      }, "Transcription complete");

    } catch (error: any) {
      logError("Processing failed", error, { duration });
      
      let message = "Transcription failed. Check logs.";
      if (error instanceof ClipboardAccessError) {
        const template = ErrorTemplates.CLIPBOARD.ACCESS_DENIED;
        message = formatUserError(template);
      } else if (error?.message?.includes("timed out")) {
        const template = ErrorTemplates.API.TIMEOUT("Both");
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
    }
  }
}
