import { logger } from "../utils/logger";
import {
	createGroqChunkingMetrics,
	getFailureReason,
	type GroqChunkingMetrics,
	type GroqChunkingOptions,
	type GroqSingleFileTranscriber,
} from "./groq-chunking";
import { buildPcm16kMonoWav } from "./wav-chunker";

interface LiveChunkJob {
	index: number;
	startSample: number;
	endSample: number;
	buffer: Buffer;
}

export type GroqLiveChunkFinishResult =
	| { kind: "ready"; text: string; chunking: GroqChunkingMetrics }
	| { kind: "not_used"; chunking: GroqChunkingMetrics }
	| { kind: "fallback"; chunking: GroqChunkingMetrics; failureReason: string };

export interface GroqLiveChunkSessionOptions {
	chunking: GroqChunkingOptions;
	language: string;
	boostWords: string[];
	transcribe: GroqSingleFileTranscriber;
}

export class GroqLiveChunkSession {
	private readonly chunking: GroqChunkingOptions;
	private readonly language: string;
	private readonly boostWords: string[];
	private readonly transcribe: GroqSingleFileTranscriber;
	private readonly chunkSamples: number;
	private readonly overlapSamples: number;
	private readonly stepSamples: number;

	private pcmBuffer = Buffer.alloc(0);
	private totalSamples = 0;
	private nextChunkStartSample = 0;
	private nextChunkIndex = 0;
	private gateOpened = false;
	private stopped = false;
	private activeCount = 0;
	private failedReason: string | null = null;
	private pendingQueue: LiveChunkJob[] = [];
	private chunkTexts = new Map<number, string>();
	private completedCount = 0;
	private preStopCompletedCount = 0;
	private accumulatedRequestMs = 0;
	private liveFinalTailMs = -1;
	private activeControllers = new Set<AbortController>();

	public constructor(options: GroqLiveChunkSessionOptions) {
		this.chunking = options.chunking;
		this.language = options.language;
		this.boostWords = options.boostWords;
		this.transcribe = options.transcribe;
		this.chunkSamples = Math.max(1, Math.round(this.chunking.chunkSeconds * 16000));
		this.overlapSamples = Math.max(
			0,
			Math.round(this.chunking.overlapSeconds * 16000),
		);
		this.stepSamples = this.chunkSamples - this.overlapSamples;
	}

	public acceptPcmData(pcm: Buffer): void {
		if (this.stopped || this.failedReason || pcm.length === 0) return;
		this.pcmBuffer = Buffer.concat([this.pcmBuffer, pcm]);
		this.totalSamples += Math.floor(pcm.length / 2);
		this.maybeOpenGate();
		this.enqueueClosedChunks();
		this.pump();
	}

	public async finish(): Promise<GroqLiveChunkFinishResult> {
		this.stopped = true;
		this.preStopCompletedCount = this.completedCount;
		this.maybeOpenGate();
		if (!this.gateOpened) {
			return { kind: "not_used", chunking: createGroqChunkingMetrics(this.chunking) };
		}

		this.liveFinalTailMs = this.enqueueFinalTail();
		const completedBeforeStop =
			this.pendingQueue.length === 0 && this.activeCount === 0;
		const waitStart = Date.now();
		const settled = await Promise.race([
			this.waitForSettled().then(() => true),
			new Promise<boolean>((resolve) =>
				setTimeout(() => resolve(false), this.chunking.liveFinalizeTimeoutMs),
			),
		]);
		const postStopWaitMs = Date.now() - waitStart;

		if (!settled) {
			const failureReason =
				"live_finalize_timeout: unfinished live chunk requests";
			this.abortActiveRequests();
			return {
				kind: "fallback",
				failureReason,
				chunking: createGroqChunkingMetrics(this.chunking, {
					used: false,
					chunkCount: this.nextChunkIndex,
					fallback: true,
					failureReason,
					liveCompletedBeforeStop: completedBeforeStop,
					livePreStopCompletedChunks: this.preStopCompletedCount,
					livePostStopWaitMs: postStopWaitMs,
					liveFinalizeTimedOut: true,
					liveFinalTailMs: this.liveFinalTailMs,
					liveBackgroundRequestMs: this.accumulatedRequestMs,
				}),
			};
		}

		if (this.failedReason) {
			return {
				kind: "fallback",
				failureReason: this.failedReason,
				chunking: createGroqChunkingMetrics(this.chunking, {
					used: false,
					chunkCount: this.nextChunkIndex,
					fallback: true,
					failureReason: this.failedReason,
					liveCompletedBeforeStop: completedBeforeStop,
					livePreStopCompletedChunks: this.preStopCompletedCount,
					livePostStopWaitMs: postStopWaitMs,
					liveFinalizeTimedOut: false,
					liveFinalTailMs: this.liveFinalTailMs,
					liveBackgroundRequestMs: this.accumulatedRequestMs,
				}),
			};
		}

		const text = [...this.chunkTexts.entries()]
			.sort((a, b) => a[0] - b[0])
			.map((entry) => entry[1].trim())
			.filter((entry) => entry.length > 0)
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();
		return {
			kind: "ready",
			text,
			chunking: createGroqChunkingMetrics(this.chunking, {
				used: true,
				chunkCount: this.chunkTexts.size,
				fallback: false,
				liveCompletedBeforeStop: completedBeforeStop,
				livePreStopCompletedChunks: this.preStopCompletedCount,
				livePostStopWaitMs: postStopWaitMs,
				liveFinalizeTimedOut: false,
				liveFinalTailMs: this.liveFinalTailMs,
				liveBackgroundRequestMs: this.accumulatedRequestMs,
			}),
		};
	}

	private maybeOpenGate(): void {
		if (this.gateOpened) return;
		const minSamples = Math.round(this.chunking.minDurationSeconds * 16000);
		if (this.totalSamples >= minSamples) {
			this.gateOpened = true;
		}
	}

	private enqueueClosedChunks(): void {
		while (this.nextChunkStartSample + this.chunkSamples <= this.totalSamples) {
			const start = this.nextChunkStartSample;
			const end = start + this.chunkSamples;
			const startByte = start * 2;
			const endByte = end * 2;
			const pcmSlice = this.pcmBuffer.subarray(startByte, endByte);
			this.pendingQueue.push({
				index: this.nextChunkIndex++,
				startSample: start,
				endSample: end,
				buffer: buildPcm16kMonoWav(Buffer.from(pcmSlice)),
			});
			this.nextChunkStartSample += this.stepSamples;
			this.compactConsumedPcm();
		}
	}

	private enqueueFinalTail(): number {
		if (this.nextChunkStartSample >= this.totalSamples) return 0;
		const start = this.nextChunkStartSample;
		const end = this.totalSamples;
		const startByte = start * 2;
		const endByte = end * 2;
		const pcmSlice = this.pcmBuffer.subarray(startByte, endByte);
		if (pcmSlice.length < 2) return 0;
		this.pendingQueue.push({
			index: this.nextChunkIndex++,
			startSample: start,
			endSample: end,
			buffer: buildPcm16kMonoWav(Buffer.from(pcmSlice)),
		});
		this.pump();
		return Math.round(((end - start) / 16000) * 1000);
	}

	private pump(): void {
		if (!this.gateOpened || this.failedReason) return;
		while (
			this.activeCount < this.chunking.maxConcurrency &&
			this.pendingQueue.length > 0 &&
			!this.failedReason
		) {
			const job = this.pendingQueue.shift();
			if (!job) return;
			this.activeCount++;
			void this.execute(job).finally(() => {
				this.activeCount--;
				this.pump();
			});
		}
	}

	private async execute(job: LiveChunkJob): Promise<void> {
		const durationMs = Math.round(((job.endSample - job.startSample) / 16000) * 1000);
		for (let attempt = 0; attempt <= this.chunking.chunkMaxRetries; attempt += 1) {
			const start = Date.now();
			const abortController = new AbortController();
			this.activeControllers.add(abortController);
			try {
				const text = await this.transcribe(
					job.buffer,
					this.language,
					this.boostWords,
					"wav",
					durationMs,
					abortController.signal,
				);
				const requestMs = Date.now() - start;
				this.accumulatedRequestMs += requestMs;
				this.completedCount++;
				this.chunkTexts.set(job.index, text);
				if (this.chunking.logChunkTranscripts) {
					logger.info(
						{
							chunkIndex: job.index,
							startSeconds: job.startSample / 16000,
							endSeconds: job.endSample / 16000,
							attempt: attempt + 1,
							requestMs,
							textLength: text.length,
							text,
						},
						"Groq live chunk transcript",
					);
				}
				return;
			} catch (error: unknown) {
				if (abortController.signal.aborted) return;
				if (attempt < this.chunking.chunkMaxRetries) {
					await new Promise((resolve) =>
						setTimeout(resolve, this.chunking.chunkRetryBackoffMs),
					);
					continue;
				}
				this.failedReason = `live_chunk_failed: ${getFailureReason(error)}`;
				this.abortActiveRequests();
				return;
			} finally {
				this.activeControllers.delete(abortController);
			}
		}
	}

	private async waitForSettled(): Promise<void> {
		while (this.pendingQueue.length > 0 || this.activeCount > 0) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}

	private abortActiveRequests(): void {
		this.pendingQueue = [];
		for (const controller of this.activeControllers) {
			controller.abort();
		}
		this.activeControllers.clear();
	}

	private compactConsumedPcm(): void {
		const trimSamples = Math.max(0, this.nextChunkStartSample - this.overlapSamples);
		if (trimSamples <= 0) return;
		const trimBytes = trimSamples * 2;
		if (trimBytes <= 0 || trimBytes >= this.pcmBuffer.length) return;

		this.pcmBuffer = Buffer.from(this.pcmBuffer.subarray(trimBytes));
		this.totalSamples -= trimSamples;
		this.nextChunkStartSample -= trimSamples;
		for (const job of this.pendingQueue) {
			job.startSample -= trimSamples;
			job.endSample -= trimSamples;
		}
	}
}
