export type TranscriptQualityReason =
	| "prompt_artifact"
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
	/preserve\s+the\s+defaults\s+of\s+the\s+speaker/i,
	/when\s+the\s+speaker\s+clearly\s+dictates/i,
	/the\s+speaker\s+clearly/i,
	/prefer\s+literal\s+symbols/i,
	/preserve\s+spoken\s+content/i,
	/format\s+as\s+a\s+headed\s+numbered\s+list/i,
	/merge\s+the\s+two\s+transcripts/i,
	/output\s+only\s+the\s+final\s+transcript/i,
];

const DETACHABLE_SUFFIX_PATTERNS = [
	/\s*(?:thank you for watching|thanks for watching)[.!?\s]*$/i,
	/\s*(?:please subscribe|like and subscribe|don't forget to like|hit the bell)[.!?\s]*$/i,
	/\s*if you want to know more about .*? please visit the link in the description[.!?\s]*$/i,
	/\s*please visit the link in the description[.!?\s]*$/i,
];

const NON_LATIN_SCRIPT_PATTERN =
	/[\u0600-\u06FF\u0750-\u077F\u0E00-\u0E7F\u1100-\u11FF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/;
const LATIN_SCRIPT_PATTERN = /\p{Script=Latin}/u;

function hasPromptArtifact(text: string): boolean {
	return PROMPT_ARTIFACT_PATTERNS.some((pattern) => pattern.test(text));
}

function hasMixedScriptGarbage(text: string): boolean {
	return NON_LATIN_SCRIPT_PATTERN.test(text) && LATIN_SCRIPT_PATTERN.test(text);
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
				/(.)\1{3,}/.test(clean))
		);
	});

	return suspiciousWords.length > words.length * 0.3;
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
