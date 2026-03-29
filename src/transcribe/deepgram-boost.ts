const MAX_DEEPGRAM_KEYTERMS = 100;

function normalizeBoostWord(word: string): string {
	return word.trim().replace(/\s+/g, " ");
}

export function sanitizeDeepgramKeyterms(boostWords: string[]): string[] {
	const seen = new Set<string>();
	const keyterms: string[] = [];

	for (const rawWord of boostWords) {
		const word = normalizeBoostWord(rawWord);
		if (!word) continue;

		const dedupeKey = word.toLowerCase();
		if (seen.has(dedupeKey)) continue;

		seen.add(dedupeKey);
		keyterms.push(word);

		if (keyterms.length >= MAX_DEEPGRAM_KEYTERMS) {
			break;
		}
	}

	return keyterms;
}

export { MAX_DEEPGRAM_KEYTERMS };
