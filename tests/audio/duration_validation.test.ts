import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { AudioRecorder } from "../../src/audio/recorder";
import { EventEmitter } from "node:events";

// Mock dependencies
vi.mock("../../src/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  logError: vi.fn(),
}));

vi.mock("../../src/config/loader", () => ({
  loadConfig: vi.fn(() => ({
    behavior: {
      audioDevice: "default",
      clipboard: {
        minDuration: 0.6,
        maxDuration: 300
      }
    },
  })),
}));

const mockStream = new EventEmitter() as any;
mockStream.stop = vi.fn();

vi.mock("node-record-lpcm16", () => ({
  record: vi.fn(() => ({
    stream: () => mockStream,
    stop: vi.fn(),
    process: {
      stderr: new EventEmitter(),
    },
  })),
}));

describe("AudioRecorder Duration Validation", () => {
  let recorder: AudioRecorder;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 1, 12, 0, 0));
    recorder = new AudioRecorder();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Minimum Duration (600ms)", () => {
    it("should fail if recording is shorter than 600ms", async () => {
      await recorder.start();
      
      vi.advanceTimersByTime(599);
      
      const errorPromise = new Promise((resolve) => {
        recorder.on("error", (err) => resolve(err));
      });

      const buffer = await recorder.stop();
      
      expect(buffer).toBeNull();
      const error = await errorPromise as Error;
      expect(error.message).toBe("Recording too short");
    });

    it("should succeed if recording is exactly 600ms", async () => {
      await recorder.start();
      
      const nonSilentData = Buffer.alloc(100);
      nonSilentData.writeInt16LE(1000, 0);
      mockStream.emit("data", nonSilentData);

      vi.advanceTimersByTime(600);
      
      const buffer = await recorder.stop();
      
      expect(buffer).not.toBeNull();
    });

    it("should bypass minimum duration check if force is true", async () => {
      await recorder.start();
      
      vi.advanceTimersByTime(100);
      
      const buffer = await recorder.stop(true);
      
      expect(buffer).not.toBeNull();
    });

    it("should warn if recording is silent", async () => {
      await recorder.start();
      
      const silentData = Buffer.alloc(1000, 0);
      mockStream.emit("data", silentData);

      vi.advanceTimersByTime(1000);
      
      const warningPromise = new Promise((resolve) => {
        recorder.on("warning", (msg) => {
          if (msg === "No audio detected") {
            resolve(msg);
          }
        });
      });

      await recorder.stop();
      
      const warning = await warningPromise;
      expect(warning).toBe("No audio detected");
    });
  });

  describe("Maximum Duration (5 minutes) and Warnings", () => {
    it("should emit warning at 4 minutes", async () => {
      await recorder.start();
      
      const warningPromise = new Promise((resolve) => {
        recorder.on("warning", (msg) => {
          if (msg.includes("4m") && !msg.includes("30s")) {
            resolve(msg);
          }
        });
      });

      vi.advanceTimersByTime(4 * 60 * 1000);
      
      const warning = await warningPromise;
      expect(warning).toBe("Recording limit approaching (4m)");
    });

    it("should emit warning at 4 minutes 30 seconds", async () => {
      await recorder.start();
      
      const warningPromise = new Promise((resolve) => {
        recorder.on("warning", (msg) => {
          if (msg.includes("4m 30s")) {
            resolve(msg);
          }
        });
      });

      vi.advanceTimersByTime(4.5 * 60 * 1000);
      
      const warning = await warningPromise;
      expect(warning).toBe("Recording limit approaching (4m 30s)");
    });

    it("should auto-stop at 5 minutes", async () => {
      await recorder.start();
      
      const stopPromise = new Promise<void>((resolve) => {
        recorder.on("stop", () => resolve());
      });

      const warningPromise = new Promise((resolve) => {
        recorder.on("warning", (msg) => {
          if (msg.includes("5m")) {
            resolve(msg);
          }
        });
      });

      vi.advanceTimersByTime(5 * 60 * 1000);
      
      const warning = await warningPromise;
      await stopPromise;
      
      expect(warning).toBe("Recording limit reached (5m). Stopping...");
      expect(recorder.isRecording()).toBe(false);
    }, 10000);
  });
});

