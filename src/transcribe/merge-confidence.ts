import { distance as levenshteinDistance } from "fastest-levenshtein";

export interface MergeAccuracy {
	sourcesMatch: boolean;
	editDistance: number;
	confidence: number;
}

export function calculateMergeAccuracy(
	finalText: string,
	groqText: string,
	deepgramText: string,
	sourcesMatch = groqText.trim() === deepgramText.trim(),
): MergeAccuracy {
	const distToGroq = levenshteinDistance(finalText, groqText);
	const distToDeepgram = levenshteinDistance(finalText, deepgramText);
	const maxDistGroq = Math.max(finalText.length, groqText.length) || 1;
	const maxDistDeepgram = Math.max(finalText.length, deepgramText.length) || 1;
	const normalizedDistGroq = distToGroq / maxDistGroq;
	const normalizedDistDeepgram = distToDeepgram / maxDistDeepgram;
	const confidence = Math.max(
		0,
		Math.min(1, 1 - (normalizedDistGroq + normalizedDistDeepgram) / 2),
	);

	return {
		sourcesMatch,
		editDistance: Math.round(
			(normalizedDistGroq + normalizedDistDeepgram) * 50,
		),
		confidence: Math.round(confidence * 100) / 100,
	};
}
