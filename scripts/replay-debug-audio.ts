import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { distance as levenshteinDistance } from "fastest-levenshtein";
import { PcmStreamExtractor } from "../src/audio/pcm-stream";
import { loadConfig } from "../src/config/loader";
import type { GroqChunkingOptions } from "../src/transcribe/groq-chunking";
import { GroqLiveChunkSession } from "../src/transcribe/groq-live-chunking";
import {
	assessGroqLiveQualityFallback,
	type GroqLiveQualityFallbackReason,
} from "../src/transcribe/groq-live-quality";
import { GroqClient } from "../src/transcribe/groq";
import { DeepgramTranscriber } from "../src/transcribe/deepgram";
import { TranscriptMerger, type MergeResult } from "../src/transcribe/merger";
import { recoverTranscriptQuality } from "../src/transcribe/recovery";
import { assessLongRecordingQuality } from "../src/transcribe/long-recording";
import { validateTranscript } from "../src/transcribe/quality";

interface ReplayRunResult {
	run: number;
	liveStatus: "ready" | "fallback";
	liveFailureReason: string | null;
	liveGroq: string;
	fullGroq: string;
	deepgram: string;
	finalText: string;
	groqForMergeSource: "liveGroq" | "fullGroq";
	liveQualityFallbackReason: GroqLiveQualityFallbackReason;
	mergeStrategy: string;
	mergeReason: string | null;
	validationReasons: string[];
	chunkCount: number;
	groqChunkingUsed: boolean;
}

interface TextDiffSummary {
	left: string;
	right: string;
	editDistance: number;
	normalizedDistance: number;
	leftLength: number;
	rightLength: number;
}

interface CandidateIssueSummary {
	label: string;
	validationReasons: string[];
	trimmedSuffix: boolean;
	repeatedPhraseCandidates: string[];
	hasPromptArtifact: boolean;
	hasMixedScript: boolean;
	looksSuspiciouslyShort: boolean;
	wordCount: number;
	lengthRatioToLongest: number;
	likelyMissingContent: boolean;
}

interface RunVerdictSummary {
	finalBeatsLiveGroq: boolean;
	finalBeatsFullGroq: boolean;
	liveGroqBeatsFullGroq: boolean;
}

interface ReplayRunReport {
	run: number;
	liveStatus: "ready" | "fallback";
	liveFailureReason: string | null;
	chunkingUsed: boolean;
	chunkCount: number;
	groqForMergeSource: "liveGroq" | "fullGroq";
	liveQualityFallbackReason: GroqLiveQualityFallbackReason;
	mergeStrategy: string;
	validationReasons: string[];
	textLengths: {
		liveGroq: number;
		fullGroq: number;
		deepgram: number;
		finalText: number;
	};
	issues: CandidateIssueSummary[];
	verdicts: RunVerdictSummary;
	diffs: TextDiffSummary[];
}

interface SourceIssueAggregate {
	validationReasonCounts: Record<string, number>;
	trimmedSuffixCount: number;
	promptArtifactCount: number;
	mixedScriptCount: number;
	shortTextCount: number;
	likelyMissingContentCount: number;
}

interface ReplaySummaryReport {
	runs: number;
	chunkingUsedRuns: number;
	liveFallbackRuns: number;
	averageChunkCount: number;
	mergeStrategies: Record<string, number>;
	averageNormalizedDistances: Record<string, number>;
	sourceIssues: Record<string, SourceIssueAggregate>;
	verdictCounts: {
		finalBeatsLiveGroq: number;
		finalBeatsFullGroq: number;
		liveGroqBeatsFullGroq: number;
	};
	liveQualityFallbackRuns: number;
}

function normalizeForDiff(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function countWords(text: string): number {
	return normalizeForDiff(text).split(/\s+/).filter(Boolean).length;
}

function extractRepeatedPhraseCandidates(text: string): string[] {
	const normalized = normalizeForDiff(text).toLowerCase();
	const words = normalized.split(/\s+/).filter(Boolean);
	const seen = new Set<string>();
	const repeated = new Set<string>();

	for (let size = 3; size <= 6; size += 1) {
		for (let index = 0; index + size <= words.length; index += 1) {
			const phrase = words.slice(index, index + size).join(" ");
			if (seen.has(phrase)) {
				repeated.add(phrase);
			} else {
				seen.add(phrase);
			}
		}
	}

	return [...repeated].slice(0, 5);
}

function summarizeCandidateIssues(
	label: string,
	text: string,
	longestReferenceLength: number,
): CandidateIssueSummary {
	const validation = validateTranscript(text);
	const wordCount = countWords(validation.text);
	const lengthRatioToLongest =
		longestReferenceLength > 0
			? Number((validation.text.length / longestReferenceLength).toFixed(4))
			: 1;
	return {
		label,
		validationReasons: validation.reasons,
		trimmedSuffix: validation.trimmedSuffix,
		repeatedPhraseCandidates: extractRepeatedPhraseCandidates(validation.text),
		hasPromptArtifact: validation.reasons.includes("prompt_artifact"),
		hasMixedScript: validation.reasons.includes("mixed_script"),
		looksSuspiciouslyShort: wordCount > 0 && wordCount < 12,
		wordCount,
		lengthRatioToLongest,
		likelyMissingContent:
			longestReferenceLength > 0 &&
			validation.text.length > 0 &&
			validation.text.length < longestReferenceLength * 0.7,
	};
}

function compareIssueSeverity(a: CandidateIssueSummary, b: CandidateIssueSummary): number {
	const score = (summary: CandidateIssueSummary) =>
		summary.validationReasons.length * 10 +
		(summary.trimmedSuffix ? 2 : 0) +
		summary.repeatedPhraseCandidates.length * 2 +
		(summary.looksSuspiciouslyShort ? 1 : 0) +
		(summary.likelyMissingContent ? 6 : 0);
	return score(a) - score(b);
}

function buildRunVerdicts(
	liveGroqIssues: CandidateIssueSummary,
	fullGroqIssues: CandidateIssueSummary,
	finalIssues: CandidateIssueSummary,
): RunVerdictSummary {
	return {
		finalBeatsLiveGroq: compareIssueSeverity(finalIssues, liveGroqIssues) < 0,
		finalBeatsFullGroq: compareIssueSeverity(finalIssues, fullGroqIssues) < 0,
		liveGroqBeatsFullGroq: compareIssueSeverity(liveGroqIssues, fullGroqIssues) < 0,
	};
}

function summarizeDiff(leftLabel: string, rightLabel: string, left: string, right: string): TextDiffSummary {
	const normalizedLeft = normalizeForDiff(left);
	const normalizedRight = normalizeForDiff(right);
	const editDistance = levenshteinDistance(normalizedLeft, normalizedRight);
	const maxLength = Math.max(normalizedLeft.length, normalizedRight.length, 1);
	return {
		left: leftLabel,
		right: rightLabel,
		editDistance,
		normalizedDistance: Number((editDistance / maxLength).toFixed(4)),
		leftLength: normalizedLeft.length,
		rightLength: normalizedRight.length,
	};
}

function buildRunReport(result: ReplayRunResult): ReplayRunReport {
	const longestReferenceLength = Math.max(
		result.liveGroq.length,
		result.fullGroq.length,
		result.deepgram.length,
		result.finalText.length,
	);
	const issues = [
		summarizeCandidateIssues("liveGroq", result.liveGroq, longestReferenceLength),
		summarizeCandidateIssues("fullGroq", result.fullGroq, longestReferenceLength),
		summarizeCandidateIssues("deepgram", result.deepgram, longestReferenceLength),
		summarizeCandidateIssues("finalText", result.finalText, longestReferenceLength),
	];
	const liveGroqIssues = issues.find((issue) => issue.label === "liveGroq");
	const fullGroqIssues = issues.find((issue) => issue.label === "fullGroq");
	const finalIssues = issues.find((issue) => issue.label === "finalText");
	if (!liveGroqIssues || !fullGroqIssues || !finalIssues) {
		throw new Error("Replay issue summary incomplete");
	}

	return {
		run: result.run,
		liveStatus: result.liveStatus,
		liveFailureReason: result.liveFailureReason,
		chunkingUsed: result.groqChunkingUsed,
		chunkCount: result.chunkCount,
		groqForMergeSource: result.groqForMergeSource,
		liveQualityFallbackReason: result.liveQualityFallbackReason,
		mergeStrategy: result.mergeStrategy,
		validationReasons: result.validationReasons,
		textLengths: {
			liveGroq: result.liveGroq.length,
			fullGroq: result.fullGroq.length,
			deepgram: result.deepgram.length,
			finalText: result.finalText.length,
		},
		issues,
		verdicts: buildRunVerdicts(liveGroqIssues, fullGroqIssues, finalIssues),
		diffs: [
			summarizeDiff("liveGroq", "fullGroq", result.liveGroq, result.fullGroq),
			summarizeDiff("liveGroq", "deepgram", result.liveGroq, result.deepgram),
			summarizeDiff("finalText", "deepgram", result.finalText, result.deepgram),
			summarizeDiff("finalText", "liveGroq", result.finalText, result.liveGroq),
			summarizeDiff("finalText", "fullGroq", result.finalText, result.fullGroq),
		],
	};
}

function buildSummaryReport(results: ReplayRunResult[]): ReplaySummaryReport {
	const mergeStrategies: Record<string, number> = {};
	const distanceBuckets: Record<string, number[]> = {};
	const sourceIssues: Record<string, SourceIssueAggregate> = {};
	const verdictCounts = {
		finalBeatsLiveGroq: 0,
		finalBeatsFullGroq: 0,
		liveGroqBeatsFullGroq: 0,
	};
	let liveQualityFallbackRuns = 0;

	for (const result of results) {
		mergeStrategies[result.mergeStrategy] =
			(mergeStrategies[result.mergeStrategy] ?? 0) + 1;
		const runReport = buildRunReport(result);
		for (const diff of runReport.diffs) {
			const key = `${diff.left}->${diff.right}`;
			distanceBuckets[key] ??= [];
			distanceBuckets[key].push(diff.normalizedDistance);
		}
		for (const issue of runReport.issues) {
			sourceIssues[issue.label] ??= {
				validationReasonCounts: {},
				trimmedSuffixCount: 0,
				promptArtifactCount: 0,
				mixedScriptCount: 0,
				shortTextCount: 0,
				likelyMissingContentCount: 0,
			};
			const aggregate = sourceIssues[issue.label];
			if (!aggregate) continue;
			for (const reason of issue.validationReasons) {
				aggregate.validationReasonCounts[reason] =
					(aggregate.validationReasonCounts[reason] ?? 0) + 1;
			}
			if (issue.trimmedSuffix) aggregate.trimmedSuffixCount += 1;
			if (issue.hasPromptArtifact) aggregate.promptArtifactCount += 1;
			if (issue.hasMixedScript) aggregate.mixedScriptCount += 1;
			if (issue.looksSuspiciouslyShort) aggregate.shortTextCount += 1;
			if (issue.likelyMissingContent) {
				aggregate.likelyMissingContentCount += 1;
			}
		}
		if (runReport.verdicts.finalBeatsLiveGroq) {
			verdictCounts.finalBeatsLiveGroq += 1;
		}
		if (runReport.verdicts.finalBeatsFullGroq) {
			verdictCounts.finalBeatsFullGroq += 1;
		}
		if (runReport.verdicts.liveGroqBeatsFullGroq) {
			verdictCounts.liveGroqBeatsFullGroq += 1;
		}
		if (result.groqForMergeSource === "fullGroq") {
			liveQualityFallbackRuns += 1;
		}
	}

	const averageNormalizedDistances = Object.fromEntries(
		Object.entries(distanceBuckets).map(([key, values]) => [
			key,
			Number(
				(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4),
			),
		]),
	);

	return {
		runs: results.length,
		chunkingUsedRuns: results.filter((result) => result.groqChunkingUsed).length,
		liveFallbackRuns: results.filter((result) => result.liveStatus === "fallback")
			.length,
		averageChunkCount: Number(
			(
				results.reduce((sum, result) => sum + result.chunkCount, 0) /
				Math.max(results.length, 1)
			).toFixed(2),
		),
		mergeStrategies,
		averageNormalizedDistances,
		sourceIssues,
		verdictCounts,
		liveQualityFallbackRuns,
	};
}

function getRecordingDurationMs(buffer: Buffer): number {
	if (buffer.length < 44) {
		throw new Error("WAV is too short to contain a header");
	}
	const dataBytes = buffer.length - 44;
	return Math.round((dataBytes / 2 / 16000) * 1000);
}

function buildReplayChunkingOptions(
	chunking: GroqChunkingOptions,
	recordingDurationMs: number,
): GroqChunkingOptions {
	const estimatedChunks = Math.max(
		1,
		Math.ceil(recordingDurationMs / Math.max(chunking.chunkSeconds * 1000, 1)),
	);
	const replayFinalizeTimeoutMs = Math.max(
		chunking.liveFinalizeTimeoutMs,
		Math.min(30000, estimatedChunks * 2500),
	);

	return {
		...chunking,
		liveFinalizeTimeoutMs: replayFinalizeTimeoutMs,
	};
}

function extractPcm(buffer: Buffer): Buffer {
	const extractor = new PcmStreamExtractor();
	const chunk = extractor.accept(buffer);
	if (!chunk) {
		throw new Error("Failed to extract PCM from WAV");
	}
	return chunk.pcm;
}

async function buildMergedResult(
	merger: TranscriptMerger,
	recordingDurationMs: number,
	liveGroq: string,
	deepgram: string,
): Promise<{
	mergeResult: MergeResult;
	finalText: string;
	validationReasons: string[];
}> {
	const mergeResult = await merger.merge(liveGroq, deepgram);
	const recovery = await recoverTranscriptQuality({
		finalText: mergeResult.text,
		groqText: liveGroq,
		deepgramText: deepgram,
		mergeStrategy: mergeResult.strategy,
		mergeReason: mergeResult.reason,
		accuracy: mergeResult.accuracy,
		repairMerge: (groq, dg, failed, reasons) =>
			merger.repairMerge(groq, dg, failed, reasons),
	});

	let finalText = recovery.finalText;
	let validation = recovery.validation;
	const longRecording = assessLongRecordingQuality({
		recordingDurationMs,
		finalText,
		groqText: liveGroq,
		deepgramText: deepgram,
	});

	if (longRecording.suspiciousMergeExpansion && longRecording.fallbackText) {
		finalText = longRecording.fallbackText;
		validation = validateTranscript(finalText);
		finalText = validation.text;
	}

	return {
		mergeResult,
		finalText,
		validationReasons: validation.reasons,
	};
}

async function runReplay(
	filePath: string,
	run: number,
): Promise<ReplayRunResult> {
	const config = loadConfig();
	const groq = new GroqClient();
	const deepgram = new DeepgramTranscriber();
	const merger = new TranscriptMerger();
	merger.setContextLexicon(config.transcription.boostWords ?? []);

	const wav = readFileSync(filePath);
	const recordingDurationMs = getRecordingDurationMs(wav);
	const pcm = extractPcm(wav);
	const replayChunking = buildReplayChunkingOptions(
		config.transcription.groqChunking,
		recordingDurationMs,
	);
	const session = new GroqLiveChunkSession({
		chunking: replayChunking,
		language: config.transcription.language,
		boostWords: config.transcription.boostWords ?? [],
		transcribe: (
			audioBuffer,
			language,
			boostWords,
			format,
			durationMs,
			contextHint,
			signal,
		) =>
			groq.transcribe(
				audioBuffer,
				language,
				boostWords,
				format,
				durationMs,
				contextHint,
				signal,
			),
	});

	const frameBytes = 3200;
	for (let offset = 0; offset < pcm.length; offset += frameBytes) {
		session.acceptPcmData(
			Buffer.from(pcm.subarray(offset, Math.min(pcm.length, offset + frameBytes))),
		);
	}

	const [liveResult, fullGroq, deepgramText] = await Promise.all([
		session.finish(),
		groq.transcribe(
			wav,
			config.transcription.language,
			config.transcription.boostWords ?? [],
			"wav",
			recordingDurationMs,
		),
		deepgram.transcribe(
			wav,
			config.transcription.language,
			config.transcription.deepgramBoosting
				? (config.transcription.boostWords ?? [])
				: [],
			"wav",
		),
	]);

	const liveGroq = liveResult.kind === "ready" ? liveResult.text : "";
	const liveStatus = liveResult.kind === "ready" ? "ready" : "fallback";
	const liveFailureReason =
		liveResult.kind === "fallback" ? liveResult.failureReason : null;
	const qualityFallback = assessGroqLiveQualityFallback({
		chunkingUsed: liveResult.chunking.used,
		fallbackToFullAudio: config.transcription.groqChunking.fallbackToFullAudio,
		liveGroqText: liveGroq,
		deepgramText,
		boostWords: config.transcription.boostWords ?? [],
	});
	const groqForMergeSource = qualityFallback.shouldFallback
		? ("fullGroq" as const)
		: ("liveGroq" as const);
	const groqForMerge =
		groqForMergeSource === "fullGroq" ? fullGroq : liveGroq;

	const merged = await buildMergedResult(
		merger,
		recordingDurationMs,
		groqForMerge,
		deepgramText,
	);

	return {
		run,
		liveStatus,
		liveFailureReason,
		liveGroq,
		fullGroq,
		deepgram: deepgramText,
		finalText: merged.finalText,
		groqForMergeSource,
		liveQualityFallbackReason: qualityFallback.reason,
		mergeStrategy: merged.mergeResult.strategy,
		mergeReason: merged.mergeResult.reason,
		validationReasons: merged.validationReasons,
		chunkCount: liveResult.chunking.chunkCount,
		groqChunkingUsed: liveResult.chunking.used,
	};
}

async function main(): Promise<void> {
	const inputPath = process.argv[2];
	const runsArg = process.argv[3];
	if (!inputPath) {
		throw new Error("Usage: bun run scripts/replay-debug-audio.ts <wav-path> [runs]");
	}

	const filePath = resolve(inputPath);
	const runs = Math.max(1, Number.parseInt(runsArg ?? "2", 10) || 2);
	const results: ReplayRunResult[] = [];

	for (let run = 1; run <= runs; run += 1) {
		results.push(await runReplay(filePath, run));
	}

	console.log(
		JSON.stringify(
			{
				file: basename(filePath),
				runs,
				report: {
					summary: buildSummaryReport(results),
					runs: results.map(buildRunReport),
				},
				results,
			},
			null,
			2,
		),
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
