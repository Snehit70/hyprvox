import { describe, expect, test, beforeEach, spyOn, mock } from "bun:test";
import { EventEmitter } from "node:events";

const mockRecorderStart = mock(() => Promise.resolve());
const mockRecorderStop = mock(() => Promise.resolve(Buffer.from("audio")));
const mockRecorder = new EventEmitter();
(mockRecorder as any).start = mockRecorderStart;
(mockRecorder as any).stop = mockRecorderStop;

mock.module("../src/audio/recorder", () => ({
  AudioRecorder: class {
    constructor() { return mockRecorder; }
  }
}));

const mockHotkeyListener = new EventEmitter();
(mockHotkeyListener as any).start = mock(() => {});
(mockHotkeyListener as any).stop = mock(() => {});

mock.module("../src/daemon/hotkey", () => ({
  HotkeyListener: class {
    constructor() { return mockHotkeyListener; }
  }
}));

mock.module("groq-sdk", () => ({
  default: class { audio = { transcriptions: { create: mock() } } }
}));


mock.module("@deepgram/sdk", () => ({
  createClient: () => ({ listen: { prerecorded: { transcribeFile: mock() } } })
}));

mock.module("../src/transcribe/merger", () => ({
  TranscriptMerger: class {
    merge() { return Promise.resolve("Merged text"); }
  }
}));

mock.module("../src/output/clipboard", () => ({
  ClipboardManager: class {
    append() { return Promise.resolve(); }
  },
  ClipboardAccessError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ClipboardAccessError";
    }
  }
}));

mock.module("../src/output/notification", () => ({
  notify: mock(() => {})
}));

mock.module("../src/config/loader", () => ({
  loadConfig: () => ({
    transcription: { language: "en", boostWords: [] },
    behavior: { audioDevice: "default" },
    apiKeys: { groq: "mock", deepgram: "mock" }
  })
}));


mock.module("../src/audio/converter", () => ({
  convertAudio: (buf: Buffer) => Promise.resolve(buf)
}));

mock.module("node:fs", () => ({
  writeFileSync: mock(() => {}),
  unlinkSync: mock(() => {}),
}));

mock.module("node:path", () => ({
  join: (...args: string[]) => args.join("/")
}));

mock.module("node:os", () => ({
  homedir: () => "/tmp"
}));

const { DaemonService } = await import("../src/daemon/service");
import { logger } from "../src/utils/logger";
import { GroqClient } from "../src/transcribe/groq";
import { DeepgramTranscriber } from "../src/transcribe/deepgram";

describe("DaemonService State Management", () => {
  let service: any;

  beforeEach(() => {
    mockRecorderStart.mockClear();
    mockRecorderStop.mockClear();
    mockHotkeyListener.removeAllListeners();
    mockRecorder.removeAllListeners();
    
    spyOn(logger, "info").mockImplementation(() => {});
    spyOn(logger, "warn").mockImplementation(() => {});
    spyOn(logger, "error").mockImplementation(() => {});

    spyOn(GroqClient.prototype, "transcribe").mockResolvedValue("Groq text");
    spyOn(DeepgramTranscriber.prototype, "transcribe").mockResolvedValue("Deepgram text");

    service = new DaemonService();
  });

  test("initial state should be idle", () => {
    expect(service.status).toBe("idle");
  });

  test("trigger while idle should start recording", async () => {
    mockHotkeyListener.emit("trigger");
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockRecorderStart).toHaveBeenCalled();
    expect(service.status).toBe("starting");
    
    mockRecorder.emit("start");
    expect(service.status).toBe("recording");
  });

  test("trigger while recording should stop recording", async () => {
    service.status = "recording";
    
    mockHotkeyListener.emit("trigger");
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockRecorderStop).toHaveBeenCalled();
    expect(service.status).toBe("stopping");
    
    mockRecorder.emit("stop", Buffer.from("test"), 1000);
    expect(service.status).toBe("processing");
  });

  test("processing failure should set error state and persist lastError", async () => {
    service.status = "processing";
    const errorMsg = "API error";
    spyOn(GroqClient.prototype, "transcribe").mockRejectedValue(new Error(errorMsg));
    spyOn(DeepgramTranscriber.prototype, "transcribe").mockRejectedValue(new Error(errorMsg));
    
    mockRecorder.emit("stop", Buffer.from("test"), 1000);
    
    await new Promise(resolve => setTimeout(resolve, 50));
    
    expect(service.status).toBe("error");
    expect(service.lastError).toBe("Transcription failed. Check logs.");
    expect(service.errorCount).toBe(1);
  });

  test("recorder error should set error state", () => {
    mockRecorder.emit("error", new Error("Mic failure"));
    
    expect(service.status).toBe("error");
    expect(service.lastError).toBe("Mic failure");
    expect(service.errorCount).toBe(1);
  });

  test("new trigger should clear lastError and reset state from error to starting", async () => {
    service.status = "error";
    service.lastError = "previous error";
    
    mockHotkeyListener.emit("trigger");
    await new Promise(resolve => setTimeout(resolve, 10));
    
    expect(service.status).toBe("starting");
    expect(service.lastError).toBeUndefined();
  });

  test("trigger while processing should be ignored", async () => {
    service.status = "processing";
    
    mockHotkeyListener.emit("trigger");
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockRecorderStart).not.toHaveBeenCalled();
    expect(mockRecorderStop).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("ignored"));
  });

  test("trigger while starting should be ignored", async () => {
    service.status = "starting";
    
    mockHotkeyListener.emit("trigger");
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockRecorderStart).not.toHaveBeenCalled();
    expect(mockRecorderStop).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("ignored"));
  });
  
  test("trigger while stopping should be ignored", async () => {
    service.status = "stopping";
    
    mockHotkeyListener.emit("trigger");
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockRecorderStart).not.toHaveBeenCalled();
    expect(mockRecorderStop).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("ignored"));
  });
});
