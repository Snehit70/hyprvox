import { describe, expect, it, vi } from "vitest";
import {
	GroqChunkedTranscriptionError,
	type GroqChunkingOptions,
	transcribeGroqRecording,
} from "../src/transcribe/groq-chunking";
import { TranscriptionError } from "../src/utils/errors";

const SAMPLE_RATE = 16000;

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
	header.writeUInt32LE(SAMPLE_RATE, 24);
	header.writeUInt32LE(SAMPLE_RATE * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36, "ascii");
	header.writeUInt32LE(data.length, 40);

	return Buffer.concat([header, data]);
}

function chunkingOptions(
	overrides: Partial<GroqChunkingOptions> = {},
): GroqChunkingOptions {
	return {
		enabled: true,
		minDurationSeconds: 0,
		chunkSeconds: 3 / SAMPLE_RATE,
		overlapSeconds: 0,
		maxConcurrency: 3,
		fallbackToFullAudio: true,
		...overrides,
	};
}

function resolveAt(
	resolvers: Array<(value: string) => void>,
	index: number,
	value: string,
): void {
	const resolve = resolvers[index];
	if (!resolve) {
		throw new Error(`Missing resolver ${index}`);
	}
	resolve(value);
}

describe("GroqClient chunked transcription", () => {
	it("preserves output order when chunks complete out of order", async () => {
		const resolvers: Array<(value: string) => void> = [];
		const transcribe = vi.fn().mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					resolvers.push(resolve);
				}),
		);

		const resultPromise = transcribeGroqRecording({
			rawAudioBuffer: buildWav([1, 2, 3, 4, 5, 6, 7, 8, 9]),
			fallbackAudioBuffer: Buffer.from("fallback"),
			fallbackFormat: "wav",
			recordingDurationMs: 1000,
			chunking: chunkingOptions(),
			transcribe,
		});

		await vi.waitFor(() => expect(resolvers).toHaveLength(3));
		resolveAt(resolvers, 2, "third");
		resolveAt(resolvers, 0, "first");
		resolveAt(resolvers, 1, "second");

		const result = await resultPromise;

		expect(result.text).toBe("first second third");
		expect(result.chunking.used).toBe(true);
		expect(result.chunking.chunkCount).toBe(3);
		expect(result.chunking.fallback).toBe(false);
	});

	it("respects maxConcurrency", async () => {
		let active = 0;
		let maxActive = 0;

		const transcribe = vi.fn().mockImplementation(async () => {
			active++;
			maxActive = Math.max(maxActive, active);
			await new Promise((resolve) => setTimeout(resolve, 5));
			active--;
			return "chunk";
		});

		const result = await transcribeGroqRecording({
			rawAudioBuffer: buildWav([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
			fallbackAudioBuffer: Buffer.from("fallback"),
			fallbackFormat: "wav",
			recordingDurationMs: 1000,
			chunking: chunkingOptions({ maxConcurrency: 2 }),
			transcribe,
		});

		expect(transcribe).toHaveBeenCalledTimes(4);
		expect(maxActive).toBeLessThanOrEqual(2);
		expect(result.text).toBe("chunk chunk chunk chunk");
	});

	it("falls back to full audio when a chunk request fails", async () => {
		const fallbackAudioBuffer = Buffer.from("full audio");
		const transcribe = vi
			.fn()
			.mockRejectedValueOnce(new Error("chunk failed"))
			.mockResolvedValueOnce("full transcript");

		const result = await transcribeGroqRecording({
			rawAudioBuffer: buildWav([1, 2, 3, 4, 5, 6]),
			fallbackAudioBuffer,
			fallbackFormat: "wav",
			recordingDurationMs: 1000,
			chunking: chunkingOptions({ maxConcurrency: 1 }),
			transcribe,
		});

		expect(result.text).toBe("full transcript");
		expect(result.chunking.used).toBe(false);
		expect(result.chunking.fallback).toBe(true);
		expect(result.chunking.failureReason).toContain("chunk_request_failed");
		expect(transcribe).toHaveBeenLastCalledWith(
			fallbackAudioBuffer,
			"en",
			[],
			"wav",
			1000,
		);
	});

	it("propagates chunk errors when fallback is disabled", async () => {
		const providerError = new TranscriptionError(
			"Groq",
			"RATE_LIMIT_EXCEEDED",
			"Groq: Rate limit exceeded",
		);
		const transcribe = vi.fn().mockRejectedValue(providerError);

		try {
			await transcribeGroqRecording({
				rawAudioBuffer: buildWav([1, 2, 3, 4, 5, 6]),
				fallbackAudioBuffer: Buffer.from("fallback"),
				fallbackFormat: "wav",
				recordingDurationMs: 1000,
				chunking: chunkingOptions({ fallbackToFullAudio: false }),
				transcribe,
			});
			throw new Error("Expected transcribeChunked to fail");
		} catch (error: unknown) {
			expect(error).toBeInstanceOf(GroqChunkedTranscriptionError);
			expect((error as GroqChunkedTranscriptionError).cause).toBe(
				providerError,
			);
			expect(
				(error as GroqChunkedTranscriptionError).chunking.failureReason,
			).toContain("chunk_request_failed");
		}
	});
});
