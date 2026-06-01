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

	it("returns fallback when a chunk fails and aborts active chunk requests", async () => {
		const signals: AbortSignal[] = [];
		let released = false;
		const transcribe = vi
			.fn()
			.mockImplementationOnce(async () => {
				throw new Error("chunk failed");
			})
			.mockImplementation(async (...args: unknown[]) => {
				const signal = args[5] as AbortSignal | undefined;
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
});
