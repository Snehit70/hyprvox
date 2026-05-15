import { validateTranscript } from "./quality";

const LONG_RECORDING_DURATION_MS = 90_000;
const LONG_RECORDING_WORDS = 150;
const MERGE_EXPANSION_RATIO = 1.35;
const MERGE_EXPANSION_MIN_EXTRA_CHARS = 120;

export type LongRecordingFallbackSource = "none" | "groq" | "deepgram";

export interface LongRecordingQualityInput {
	recordingDurationMs: number;
	finalText: string;
	groqText: string;
	deepgramText: string;
}

export interface LongRecordingQualityResult {
	isLongRecording: boolean;
	suspiciousMergeExpansion: boolean;
	fallbackSource: LongRecordingFallbackSource;
	fallbackText: string;
}

function countWords(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

function chooseFallbackSource(
	groqText: string,
	deepgramText: string,
): { source: LongRecordingFallbackSource; text: string } {
	const candidates = [
		{
			source: "deepgram" as const,
			validation: validateTranscript(deepgramText),
		},
		{ source: "groq" as const, validation: validateTranscript(groqText) },
	].filter(
		(candidate) => candidate.validation.valid && candidate.validation.text,
	);

	if (candidates.length === 0) return { source: "none", text: "" };

	const fallback = candidates.sort(
		(a, b) => b.validation.text.length - a.validation.text.length,
	)[0];
	if (!fallback) return { source: "none", text: "" };
	return { source: fallback.source, text: fallback.validation.text };
}

export function assessLongRecordingQuality({
	recordingDurationMs,
	finalText,
	groqText,
	deepgramText,
}: LongRecordingQualityInput): LongRecordingQualityResult {
	const longestSourceLength = Math.max(groqText.length, deepgramText.length);
	const isLongRecording =
		recordingDurationMs >= LONG_RECORDING_DURATION_MS ||
		countWords(finalText) >= LONG_RECORDING_WORDS ||
		countWords(groqText) >= LONG_RECORDING_WORDS ||
		countWords(deepgramText) >= LONG_RECORDING_WORDS;
	const suspiciousMergeExpansion =
		isLongRecording &&
		longestSourceLength > 0 &&
		finalText.length - longestSourceLength >= MERGE_EXPANSION_MIN_EXTRA_CHARS &&
		finalText.length / longestSourceLength >= MERGE_EXPANSION_RATIO;
	const fallback = suspiciousMergeExpansion
		? chooseFallbackSource(groqText, deepgramText)
		: { source: "none" as const, text: "" };

	return {
		isLongRecording,
		suspiciousMergeExpansion,
		fallbackSource: fallback.source,
		fallbackText: fallback.text,
	};
}

export {
	LONG_RECORDING_DURATION_MS,
	LONG_RECORDING_WORDS,
	MERGE_EXPANSION_MIN_EXTRA_CHARS,
	MERGE_EXPANSION_RATIO,
};
