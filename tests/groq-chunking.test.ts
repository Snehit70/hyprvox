import { describe, expect, it, vi } from "vitest";
import type { GroqChunkingOptions } from "../src/transcribe/groq-chunking";
import { GroqLiveChunkSession } from "../src/transcribe/groq-live-chunking";

function chunkingOptions(
	overrides: Partial<GroqChunkingOptions> = {},
): GroqChunkingOptions {
	return {
		enabled: true,
		mode: "live",
		minDurationSeconds: 0,
		chunkSeconds: 0.05,
		overlapSeconds: 0,
		maxConcurrency: 3,
		chunkMaxRetries: 1,
		chunkRetryBackoffMs: 5,
		liveFinalizeTimeoutMs: 200,
		fallbackToFullAudio: true,
		logChunkTranscripts: false,
		...overrides,
	};
}

function pcmFromSamples(sampleCount: number): Buffer {
	return Buffer.alloc(sampleCount * 2, 1);
}

describe("Groq live chunk session", () => {
	it("preserves output order when chunk completion is out of order", async () => {
		const resolvers: Array<(value: string) => void> = [];
		const transcribe = vi.fn().mockImplementation(
			() => new Promise<string>((resolve) => resolvers.push(resolve)),
		);
		const session = new GroqLiveChunkSession({
			chunking: chunkingOptions({ chunkSeconds: 0.01 }),
			language: "en",
			boostWords: [],
			transcribe,
		});

		session.acceptPcmData(pcmFromSamples(160 * 3));
		expect(resolvers).toHaveLength(3);
		resolvers[2]?.("third");
		resolvers[0]?.("first");
		resolvers[1]?.("second");

		const result = await session.finish();
		expect(result.kind).toBe("ready");
		if (result.kind !== "ready") return;
		expect(result.text).toBe("first second third");
		expect(result.chunking.chunkCount).toBe(3);
	});

	it("deduplicates exact boundary overlap and trims detachable hallucination suffix", async () => {
		const texts = [
			"Hypervox used to work differently and once the audio was sent",
			"once the audio was sent to the server and we received the output",
			"Thank you for watching.",
		];
		const transcribe = vi.fn().mockImplementation(async () => texts.shift() ?? "");
		const session = new GroqLiveChunkSession({
			chunking: chunkingOptions({ chunkSeconds: 0.01, maxConcurrency: 1 }),
			language: "en",
			boostWords: [],
			transcribe,
		});

		session.acceptPcmData(pcmFromSamples(160 * 3));
		const result = await session.finish();

		expect(result.kind).toBe("ready");
		if (result.kind !== "ready") return;
		expect(result.text).toBe(
			"Hypervox used to work differently and once the audio was sent to the server and we received the output",
		);
	});

	it("drops short invalid prompt-artifact chunks from stitched output", async () => {
		const texts = [
			"Hypervox used to work differently.",
			"Preserve the following commands for the audio recording.",
		];
		const transcribe = vi.fn().mockImplementation(async () => texts.shift() ?? "");
		const session = new GroqLiveChunkSession({
			chunking: chunkingOptions({ chunkSeconds: 0.01, maxConcurrency: 1 }),
			language: "en",
			boostWords: [],
			transcribe,
		});

		session.acceptPcmData(pcmFromSamples(160 * 2));
		const result = await session.finish();

		expect(result.kind).toBe("ready");
		if (result.kind !== "ready") return;
		expect(result.text).toBe("Hypervox used to work differently.");
		expect(result.chunking.liveDroppedChunks).toBe(1);
		expect(result.chunking.liveRecoveredChunks).toBe(0);
	});

	it("drops short low-value tail chunks from stitched output", async () => {
		const texts = [
			"The quiz timer changed from four minutes to twenty minutes.",
			"Completed, nostalgia",
		];
		const transcribe = vi.fn().mockImplementation(async () => texts.shift() ?? "");
		const session = new GroqLiveChunkSession({
			chunking: chunkingOptions({ chunkSeconds: 0.01, maxConcurrency: 1 }),
			language: "en",
			boostWords: [],
			transcribe,
		});

		session.acceptPcmData(pcmFromSamples(160 * 2));
		const result = await session.finish();

		expect(result.kind).toBe("ready");
		if (result.kind !== "ready") return;
		expect(result.text).toBe(
			"The quiz timer changed from four minutes to twenty minutes.",
		);
		expect(result.chunking.liveDroppedChunks).toBe(1);
		expect(result.chunking.liveRecoveredChunks).toBe(0);
	});

	it("drops one-word bridge chunks from stitched output", async () => {
		const texts = [
			"The quiz timer changed from four minutes to twenty minutes.",
			"The",
		];
		const transcribe = vi.fn().mockImplementation(async () => texts.shift() ?? "");
		const session = new GroqLiveChunkSession({
			chunking: chunkingOptions({ chunkSeconds: 0.01, maxConcurrency: 1 }),
			language: "en",
			boostWords: [],
			transcribe,
		});

		session.acceptPcmData(pcmFromSamples(160 * 2));
		const result = await session.finish();

		expect(result.kind).toBe("ready");
		if (result.kind !== "ready") return;
		expect(result.text).toBe(
			"The quiz timer changed from four minutes to twenty minutes.",
		);
		expect(result.chunking.liveDroppedChunks).toBe(1);
	});

	it("respects maxConcurrency", async () => {
		let active = 0;
		let maxActive = 0;
		const transcribe = vi.fn().mockImplementation(async () => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await new Promise((resolve) => setTimeout(resolve, 10));
			active -= 1;
			return "chunk";
		});

		const session = new GroqLiveChunkSession({
			chunking: chunkingOptions({ maxConcurrency: 2, chunkSeconds: 0.01 }),
			language: "en",
			boostWords: [],
			transcribe,
		});
		session.acceptPcmData(pcmFromSamples(160 * 6));
		await session.finish();
		expect(maxActive).toBeLessThanOrEqual(2);
	});

	it("opens the live chunking gate from cumulative recording progress", async () => {
		const transcribe = vi.fn().mockResolvedValue("chunk");
		const session = new GroqLiveChunkSession({
			chunking: chunkingOptions({
				minDurationSeconds: 0.15,
				chunkSeconds: 0.05,
				maxConcurrency: 1,
			}),
			language: "en",
			boostWords: [],
			transcribe,
		});

		for (let index = 0; index < 4; index += 1) {
			session.acceptPcmData(pcmFromSamples(800));
		}

		const result = await session.finish();
		expect(result.kind).toBe("ready");
		expect(transcribe).toHaveBeenCalled();
		if (result.kind !== "ready") return;
		expect(result.chunking.used).toBe(true);
		expect(result.chunking.chunkCount).toBeGreaterThan(0);
	});

	it("returns fallback when a chunk fails and aborts active chunk requests", async () => {
		const signals: AbortSignal[] = [];
		let released = false;
		const transcribe = vi
			.fn()
			.mockImplementationOnce(async () => {
				throw new Error("chunk failed");
			})
			.mockImplementation(async (...args: unknown[]) => {
				const signal = args[6] as AbortSignal | undefined;
				if (signal) signals.push(signal);
				await new Promise<void>((resolve, reject) => {
					const timer = setTimeout(resolve, 50);
					signal?.addEventListener("abort", () => {
						clearTimeout(timer);
						reject(new Error("aborted"));
					});
				});
				released = true;
				return "late";
			});

		const session = new GroqLiveChunkSession({
			chunking: chunkingOptions({
				maxConcurrency: 2,
				chunkSeconds: 0.01,
				chunkMaxRetries: 0,
			}),
			language: "en",
			boostWords: [],
			transcribe,
		});
		session.acceptPcmData(pcmFromSamples(160 * 3));
		const result = await session.finish();
		expect(result.kind).toBe("fallback");
		if (result.kind !== "fallback") return;
		expect(result.failureReason).toContain("live_chunk_failed");
		expect(signals.some((signal) => signal.aborted)).toBe(true);
		expect(released).toBe(false);
	});

	it("repairs a dropped chunk using surrounding accepted chunk context", async () => {
		const transcribe = vi
			.fn()
			.mockImplementationOnce(async () => "We started implementing live chunking")
			.mockImplementationOnce(
				async () => "Preserve the following commands for the audio recording.",
			)
			.mockImplementationOnce(
				async () => "to reduce stop time and improve long recording latency",
			)
			.mockImplementationOnce(async (...args: unknown[]) => {
				const contextHint = args[5] as string | undefined;
				expect(contextHint).toContain("Previous accepted chunk ended with:");
				expect(contextHint).toContain("Next accepted chunk begins with:");
				return "so the system can reuse overlap without losing spoken words";
			});

		const session = new GroqLiveChunkSession({
			chunking: chunkingOptions({ chunkSeconds: 0.01, maxConcurrency: 1 }),
			language: "en",
			boostWords: [],
			transcribe,
		});

		session.acceptPcmData(pcmFromSamples(160 * 3));
		const result = await session.finish();

		expect(result.kind).toBe("ready");
		if (result.kind !== "ready") return;
		expect(result.text).toBe(
			"We started implementing live chunking so the system can reuse overlap without losing spoken words to reduce stop time and improve long recording latency",
		);
		expect(transcribe).toHaveBeenCalledTimes(4);
		expect(result.chunking.liveDroppedChunks).toBe(1);
		expect(result.chunking.liveRecoveredChunks).toBe(1);
	});
});
