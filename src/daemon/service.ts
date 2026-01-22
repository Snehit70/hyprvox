import { AudioRecorder } from "../audio/recorder";
import { HotkeyListener } from "./hotkey";
import { checkHotkeyConflict } from "./conflict";
import { GroqClient } from "../transcribe/groq";
import { DeepgramTranscriber } from "../transcribe/deepgram";
import { TranscriptMerger } from "../transcribe/merger";
import { convertAudio } from "../audio/converter";
import { ClipboardManager } from "../output/clipboard";
import { notify } from "../output/notification";
import { logger, logError } from "../utils/logger";
import { loadConfig } from "../config/loader";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

type DaemonStatus = "idle" | "starting" | "recording" | "stopping" | "processing" | "error";

export class DaemonService {
  private status: DaemonStatus = "idle";
  private recorder: AudioRecorder;
  private hotkeyListener: HotkeyListener;
  private groq: GroqClient;
  private deepgram: DeepgramTranscriber;
  private merger: TranscriptMerger;
  private clipboard: ClipboardManager;
  private pidFile: string;

  constructor() {
    this.recorder = new AudioRecorder();
    this.hotkeyListener = new HotkeyListener();
    this.groq = new GroqClient();
    this.deepgram = new DeepgramTranscriber();
    this.merger = new TranscriptMerger();
    this.clipboard = new ClipboardManager();
    this.pidFile = join(homedir(), ".config", "voice-cli", "daemon.pid");

    this.setupListeners();
  }

  private setupListeners() {
    this.hotkeyListener.on("trigger", () => this.handleTrigger());
    
    this.recorder.on("start", () => {
      this.status = "recording";
      notify("Recording Started", "Listening...", "info");
    });

    this.recorder.on("stop", (audioBuffer: Buffer, duration: number) => {
      this.status = "processing";
      this.processAudio(audioBuffer, duration);
    });

    this.recorder.on("warning", (msg: string) => {
      notify("Warning", msg, "warning");
    });

    this.recorder.on("error", (err: Error) => {
      this.status = "error";
      
      let title = "Error";
      const message = err.message;

      if (message.toLowerCase().includes("permission denied") || message.toLowerCase().includes("microphone")) {
        title = "Microphone Error";
      }

      notify(title, message, "error");
      this.status = "idle";
    });
  }

  public async start() {
    try {
      writeFileSync(this.pidFile, process.pid.toString());
      
      const config = loadConfig();
      await checkHotkeyConflict(config.behavior.hotkey);

      this.hotkeyListener.start();
      logger.info("Daemon started. Waiting for hotkey...");
    } catch (error) {
      logError("Failed to start daemon", error);
      process.exit(1);
    }
  }

  public stop() {
    this.hotkeyListener.stop();
    this.recorder.stop(true);
    try {
      unlinkSync(this.pidFile);
    } catch (e) {
      
    }
    logger.info("Daemon stopped");
  }

  private async handleTrigger() {
    if (this.status === "idle") {
      try {
        this.status = "starting";
        await this.recorder.start();
      } catch (error) {
        this.status = "idle";
      }
    } else if (this.status === "recording") {
      this.status = "stopping";
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

      const [groqResult, deepgramResult] = await Promise.allSettled([
        this.groq.transcribe(convertedBuffer, language, boostWords),
        this.deepgram.transcribe(convertedBuffer, language, boostWords),
      ]);

      const groqText = groqResult.status === "fulfilled" ? groqResult.value : "";
      const deepgramText = deepgramResult.status === "fulfilled" ? deepgramResult.value : "";

      if (groqResult.status === "rejected") {
        const err = groqResult.reason;
        if (err?.message === "Groq: Invalid API Key") {
          notify("Configuration Error", "Invalid Groq API Key. Check config.", "error");
        } else if (err?.message?.includes("timed out")) {
          logError("Groq API timed out", err);
        } else {
          logError("Groq failed", err);
        }
      }
      if (deepgramResult.status === "rejected") {
        const err = deepgramResult.reason;
        if (err?.message === "Deepgram: Invalid API Key") {
          notify("Configuration Error", "Invalid Deepgram API Key. Check config.", "error");
        } else if (err?.message?.includes("timed out")) {
          logError("Deepgram API timed out", err);
        } else {
          logError("Deepgram failed", err);
        }
      }

      if (!groqText && !deepgramText) {
        const groqErr = (groqResult as PromiseRejectedResult).reason;
        const deepgramErr = (deepgramResult as PromiseRejectedResult).reason;

        if (groqErr?.message?.includes("timed out") && deepgramErr?.message?.includes("timed out")) {
          throw new Error("Transcription request timed out (both APIs)");
        }
        throw new Error("Both transcription services failed");
      }

      let finalText = "";
      if (groqText && deepgramText) {
        finalText = await this.merger.merge(groqText, deepgramText);
      } else {
        finalText = groqText || deepgramText;
        
        const failedService = !groqText ? "Groq" : "Deepgram";
        const result = !groqText ? groqResult : deepgramResult;
        const reason = (result as PromiseRejectedResult).reason?.message || "Unknown error";
        
        let warningMsg = `${failedService} failed, using fallback`;
        if (reason.includes("timed out")) {
          warningMsg = `${failedService} timed out, using fallback`;
        }
        
        notify("Warning", warningMsg, "warning");
      }

      if (!finalText) {
        throw new Error("No transcription generated");
      }

      await this.clipboard.append(finalText);
      
      notify("Success", "Transcription copied to clipboard", "success");
      logger.info({ 
        duration, 
        groqLength: groqText.length, 
        deepgramLength: deepgramText.length, 
        finalLength: finalText.length 
      }, "Transcription complete");

    } catch (error) {
      logError("Processing failed", error);
      notify("Error", "Transcription failed. Check logs.", "error");
    } finally {
      this.status = "idle";
    }
  }
}
