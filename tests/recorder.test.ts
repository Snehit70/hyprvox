import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
	AudioRecorder,
	assertAudioBackendAvailable,
} from "../src/audio/recorder";
import type { Config } from "../src/config/schema";

function createTestConfig(): Config {
	return {
		behavior: {
			audioDevice: "default",
			clipboard: {
				minDuration: 0,
				maxDuration: 1,
			},
		},
	} as Config;
}

describe("assertAudioBackendAvailable", () => {
	it("passes when the backend probe succeeds", () => {
		expect(() => assertAudioBackendAvailable(() => {})).not.toThrow();
	});

	it("throws a clear audio backend error when the probe fails", () => {
		expect(() =>
			assertAudioBackendAvailable(() => {
				throw new Error("missing");
			}),
		).toThrow("Audio recording backend 'arecord' is not installed or not in PATH.");
	});
});

describe("AudioRecorder", () => {
	it("emits start as soon as arecord is spawned, before first audio data", async () => {
		const stream = new EventEmitter();
		const process = new EventEmitter() as EventEmitter & {
			stderr: EventEmitter;
		};
		process.stderr = new EventEmitter();
		const events: string[] = [];

		const recorder = new AudioRecorder({
			loadConfigFn: () => createTestConfig(),
			createRecording: () =>
				({
					process,
					stream: () => stream,
					stop: () => {
						process.emit("close");
					},
				}) as never,
		});

		recorder.on("start", () => events.push("start"));
		recorder.on("data", () => events.push("data"));

		const startPromise = recorder.start();
		await Promise.resolve();

		expect(events).toEqual(["start"]);

		stream.emit("data", Buffer.from("RIFF"));
		await startPromise;

		expect(events).toEqual(["start", "data"]);

		await recorder.stop(true);
	});
});
