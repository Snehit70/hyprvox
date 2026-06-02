import { logger } from "../utils/logger";
import {
	createGroqChunkingMetrics,
	getFailureReason,
	type GroqChunkingMetrics,
	type GroqChunkingOptions,
	type GroqSingleFileTranscriber,
} from "./groq-chunking";
import { trimHallucinationSuffix, validateTranscript } from "./quality";
import { buildPcm16kMonoWav } from "./wav-chunker";

interface LiveChunkJob {
	index: number;
	startSample: number;
	endSample: number;
	buffer: Buffer;
}

interface RejectedChunkJob {
	job: LiveChunkJob;
	text: string;
	reasons: string[];
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
	private bufferStartSample = 0;
	private totalRecordedSamples = 0;
	private totalSamples = 0;
	private nextChunkStartSample = 0;
	private nextChunkIndex = 0;
	private gateOpened = false;
	private stopped = false;
	private activeCount = 0;
	private failedReason: string | null = null;
	private pendingQueue: LiveChunkJob[] = [];
	private chunkTexts = new Map<number, string>();
	private rejectedChunks = new Map<number, RejectedChunkJob>();
	private completedCount = 0;
	private preStopCompletedCount = 0;
	private accumulatedRequestMs = 0;
	private liveFinalTailMs = -1;
	private activeControllers = new Set<AbortController>();
	private droppedChunkCount = 0;
	private recoveredChunkCount = 0;

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
		const sampleCount = Math.floor(pcm.length / 2);
		this.pcmBuffer = Buffer.concat([this.pcmBuffer, pcm]);
		this.totalRecordedSamples += sampleCount;
		this.totalSamples += sampleCount;
		this.maybeOpenGate();
		this.enqueueClosedChunks();
		this.pump();
	}

	/**
	 * Abandon the session without finalizing: stop accepting audio, mark it
	 * failed so in-flight retries bail after their backoff, and abort every
	 * outstanding request. Called when the owning recording is cancelled or
	 * torn down so live chunk requests don't keep running after teardown.
	 */
	public cancel(): void {
		this.stopped = true;
		if (!this.failedReason) this.failedReason = "session_cancelled";
		this.abortActiveRequests();
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
			this.failedReason = failureReason;
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
					liveDroppedChunks: this.droppedChunkCount,
					liveRecoveredChunks: this.recoveredChunkCount,
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
					liveDroppedChunks: this.droppedChunkCount,
					liveRecoveredChunks: this.recoveredChunkCount,
				}),
			};
		}

		await this.repairRejectedChunks();

		const text = this.joinChunkTexts(
			[...this.chunkTexts.entries()]
			.sort((a, b) => a[0] - b[0])
			.map((entry) => entry[1]),
		);
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
				liveDroppedChunks: this.droppedChunkCount,
				liveRecoveredChunks: this.recoveredChunkCount,
			}),
		};
	}

	private maybeOpenGate(): void {
		if (this.gateOpened) return;
		const minSamples = Math.round(this.chunking.minDurationSeconds * 16000);
		if (this.totalRecordedSamples >= minSamples) {
			this.gateOpened = true;
		}
	}

	private enqueueClosedChunks(): void {
		while (this.nextChunkStartSample + this.chunkSamples <= this.totalSamples) {
			const start = this.nextChunkStartSample;
			const end = start + this.chunkSamples;
			const absoluteStart = this.bufferStartSample + start;
			const absoluteEnd = this.bufferStartSample + end;
			const startByte = start * 2;
			const endByte = end * 2;
			const pcmSlice = this.pcmBuffer.subarray(startByte, endByte);
			this.pendingQueue.push({
				index: this.nextChunkIndex++,
				startSample: absoluteStart,
				endSample: absoluteEnd,
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
		const absoluteStart = this.bufferStartSample + start;
		const absoluteEnd = this.bufferStartSample + end;
		const startByte = start * 2;
		const endByte = end * 2;
		const pcmSlice = this.pcmBuffer.subarray(startByte, endByte);
		if (pcmSlice.length < 2) return 0;
		this.pendingQueue.push({
			index: this.nextChunkIndex++,
			startSample: absoluteStart,
			endSample: absoluteEnd,
			buffer: buildPcm16kMonoWav(Buffer.from(pcmSlice)),
		});
		this.pump();
		return Math.round(((absoluteEnd - absoluteStart) / 16000) * 1000);
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
					undefined,
					abortController.signal,
				);
				const requestMs = Date.now() - start;
				this.accumulatedRequestMs += requestMs;
				this.completedCount++;
				const cleanedText = trimHallucinationSuffix(text).text;
				this.chunkTexts.set(job.index, cleanedText);
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
				const validation = validateTranscript(cleanedText);
				if (this.shouldDropChunkText(validation.text, validation.reasons)) {
					this.droppedChunkCount++;
					this.rejectedChunks.set(job.index, {
						job,
						text: cleanedText,
						reasons: validation.reasons,
					});
					logger.warn(
						{
							chunkIndex: job.index,
							startSeconds: job.startSample / 16000,
							endSeconds: job.endSample / 16000,
							reasons: validation.reasons,
							textLength: cleanedText.length,
						},
						"Dropping invalid live Groq chunk transcript from stitched output",
					);
					this.chunkTexts.delete(job.index);
					return;
				}
				this.rejectedChunks.delete(job.index);
				return;
			} catch (error: unknown) {
				if (abortController.signal.aborted) return;
				if (attempt < this.chunking.chunkMaxRetries) {
					await new Promise((resolve) =>
						setTimeout(resolve, this.chunking.chunkRetryBackoffMs),
					);
					// The session may have been cancelled or hit a finalize timeout
					// while we slept; don't fire another request into a dead session.
					if (this.failedReason) return;
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

	private async repairRejectedChunks(): Promise<void> {
		if (this.rejectedChunks.size === 0 || this.failedReason) return;

		const rejected = [...this.rejectedChunks.values()].sort(
			(a, b) => a.job.index - b.job.index,
		);
		for (const candidate of rejected) {
			const contextHint = this.buildContextHint(candidate.job.index);
			if (!contextHint) continue;

			const durationMs = Math.round(
				((candidate.job.endSample - candidate.job.startSample) / 16000) * 1000,
			);
			try {
				const text = await this.transcribe(
					candidate.job.buffer,
					this.language,
					this.boostWords,
					"wav",
					durationMs,
					contextHint,
				);
				const cleanedText = trimHallucinationSuffix(text).text;
				const validation = validateTranscript(cleanedText);
				if (this.shouldDropChunkText(validation.text, validation.reasons)) {
					logger.debug(
						{
							chunkIndex: candidate.job.index,
							startSeconds: candidate.job.startSample / 16000,
							endSeconds: candidate.job.endSample / 16000,
							reasons: validation.reasons,
							contextHintLength: contextHint.length,
						},
						"Rejected live Groq chunk remained invalid after contextual repair",
					);
					continue;
				}

				this.chunkTexts.set(candidate.job.index, cleanedText);
				this.rejectedChunks.delete(candidate.job.index);
				this.recoveredChunkCount++;
				logger.info(
					{
						chunkIndex: candidate.job.index,
						startSeconds: candidate.job.startSample / 16000,
						endSeconds: candidate.job.endSample / 16000,
						contextHintLength: contextHint.length,
						originalReasons: candidate.reasons,
						repairedTextLength: cleanedText.length,
					},
					"Recovered dropped live Groq chunk transcript with contextual repair",
				);
			} catch (error: unknown) {
				logger.debug(
					{
						chunkIndex: candidate.job.index,
						startSeconds: candidate.job.startSample / 16000,
						endSeconds: candidate.job.endSample / 16000,
						contextHintLength: contextHint.length,
						error: getFailureReason(error),
					},
					"Contextual live Groq chunk repair failed",
				);
			}
		}
	}

	private compactConsumedPcm(): void {
		const trimSamples = Math.max(0, this.nextChunkStartSample - this.overlapSamples);
		if (trimSamples <= 0) return;
		const trimBytes = trimSamples * 2;
		if (trimBytes <= 0 || trimBytes >= this.pcmBuffer.length) return;

		this.pcmBuffer = Buffer.from(this.pcmBuffer.subarray(trimBytes));
		this.bufferStartSample += trimSamples;
		this.totalSamples -= trimSamples;
		this.nextChunkStartSample -= trimSamples;
	}

	private joinChunkTexts(parts: string[]): string {
		const normalizedParts = parts
			.map((part) => part.trim().replace(/\s+/g, " "))
			.filter((part) => part.length > 0);
		if (normalizedParts.length === 0) return "";

		let joined = normalizedParts[0] ?? "";
		for (let index = 1; index < normalizedParts.length; index += 1) {
			const next = normalizedParts[index];
			if (!next) continue;
			joined = this.appendWithBoundaryOverlap(joined, next);
		}

		return trimHallucinationSuffix(joined).text;
	}

	private buildContextHint(chunkIndex: number): string {
		const accepted = [...this.chunkTexts.entries()].sort((a, b) => a[0] - b[0]);
		let previousText = "";
		let nextText = "";

		for (const [index, text] of accepted) {
			if (index < chunkIndex) {
				previousText = text;
				continue;
			}
			if (index > chunkIndex) {
				nextText = text;
				break;
			}
		}

		const previousTail = this.takeLastWords(previousText, 18);
		const nextHead = this.takeFirstWords(nextText, 18);
		const hintParts = [
			previousTail ? `Previous accepted chunk ended with: ${previousTail}` : "",
			nextHead ? `Next accepted chunk begins with: ${nextHead}` : "",
		].filter(Boolean);

		return hintParts.join(" ");
	}

	private appendWithBoundaryOverlap(previous: string, next: string): string {
		const previousTokens = previous.split(/\s+/);
		const nextTokens = next.split(/\s+/);
		const maxOverlap = Math.min(previousTokens.length, nextTokens.length, 12);

		for (let size = maxOverlap; size >= 3; size -= 1) {
			const previousSuffix = previousTokens
				.slice(previousTokens.length - size)
				.join(" ")
				.toLowerCase();
			const nextPrefix = nextTokens.slice(0, size).join(" ").toLowerCase();
			if (previousSuffix === nextPrefix) {
				const remaining = nextTokens.slice(size).join(" ");
				return remaining.length > 0 ? `${previous} ${remaining}` : previous;
			}
		}

		for (let previousSize = maxOverlap; previousSize >= 4; previousSize -= 1) {
			for (
				let nextSize = Math.min(nextTokens.length, previousSize + 1);
				nextSize >= previousSize;
				nextSize -= 1
			) {
				const previousCanonical = this.toCanonicalBoundaryTokens(
					previousTokens.slice(previousTokens.length - previousSize),
				);
				const nextCanonical = this.toCanonicalBoundaryTokens(
					nextTokens.slice(0, nextSize),
				);
				if (
					previousCanonical.length >= 4 &&
					previousCanonical.join(" ") === nextCanonical.join(" ")
				) {
					const remaining = nextTokens.slice(nextSize).join(" ");
					return remaining.length > 0 ? `${previous} ${remaining}` : previous;
				}
			}
		}

		return `${previous} ${next}`.replace(/\s+/g, " ").trim();
	}

	private toCanonicalBoundaryTokens(tokens: string[]): string[] {
		return tokens
			.map((token) => token.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
			.filter((token) => token.length > 0 && !["a", "an", "the"].includes(token));
	}

	private takeLastWords(text: string, count: number): string {
		const words = text.split(/\s+/).filter(Boolean);
		return words.slice(Math.max(0, words.length - count)).join(" ");
	}

	private takeFirstWords(text: string, count: number): string {
		const words = text.split(/\s+/).filter(Boolean);
		return words.slice(0, count).join(" ");
	}

	private shouldDropChunkText(text: string, reasons: string[]): boolean {
		if (text.length === 0) return true;
		if (this.isLowValueShortChunkText(text)) return true;
		if (reasons.length === 0) return false;
		const blockingReasons = reasons.filter(
			(reason) => reason !== "hallucination_suffix",
		);
		if (blockingReasons.length === 0) return false;
		if (
			blockingReasons.includes("prompt_artifact") ||
			blockingReasons.includes("mixed_script") ||
			blockingReasons.includes("garbage")
		) {
			return true;
		}
		const wordCount = text.split(/\s+/).filter(Boolean).length;
		return wordCount <= 20;
	}

	private isLowValueShortChunkText(text: string): boolean {
		const normalized = text.trim().replace(/\s+/g, " ");
		const words = normalized.split(/\s+/).filter(Boolean);
		if (words.length === 0 || words.length > 3) return false;
		if (
			words.length === 1 &&
			/^(?:a|an|the|and|or|but|so|if|then|that|this|it)$/i.test(words[0] ?? "")
		) {
			return true;
		}
		if (/[./\\_-]/.test(normalized) || /\d/.test(normalized)) return false;
		const lower = normalized.toLowerCase();
		if (/^(?:okay|ok|yes|no|done|thanks?|thank you)[.!?]*$/.test(lower)) {
			return false;
		}
		return /[,;:]/.test(normalized) || words.some((word) => word.length >= 8);
	}
}
