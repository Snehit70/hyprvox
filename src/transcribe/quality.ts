export type TranscriptQualityReason =
	| "prompt_artifact"
	| "cot_meta"
	| "token_injection"
	| "hallucination_suffix"
	| "mixed_script"
	| "garbage";

export interface TranscriptQualityResult {
	valid: boolean;
	reasons: TranscriptQualityReason[];
	text: string;
	trimmedSuffix: boolean;
}

const PROMPT_ARTIFACT_PATTERNS = [
	/preserve\s+the\s+following/i,
	/preserve\s+the\s+following\s+(terms|commands|questions)/i,
	/\bpreserve\s+(?:the\s+)?(?:first|second|third|last|\d+(?:st|nd|rd|th)?|whole)\b[^.?!]{0,80}\b(?:terms?|words?|commands?|tasks?|layers?|format|order)\b/i,
	/\bpreserve\s+the\s+(?:minimum|maximum)\b[^.?!]{0,80}\b(?:words?|sentences?|language)\b/i,
	/preserve\s+the\s+defaults\s+of\s+the\s+speaker/i,
	/when\s+the\s+speaker\s+clearly\s+dictates/i,
	/the\s+speaker\s+clearly/i,
	/prefer\s+literal\s+symbols/i,
	/preserve\s+spoken\s+content/i,
	/likely\s+vocabulary\s+includes\s+(?:commands?|file\s+paths?|acronyms?|project\s+names?|code\s+terms?)/i,
	/\bvocabulary:\s*(?:commands?|file\s+paths?|acronyms?|project\s+names?|code\s+terms?)/i,
	/\brecent\s+text:\s+/i,
	/format\s+as\s+a\s+headed\s+numbered\s+list/i,
	/merge\s+the\s+two\s+transcripts/i,
	/output\s+only\s+the\s+final\s+transcript/i,
	/transcript\s+1\b[\s\S]*\btranscript\s+2\b/i,
];

const COT_META_PATTERNS = [
	/<\/?think\b/i,
	// LLM-style meta reasoning: requires both a first-person planning phrase
	// AND a meta-context anchor referring to the user/request/prompt/etc.
	// This avoids flagging ordinary speech like "Let me answer your next five
	// questions" while still catching leaks like "We need to analyze the user
	// request" or "Let me think step by step about the prompt".
	/\b(?:we need to|i need to|i should|let me|let's|first,? (?:i|we)(?:'| a)?m? going to)\s+(?:answer|analyze|reason(?:\s+about)?|think|figure out|address|respond to|handle|approach|consider|examine|interpret|process)\b[^.?!]{0,80}?\b(?:the\s+(?:user(?:'s)?|request|prompt|input|task|instruction|question|transcript|merge|failed\s+output)|what\s+(?:the\s+user|they)|this\s+(?:carefully|methodically|systematically)|step[-\s]by[-\s]step)\b/i,
	/\bthe user (?:wants|asked|is asking|requested)(?:(?:\s*[:,-])|(?:\s+that\b)|(?:\s+me\s+to\b))?/i,
	/\b(?:my|the) (?:reasoning|analysis|thought process)\b/i,
	/\bas an ai(?: language model)?\b/i,
	/\bi(?:'|’)ll provide (?:the )?(?:final )?(?:answer|transcript)\b/i,
];

const TECHNICAL_TOKEN_PATTERN =
	/\b(?:[\w.-]+\.(?:ts|tsx|js|jsx|json|md|yml|yaml|toml|py|rs|go|sh|env|log|mp3|wav|m4a)|(?:bun|npm|pnpm|yarn|git|docker|kubectl|terraform|node)\s+[a-z][\w:-]*|[a-z][\w-]*(?:-audio|-test|-benchmark)[\w.-]*)\b/gi;

const DETACHABLE_SUFFIX_PATTERNS = [
	/\s*(?:thank you for watching|thanks for watching)[.!?\s]*$/i,
	/\s*(?:please subscribe|like and subscribe|don't forget to like|hit the bell)[.!?\s]*$/i,
	/\s*if you want to know more about .*? please visit the link in the description[.!?\s]*$/i,
	/\s*please visit the link in the description[.!?\s]*$/i,
];

const NON_LATIN_SCRIPT_PATTERN =
	/[\u0400-\u04FF\u0600-\u06FF\u0750-\u077F\u0E00-\u0E7F\u1100-\u11FF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/;
const LATIN_SCRIPT_PATTERN = /\p{Script=Latin}/u;
const VOWEL_PATTERN = /[aeiouy]/g;

function hasPromptArtifact(text: string): boolean {
	return PROMPT_ARTIFACT_PATTERNS.some((pattern) => pattern.test(text));
}

function hasCotMetaLeakage(text: string): boolean {
	return COT_META_PATTERNS.some((pattern) => pattern.test(text));
}

function hasInjectedTechnicalTokenBurst(text: string): boolean {
	const matches = [...text.matchAll(TECHNICAL_TOKEN_PATTERN)];
	if (matches.length < 2) return false;

	const words = text.split(/\s+/).filter(Boolean);
	const suspiciousTokenCount = matches.filter((match) =>
		/(?:audio|benchmark|test-audio|\.(?:mp3|wav|m4a)\b)/i.test(match[0]),
	).length;
	const repeatedTechnicalTokens = new Set<string>();
	for (const match of matches) {
		const token = match[0].toLowerCase();
		if (
			matches.filter((candidate) => candidate[0].toLowerCase() === token)
				.length > 1
		) {
			repeatedTechnicalTokens.add(token);
		}
	}

	return (
		(suspiciousTokenCount >= 2 && matches.length >= 3) ||
		(repeatedTechnicalTokens.size > 0 && matches.length >= 4) ||
		(matches.length >= Math.max(6, Math.ceil(words.length * 0.25)) &&
			(suspiciousTokenCount > 0 || repeatedTechnicalTokens.size > 0))
	);
}

function hasMixedScriptGarbage(text: string): boolean {
	return NON_LATIN_SCRIPT_PATTERN.test(text) && LATIN_SCRIPT_PATTERN.test(text);
}

function hasSuspiciousWordShape(clean: string): boolean {
	if (clean.length < 8) return false;

	const vowelMatches = clean.match(VOWEL_PATTERN);
	const vowelCount = vowelMatches ? vowelMatches.length : 0;
	const consonantRuns = clean.match(/[bcdfghjklmnpqrstvwxyz]{5,}/g) ?? [];

	return (
		vowelCount <= 1 ||
		consonantRuns.length > 0 ||
		(vowelCount / clean.length < 0.2 && clean.length >= 10)
	);
}

function isGarbageTranscript(text: string): boolean {
	const words = text.split(/\s+/).filter(Boolean);
	if (words.length === 0) return false;

	const suspiciousWords = words.filter((word) => {
		const clean = word.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
		return (
			clean.length > 3 &&
			(/\d{2,}/.test(clean) ||
				/[a-z]{15,}/.test(clean) ||
				/(.)\1{3,}/.test(clean) ||
				hasSuspiciousWordShape(clean))
		);
	});
	const longestSuspiciousLength = suspiciousWords.reduce((longest, word) => {
		const clean = word.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
		return Math.max(longest, clean.length);
	}, 0);

	return (
		suspiciousWords.length > words.length * 0.3 ||
		(suspiciousWords.length >= 1 && words.length <= 8) ||
		(longestSuspiciousLength >= 10 && words.length <= 20)
	);
}

export function trimHallucinationSuffix(text: string): {
	text: string;
	trimmed: boolean;
} {
	let trimmed = text.trim();
	let didTrim = false;

	for (const pattern of DETACHABLE_SUFFIX_PATTERNS) {
		const next = trimmed.replace(pattern, "").trim();
		if (next !== trimmed && next.length > 0) {
			trimmed = next;
			didTrim = true;
		}
	}

	return { text: trimmed, trimmed: didTrim };
}

export function validateTranscript(text: string): TranscriptQualityResult {
	const reasons: TranscriptQualityReason[] = [];
	const trimmed = trimHallucinationSuffix(text);

	if (trimmed.trimmed) {
		reasons.push("hallucination_suffix");
	}
	if (hasPromptArtifact(trimmed.text)) {
		reasons.push("prompt_artifact");
	}
	if (hasCotMetaLeakage(trimmed.text)) {
		reasons.push("cot_meta");
	}
	if (hasInjectedTechnicalTokenBurst(trimmed.text)) {
		reasons.push("token_injection");
	}
	if (hasMixedScriptGarbage(trimmed.text)) {
		reasons.push("mixed_script");
	}
	if (isGarbageTranscript(trimmed.text)) {
		reasons.push("garbage");
	}

	const blockingReasons = reasons.filter(
		(reason) => reason !== "hallucination_suffix",
	);

	return {
		valid: blockingReasons.length === 0,
		reasons,
		text: trimmed.text,
		trimmedSuffix: trimmed.trimmed,
	};
}
