import { extractExactTokenHints } from "./merge-prompts";
import { validateTranscript } from "./quality";

const LIVE_GROQ_MIN_REFERENCE_CHARS = 500;
const LIVE_GROQ_MIN_MISSING_CHARS = 180;
const LIVE_GROQ_LENGTH_RATIO = 0.82;
const LIVE_GROQ_WORD_RATIO = 0.8;
const LIVE_GROQ_MAX_EXPANSION_RATIO = 1.3;
const LIVE_GROQ_MAX_EXPANSION_WORD_RATIO = 1.25;
const LIVE_GROQ_MIN_EXTRA_EXPANSION_CHARS = 180;
const LIVE_GROQ_MIN_DIVERGENCE_SCORE = 2;

export type GroqLiveQualityFallbackReason =
	| "none"
	| "live_invalid"
	| "live_materially_shorter_than_deepgram"
	| "live_materially_longer_and_divergent_than_deepgram";

export interface GroqLiveQualityFallbackInput {
	chunkingUsed: boolean;
	fallbackToFullAudio: boolean;
	liveGroqText: string;
	deepgramText: string;
	boostWords?: string[];
}

export interface GroqLiveQualityFallbackDecision {
	shouldFallback: boolean;
	reason: GroqLiveQualityFallbackReason;
}

function countWords(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeForMatch(text: string): string {
	return text.toLowerCase();
}

function containsToken(text: string, token: string): boolean {
	return normalizeForMatch(text).includes(normalizeForMatch(token));
}

function extractRepeatedPhraseCandidates(text: string): string[] {
	const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
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

	return [...repeated];
}

function buildExpectedTokens(
	deepgramText: string,
	boostWords: string[],
): string[] {
	const deepgramExactTokens = extractExactTokenHints(deepgramText);
	const relevantBoostWords = boostWords.filter((token) =>
		containsToken(deepgramText, token),
	);
	const seen = new Set<string>();
	const expectedTokens: string[] = [];

	for (const token of [...relevantBoostWords, ...deepgramExactTokens]) {
		const normalized = normalizeForMatch(token);
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		expectedTokens.push(token);
	}

	return expectedTokens;
}

export function assessGroqLiveQualityFallback({
	chunkingUsed,
	fallbackToFullAudio,
	liveGroqText,
	deepgramText,
	boostWords = [],
}: GroqLiveQualityFallbackInput): GroqLiveQualityFallbackDecision {
	if (!chunkingUsed || !fallbackToFullAudio || !liveGroqText || !deepgramText) {
		return { shouldFallback: false, reason: "none" };
	}

	const liveValidation = validateTranscript(liveGroqText);
	const deepgramValidation = validateTranscript(deepgramText);
	if (!deepgramValidation.valid || !deepgramValidation.text) {
		return { shouldFallback: false, reason: "none" };
	}
	if (!liveValidation.valid) {
		return { shouldFallback: true, reason: "live_invalid" };
	}

	const liveLength = liveValidation.text.length;
	const deepgramLength = deepgramValidation.text.length;
	if (deepgramLength < LIVE_GROQ_MIN_REFERENCE_CHARS) {
		return { shouldFallback: false, reason: "none" };
	}

	const missingChars = deepgramLength - liveLength;
	const liveWordCount = countWords(liveValidation.text);
	const deepgramWordCount = countWords(deepgramValidation.text);
	const lengthRatio = liveLength / deepgramLength;
	const wordRatio =
		deepgramWordCount > 0 ? liveWordCount / deepgramWordCount : 1;

	if (
		missingChars >= LIVE_GROQ_MIN_MISSING_CHARS &&
		(lengthRatio < LIVE_GROQ_LENGTH_RATIO ||
			wordRatio < LIVE_GROQ_WORD_RATIO)
	) {
		return {
			shouldFallback: true,
			reason: "live_materially_shorter_than_deepgram",
		};
	}

	const extraChars = liveLength - deepgramLength;
	if (
		extraChars >= LIVE_GROQ_MIN_EXTRA_EXPANSION_CHARS &&
		(lengthRatio >= LIVE_GROQ_MAX_EXPANSION_RATIO ||
			wordRatio >= LIVE_GROQ_MAX_EXPANSION_WORD_RATIO)
	) {
		const repeatedPhraseCount = extractRepeatedPhraseCandidates(
			liveValidation.text,
		).length;
		const expectedTokens = buildExpectedTokens(
			deepgramValidation.text,
			boostWords,
		);
		const exactTokenDisagreements = expectedTokens.filter(
			(token) => !containsToken(liveValidation.text, token),
		).length;
		const divergenceScore =
			(exactTokenDisagreements > 0 ? 2 : 0) +
			(repeatedPhraseCount >= 3 ? 1 : 0);

		if (divergenceScore >= LIVE_GROQ_MIN_DIVERGENCE_SCORE) {
			return {
				shouldFallback: true,
				reason: "live_materially_longer_and_divergent_than_deepgram",
			};
		}
	}

	return { shouldFallback: false, reason: "none" };
}

export {
	LIVE_GROQ_LENGTH_RATIO,
	LIVE_GROQ_MIN_MISSING_CHARS,
	LIVE_GROQ_MIN_REFERENCE_CHARS,
	LIVE_GROQ_WORD_RATIO,
	LIVE_GROQ_MAX_EXPANSION_RATIO,
	LIVE_GROQ_MAX_EXPANSION_WORD_RATIO,
	LIVE_GROQ_MIN_EXTRA_EXPANSION_CHARS,
};
