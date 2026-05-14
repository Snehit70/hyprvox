const MAX_DEEPGRAM_KEYTERMS = 100;
const MAX_DEEPGRAM_KEYTERM_TOKENS = 500;
const MAX_DEEPGRAM_KEYTERM_QUERY_CHARS = 1200;

function normalizeBoostWord(word: string): string {
	return word.trim().replace(/\s+/g, " ");
}

export function sanitizeDeepgramKeyterms(boostWords: string[]): string[] {
	const seen = new Set<string>();
	const keyterms: string[] = [];
	let tokenCount = 0;
	let queryChars = 0;

	for (const rawWord of boostWords) {
		const word = normalizeBoostWord(rawWord);
		if (!word) continue;

		const dedupeKey = word.toLowerCase();
		if (seen.has(dedupeKey)) continue;

		const wordTokenCount = word.split(/\s+/).length;
		const wordQueryChars = `keyterm=${encodeURIComponent(word)}`.length;
		const separatorChars = keyterms.length === 0 ? 0 : 1;
		if (tokenCount + wordTokenCount > MAX_DEEPGRAM_KEYTERM_TOKENS) break;
		if (
			queryChars + separatorChars + wordQueryChars >
			MAX_DEEPGRAM_KEYTERM_QUERY_CHARS
		) {
			break;
		}

		seen.add(dedupeKey);
		keyterms.push(word);
		tokenCount += wordTokenCount;
		queryChars += separatorChars + wordQueryChars;

		if (keyterms.length >= MAX_DEEPGRAM_KEYTERMS) {
			break;
		}
	}

	return keyterms;
}

export {
	MAX_DEEPGRAM_KEYTERMS,
	MAX_DEEPGRAM_KEYTERM_QUERY_CHARS,
	MAX_DEEPGRAM_KEYTERM_TOKENS,
};
