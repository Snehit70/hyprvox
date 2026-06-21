import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
	AudioRecorder,
	assertAudioBackendAvailable,
	buildWaveformBins,
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
		).toThrow(
			"Audio recording backend 'arecord' is not installed or not in PATH.",
		);
	});
});

describe("buildWaveformBins", () => {
	function sineWave(frequency: number, amplitude = 0.4): Int16Array {
		return Int16Array.from({ length: 256 }, (_, index) =>
			Math.round(
				Math.sin((2 * Math.PI * frequency * index) / 16000) * 32767 * amplitude,
			),
		);
	}

	it("returns silent frequency bins for silent PCM", () => {
		expect(buildWaveformBins(new Int16Array(256))).toEqual(
			new Array(24).fill(0),
		);
	});

	it("places different voice frequencies in different spectrum bars", () => {
		const lowVoice = buildWaveformBins(sineWave(1000));
		const highVoice = buildWaveformBins(sineWave(2000));
		const strongestIndex = (values: number[]) =>
			values.indexOf(Math.max(...values));

		expect(strongestIndex(lowVoice)).toBeGreaterThanOrEqual(4);
		expect(strongestIndex(lowVoice)).toBeLessThanOrEqual(7);
		expect(strongestIndex(highVoice)).toBeGreaterThanOrEqual(12);
		expect(strongestIndex(highVoice)).toBeLessThanOrEqual(15);
		expect(Math.max(...lowVoice)).toBeGreaterThan(0.5);
		expect(Math.max(...highVoice)).toBeGreaterThan(0.5);
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

	function wavHeader(dataBytes: number): Buffer {
		const header = Buffer.alloc(44);
		header.write("RIFF", 0);
		header.writeUInt32LE(36 + dataBytes, 4);
		header.write("WAVE", 8);
		header.write("fmt ", 12);
		header.writeUInt32LE(16, 16);
		header.writeUInt16LE(1, 20); // PCM
		header.writeUInt16LE(1, 22); // mono
		header.writeUInt32LE(16000, 24);
		header.writeUInt32LE(16000 * 2, 28);
		header.writeUInt16LE(2, 32);
		header.writeUInt16LE(16, 34);
		header.write("data", 36);
		header.writeUInt32LE(dataBytes, 40);
		return header;
	}

	it("sub-frames one arecord chunk into many ~16ms level frames", async () => {
		const stream = new EventEmitter();
		const process = new EventEmitter() as EventEmitter & {
			stderr: EventEmitter;
		};
		process.stderr = new EventEmitter();

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

		const levels: { timestamp: number; waveform: number[] }[] = [];
		recorder.on("level", (payload) => levels.push(payload));

		const startPromise = recorder.start();
		await Promise.resolve();

		// One realistic arecord chunk: 2000 samples (125ms) of 1kHz tone.
		const samples = 2000;
		const pcm = Buffer.alloc(samples * 2);
		for (let i = 0; i < samples; i++) {
			pcm.writeInt16LE(
				Math.round(Math.sin((2 * Math.PI * 1000 * i) / 16000) * 32767 * 0.4),
				i * 2,
			);
		}
		stream.emit("data", Buffer.concat([wavHeader(pcm.length), pcm]));
		await startPromise;

		// 2000 samples / 256-sample hop = 7 frames from a single chunk (~8fps -> ~60fps).
		expect(levels.length).toBe(7);
		// Each frame carries its own 24-bin spectrum.
		expect(levels[0]?.waveform).toHaveLength(24);
		// Timestamps are spread ~16ms apart so the daemon throttle forwards each.
		const gaps = levels
			.slice(1)
			.map((frame, index) => frame.timestamp - (levels[index]?.timestamp ?? 0));
		for (const gap of gaps) {
			expect(gap).toBeGreaterThanOrEqual(15);
			expect(gap).toBeLessThanOrEqual(17);
		}

		await recorder.stop(true);
	});

	it("carries leftover samples between chunks without dropping audio", async () => {
		const stream = new EventEmitter();
		const process = new EventEmitter() as EventEmitter & {
			stderr: EventEmitter;
		};
		process.stderr = new EventEmitter();

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

		const levels: unknown[] = [];
		recorder.on("level", (payload) => levels.push(payload));

		const startPromise = recorder.start();
		await Promise.resolve();

		// 300 samples leaves 44 over after one 256-sample hop; the next 300-sample
		// chunk should then complete a second hop from the carried remainder.
		const tone = (count: number) => {
			const pcm = Buffer.alloc(count * 2);
			for (let i = 0; i < count; i++) {
				pcm.writeInt16LE(8000, i * 2);
			}
			return pcm;
		};

		stream.emit("data", Buffer.concat([wavHeader(600), tone(300)]));
		await startPromise;
		expect(levels.length).toBe(1);

		stream.emit("data", tone(300));
		expect(levels.length).toBe(2); // 44 carried + 300 = 344 -> one more hop

		await recorder.stop(true);
	});
});
