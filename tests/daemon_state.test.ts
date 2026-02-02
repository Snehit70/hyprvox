import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const EventEmitter = require("node:events").EventEmitter;
	const recorder = new EventEmitter();
	(recorder as any).start = vi.fn(() => Promise.resolve());
	(recorder as any).stop = vi.fn(() => Promise.resolve(Buffer.from("audio")));

	const hotkey = new EventEmitter();
	(hotkey as any).start = vi.fn();
	(hotkey as any).stop = vi.fn();

	return {
		recorderInstance: recorder,
		hotkeyListenerInstance: hotkey,
	};
});

vi.mock("../src/audio/recorder", () => ({
	AudioRecorder: class {
		constructor() {
			return mocks.recorderInstance;
		}
	},
}));

vi.mock("../src/daemon/hotkey", () => ({
	HotkeyListener: class {
		constructor() {
			return mocks.hotkeyListenerInstance;
		}
	},
}));

vi.mock("../src/daemon/conflict", () => ({
	checkHotkeyConflict: vi.fn(() => Promise.resolve()),
}));

vi.mock("../src/transcribe/groq", () => ({
	GroqClient: class {
		async transcribe() {
			return "Groq text";
		}
	},
}));

vi.mock("../src/transcribe/deepgram", () => ({
	DeepgramTranscriber: class {
		async transcribe() {
			return "Deepgram text";
		}
	},
}));

vi.mock("../src/transcribe/merger", () => ({
	TranscriptMerger: class {
		async merge() {
			return "Merged text";
		}
	},
}));

vi.mock("../src/audio/converter", () => ({
	convertAudio: vi.fn((buf: Buffer) => Promise.resolve(buf)),
}));

vi.mock("../src/output/clipboard", () => ({
	ClipboardManager: class {
		async append() {
			return undefined;
		}
	},
	ClipboardAccessError: class extends Error {
		constructor(message: string) {
			super(message);
			this.name = "ClipboardAccessError";
		}
	},
}));

vi.mock("../src/output/notification", () => ({
	notify: vi.fn(),
}));

vi.mock("../src/config/loader", () => ({
	loadConfig: vi.fn(() => ({
		transcription: { language: "en", boostWords: [] },
		behavior: { audioDevice: "default", hotkey: "ControlRight" },
		apiKeys: { groq: "gsk_mock", deepgram: "mock-uuid" },
	})),
}));

vi.mock("../src/utils/logger", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
	logError: vi.fn(),
}));

vi.mock("../src/utils/stats", () => ({
	loadStats: vi.fn(() => ({ today: 0, total: 0 })),
	incrementTranscriptionCount: vi.fn(() => ({ today: 1, total: 1 })),
}));

vi.mock("../src/utils/history", () => ({
	appendHistory: vi.fn(),
}));

vi.mock("node:fs", () => ({
	writeFileSync: vi.fn(),
	unlinkSync: vi.fn(),
	existsSync: vi.fn(() => true),
	readFileSync: vi.fn(() => "{}"),
}));

vi.mock("node:os", () => ({
	homedir: vi.fn(() => "/tmp"),
}));

import { writeFileSync } from "node:fs";
import { DaemonService } from "../src/daemon/service";

describe("DaemonService State Management", () => {
	let service: DaemonService;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.recorderInstance.removeAllListeners();
		mocks.hotkeyListenerInstance.removeAllListeners();
		service = new DaemonService();
	});

	afterEach(async () => {
		await service.stop();
	});

	test("Initial state should be idle", () => {
		expect((service as any).status).toBe("idle");
	});

	test("Idle -> Starting transition on hotkey trigger", async () => {
		mocks.hotkeyListenerInstance.emit("trigger");
		expect((service as any).status).toBe("starting");
		expect((mocks.recorderInstance as any).start).toHaveBeenCalled();
	});

	test("Starting -> Recording transition on recorder start event", async () => {
		(service as any).status = "starting";
		mocks.recorderInstance.emit("start");
		expect((service as any).status).toBe("recording");
	});

	test("Recording -> Stopping transition on hotkey trigger", async () => {
		(service as any).status = "recording";
		mocks.hotkeyListenerInstance.emit("trigger");
		expect((service as any).status).toBe("stopping");
		expect((mocks.recorderInstance as any).stop).toHaveBeenCalled();
	});

	test("Stopping -> Processing transition on recorder stop event", async () => {
		(service as any).status = "stopping";
		mocks.recorderInstance.emit("stop", Buffer.from("test"), 1000);
		expect((service as any).status).toBe("processing");
	});

	test("Processing -> Idle transition on successful transcription", async () => {
		(service as any).status = "processing";
		await (service as any).processAudio(Buffer.from("test"), 1000);
		expect((service as any).status).toBe("idle");
	});

	test("Recorder error should transition to error state", () => {
		mocks.recorderInstance.emit("error", new Error("Microphone failure"));
		expect((service as any).status).toBe("error");
		expect((service as any).lastError).toBe("Microphone failure");
		expect((service as any).errorCount).toBe(1);
	});

	test("Processing error should transition to error state", async () => {
		const { GroqClient } = await import("../src/transcribe/groq");
		const { DeepgramTranscriber } = await import("../src/transcribe/deepgram");

		vi.spyOn(GroqClient.prototype, "transcribe").mockRejectedValue(
			new Error("API Error"),
		);
		vi.spyOn(DeepgramTranscriber.prototype, "transcribe").mockRejectedValue(
			new Error("API Error"),
		);

		await (service as any).processAudio(Buffer.from("test"), 1000);

		expect((service as any).status).toBe("error");
		expect((service as any).lastError).toBe(
			"Transcription failed. Check logs.",
		);
		expect((service as any).errorCount).toBe(1);
	});

	test("Trigger in error state should clear error and transition to starting", async () => {
		(service as any).status = "error";
		(service as any).lastError = "some error";

		mocks.hotkeyListenerInstance.emit("trigger");
		expect((service as any).status).toBe("starting");
		expect((service as any).lastError).toBeUndefined();
	});

	test("State persistence: daemon.state file should be updated on status change", () => {
		(service as any).setStatus("recording");
		expect(writeFileSync).toHaveBeenCalledWith(
			expect.stringContaining("daemon.state"),
			expect.stringContaining('"status": "recording"'),
		);
	});

	test("Triggers should be ignored in certain states", async () => {
		const ignoredStates = ["starting", "stopping", "processing"];
		const { logger } = await import("../src/utils/logger");

		for (const state of ignoredStates) {
			vi.clearAllMocks();
			(service as any).status = state;
			mocks.hotkeyListenerInstance.emit("trigger");
			expect((mocks.recorderInstance as any).start).not.toHaveBeenCalled();
			expect((mocks.recorderInstance as any).stop).not.toHaveBeenCalled();
			expect(logger.warn).toHaveBeenCalledWith(
				expect.stringContaining(`Hotkey ignored in state: ${state}`),
			);
		}
	});
});
