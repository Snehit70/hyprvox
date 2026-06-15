import { describe, expect, test } from "vitest";
import { PcmStreamExtractor } from "../src/audio/pcm-stream";

function buildWav(samples: number[]): Buffer {
	const data = Buffer.alloc(samples.length * 2);
	for (const [index, sample] of samples.entries()) {
		data.writeInt16LE(sample, index * 2);
	}

	const header = Buffer.alloc(44);
	header.write("RIFF", 0, "ascii");
	header.writeUInt32LE(36 + data.length, 4);
	header.write("WAVE", 8, "ascii");
	header.write("fmt ", 12, "ascii");
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(16000, 24);
	header.writeUInt32LE(32000, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36, "ascii");
	header.writeUInt32LE(data.length, 40);

	return Buffer.concat([header, data]);
}

function readSamples(buffer: Buffer): number[] {
	const samples: number[] = [];
	for (let offset = 0; offset + 1 < buffer.length; offset += 2) {
		samples.push(buffer.readInt16LE(offset));
	}
	return samples;
}

describe("PcmStreamExtractor", () => {
	test("strips a split WAV header and emits clean PCM", () => {
		const wav = buildWav([1, 2, 3, 4]);
		const extractor = new PcmStreamExtractor();

		expect(extractor.accept(wav.subarray(0, 20))).toBeNull();
		expect(extractor.accept(wav.subarray(20, 44))).toBeNull();
		const firstPcm = extractor.accept(wav.subarray(44, 48));
		const secondPcm = extractor.accept(wav.subarray(48));

		expect(firstPcm?.sampleRate).toBe(16000);
		expect(firstPcm?.channels).toBe(1);
		expect(firstPcm?.bitsPerSample).toBe(16);
		expect(readSamples(Buffer.concat([firstPcm?.pcm ?? Buffer.alloc(0), secondPcm?.pcm ?? Buffer.alloc(0)]))).toEqual([
			1,
			2,
			3,
			4,
		]);
	});

	test("keeps odd PCM byte pending until the next chunk", () => {
		const extractor = new PcmStreamExtractor();
		const raw = Buffer.from([1, 0, 2, 0, 3]);

		const first = extractor.accept(raw);
		const second = extractor.accept(Buffer.from([0]));

		expect(first?.pcm).toEqual(Buffer.from([1, 0, 2, 0]));
		expect(second?.pcm).toEqual(Buffer.from([3, 0]));
	});
});
