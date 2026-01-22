import { EventEmitter } from "node:events";
import { record, type Recording } from "node-record-lpcm16";
import { logError, logger } from "../utils/logger";
import { loadConfig } from "../config/loader";

export class AudioRecorder extends EventEmitter {
  private recording: Recording | null = null;
  private chunks: Buffer[] = [];
  private startTime: number = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private warningTimer4m: ReturnType<typeof setTimeout> | null = null;
  private warningTimer430m: ReturnType<typeof setTimeout> | null = null;
  private readonly MIN_DURATION = 600;
  private readonly MAX_DURATION = 300000;
  private readonly WARNING_4M = 240000;
  private readonly WARNING_430M = 270000;

  constructor() {
    super();
  }

  public isRecording(): boolean {
    return this.recording !== null;
  }

  public async start(): Promise<void> {
    if (this.isRecording()) {
      throw new Error("Already recording");
    }

    this.chunks = [];
    this.startTime = Date.now();

    const config = loadConfig();

    try {
      this.recording = record({
        sampleRate: 16000,
        channels: 1,
        audioType: "wav",
        recorder: "arecord",
        device: config.behavior.audioDevice,
      });

      const stream = this.recording.stream();

      stream.on("data", (chunk: Buffer) => {
        this.chunks.push(chunk);
      });

      stream.on("error", (err: unknown) => {
        logError("Audio stream error", err);
        this.emit("error", err);
        this.stop(true);
      });

      this.warningTimer4m = setTimeout(() => {
        this.emit("warning", "Recording limit approaching (4m)");
      }, this.WARNING_4M);

      this.warningTimer430m = setTimeout(() => {
        this.emit("warning", "Recording limit approaching (4m 30s)");
      }, this.WARNING_430M);

      this.timer = setTimeout(() => {
        this.emit("warning", "Recording limit reached (5m). Stopping...");
        this.stop();
      }, this.MAX_DURATION);

      logger.info("Recording started");
      this.emit("start");
    } catch (error) {
      logError("Failed to start recording", error);
      this.cleanup();
      throw error;
    }
  }

  public async stop(force = false): Promise<Buffer | null> {
    if (!this.isRecording()) {
      return null;
    }

    const duration = Date.now() - this.startTime;

    this.cleanup();

    if (this.recording) {
      this.recording.stop();
      this.recording = null;
    }

    const audioBuffer = Buffer.concat(this.chunks);
    this.chunks = [];

    if (!force) {
      if (duration < this.MIN_DURATION) {
        logger.warn(`Recording too short: ${duration}ms`);
        this.emit("error", new Error("Recording too short"));
        return null;
      }

      if (this.isSilent(audioBuffer)) {
        logger.warn("Silent audio detected");
        this.emit("warning", "No audio detected");
      }
    }

    logger.info(`Recording stopped. Duration: ${duration}ms. Size: ${audioBuffer.length} bytes`);
    this.emit("stop", audioBuffer, duration);
    return audioBuffer;
  }

  private cleanup() {
    if (this.timer) clearTimeout(this.timer);
    if (this.warningTimer4m) clearTimeout(this.warningTimer4m);
    if (this.warningTimer430m) clearTimeout(this.warningTimer430m);
    this.timer = null;
    this.warningTimer4m = null;
    this.warningTimer430m = null;
  }

  private isSilent(buffer: Buffer): boolean {
    if (buffer.length === 0) return true;
    
    let sumSquares = 0;
    const sampleCount = buffer.length / 2;
    
    for (let i = 0; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i);
      sumSquares += sample * sample;
    }
    
    const rms = Math.sqrt(sumSquares / sampleCount);
    const threshold = 100;
    
    return rms < threshold;
  }
}
