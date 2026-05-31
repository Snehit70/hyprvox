import { describe, expect, it } from "vitest";
import {
	createPcmWavChunks,
	type WavChunkPlan,
} from "../src/transcribe/wav-chunker";

const SAMPLE_RATE = 16000;

function buildWav(
	samples: number[],
	options: {
		channels?: number;
		sampleRate?: number;
		bitsPerSample?: number;
		audioFormat?: number;
		declaredDataBytes?: number;
		appendTrailingByte?: boolean;
	} = {},
): Buffer {
	const channels = options.channels ?? 1;
	const sampleRate = options.sampleRate ?? SAMPLE_RATE;
	const bitsPerSample = options.bitsPerSample ?? 16;
	const audioFormat = options.audioFormat ?? 1;
	const bytesPerSample = bitsPerSample / 8;
	const blockAlign = channels * bytesPerSample;
	const byteRate = sampleRate * blockAlign;
	const data = Buffer.alloc(samples.length * bytesPerSample);

	for (const [index, sample] of samples.entries()) {
		data.writeInt16LE(sample, index * bytesPerSample);
	}

	const header = Buffer.alloc(44);
	header.write("RIFF", 0, "ascii");
	header.writeUInt32LE(36 + data.length, 4);
	header.write("WAVE", 8, "ascii");
	header.write("fmt ", 12, "ascii");
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(audioFormat, 20);
	header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(bitsPerSample, 34);
	header.write("data", 36, "ascii");
	header.writeUInt32LE(options.declaredDataBytes ?? data.length, 40);

	return Buffer.concat([
		header,
		data,
		...(options.appendTrailingByte ? [Buffer.from([255])] : []),
	]);
}

function readChunkSamples(buffer: Buffer): number[] {
	expect(buffer.subarray(0, 4).toString("ascii")).toBe("RIFF");
	expect(buffer.subarray(8, 12).toString("ascii")).toBe("WAVE");
	expect(buffer.subarray(12, 16).toString("ascii")).toBe("fmt ");
	expect(buffer.subarray(36, 40).toString("ascii")).toBe("data");

	const dataSize = buffer.readUInt32LE(40);
	expect(buffer.length).toBe(44 + dataSize);

	const samples: number[] = [];
	for (let offset = 44; offset < buffer.length; offset += 2) {
		samples.push(buffer.readInt16LE(offset));
	}
	return samples;
}

function getChunkBuffer(plan: WavChunkPlan, index: number): Buffer {
	const chunk = plan.chunks[index];
	if (!chunk) {
		throw new Error(`Missing chunk ${index}`);
	}
	return chunk.buffer;
}

describe("createPcmWavChunks", () => {
	it("emits valid WAV chunks with correct byte lengths and sample order", () => {
		const wav = buildWav([1, 2, 3, 4, 5, 6, 7, 8]);

		const plan = createPcmWavChunks(wav, {
			chunkSeconds: 4 / SAMPLE_RATE,
			overlapSeconds: 0,
		});

		expect(plan.chunked).toBe(true);
		expect(plan.chunks).toHaveLength(2);
		expect(readChunkSamples(getChunkBuffer(plan, 0))).toEqual([1, 2, 3, 4]);
		expect(readChunkSamples(getChunkBuffer(plan, 1))).toEqual([5, 6, 7, 8]);
		expect(getChunkBuffer(plan, 0).length).toBe(44 + 4 * 2);
		expect(getChunkBuffer(plan, 1).length).toBe(44 + 4 * 2);
	});

	it("applies overlap at internal boundaries", () => {
		const wav = buildWav([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

		const plan = createPcmWavChunks(wav, {
			chunkSeconds: 4 / SAMPLE_RATE,
			overlapSeconds: 1 / SAMPLE_RATE,
		});

		expect(plan.chunks).toHaveLength(3);
		expect(readChunkSamples(getChunkBuffer(plan, 0))).toEqual([1, 2, 3, 4]);
		expect(readChunkSamples(getChunkBuffer(plan, 1))).toEqual([4, 5, 6, 7]);
		expect(readChunkSamples(getChunkBuffer(plan, 2))).toEqual([7, 8, 9, 10]);
	});

	it("returns one chunk when the WAV is below the minimum duration", () => {
		const wav = buildWav([1, 2, 3, 4, 5, 6, 7, 8]);

		const plan = createPcmWavChunks(wav, {
			chunkSeconds: 4 / SAMPLE_RATE,
			overlapSeconds: 0,
			minDurationSeconds: 10,
		});

		expect(plan.chunked).toBe(false);
		expect(plan.chunks).toHaveLength(1);
		expect(readChunkSamples(getChunkBuffer(plan, 0))).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8,
		]);
	});

	it("clamps oversized streaming WAV data chunks to available PCM bytes", () => {
		const wav = buildWav([1, 2, 3, 4, 5, 6, 7, 8], {
			declaredDataBytes: 0xffffffff,
		});

		const plan = createPcmWavChunks(wav, {
			chunkSeconds: 4 / SAMPLE_RATE,
			overlapSeconds: 0,
		});

		expect(plan.dataBytesClamped).toBe(true);
		expect(plan.dataBytesTrimmed).toBe(false);
		expect(plan.chunks).toHaveLength(2);
		expect(readChunkSamples(getChunkBuffer(plan, 0))).toEqual([1, 2, 3, 4]);
		expect(readChunkSamples(getChunkBuffer(plan, 1))).toEqual([5, 6, 7, 8]);
	});

	it("trims a partial trailing PCM frame after clamping stream data", () => {
		const wav = buildWav([1, 2, 3, 4, 5], {
			declaredDataBytes: 0xffffffff,
			appendTrailingByte: true,
		});

		const plan = createPcmWavChunks(wav, {
			chunkSeconds: 3 / SAMPLE_RATE,
			overlapSeconds: 0,
		});

		expect(plan.dataBytesClamped).toBe(true);
		expect(plan.dataBytesTrimmed).toBe(true);
		expect(plan.chunks).toHaveLength(2);
		expect(readChunkSamples(getChunkBuffer(plan, 0))).toEqual([1, 2, 3]);
		expect(readChunkSamples(getChunkBuffer(plan, 1))).toEqual([4, 5]);
	});

	it("rejects corrupt and unsupported WAV inputs with useful reasons", () => {
		expect(() =>
			createPcmWavChunks(Buffer.from("not a wav"), {
				chunkSeconds: 1,
				overlapSeconds: 0,
			}),
		).toThrow(/Corrupt WAV|Unsupported WAV/);

		const stereoWav = buildWav([1, 2, 3, 4], { channels: 2 });

		expect(() =>
			createPcmWavChunks(stereoWav, {
				chunkSeconds: 1,
				overlapSeconds: 0,
			}),
		).toThrow("expected mono audio");
	});
});
