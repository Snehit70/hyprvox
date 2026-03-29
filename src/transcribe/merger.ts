import { distance as levenshteinDistance } from "fastest-levenshtein";
import Groq from "groq-sdk";
import { loadConfig } from "../config/loader";
import { logError, logger } from "../utils/logger";
import { withRetry } from "../utils/retry";

const SYSTEM_PROMPT = `You are an expert technical transcription editor.

CONTEXT: This is audio from a software developer discussing programming, Linux systems, development tools, and AI systems. Expect technical jargon, project names, command-line references, and occasional dictated structured text.

Source A (Groq Whisper): Accurate words, technical terms, proper nouns.
Source B (Deepgram Nova): Good formatting, punctuation, casing.

EXAMPLES:
- If Source A says "github" and Source B says "get hub", choose "GitHub"
- If Source A says "convex" and Source B says "con next", choose "Convex"
- If Source A says "hyprland" and Source B says "high per land", choose "Hyprland"
- If Source A says "waybar" and Source B says "Vbar", choose "Waybar"
- If Source A says "systemd" and Source B says "system d", choose "systemd"
- If Source A says "antigravity" and Source B says "anti gravity", choose "antigravity"
- If the speaker says "the first issue is config, the second issue is auth", format it as a numbered list
- If the speaker dictates "open curly bracket foo colon bar close curly bracket", output "{ foo: bar }" or the closest faithful structured form
- If the speaker dictates a fragment like "1 open curly bracket", preserve the fragment literally rather than rewriting it as prose

RULES:
1. Trust Source A for: proper nouns, project names, technical terms, acronyms.
2. Trust Source B for: punctuation, capitalization, number formatting.
3. Preserve technical accuracy over grammatical perfection.
4. When the speaker clearly dictates structure, prefer structured output over plain prose.
5. Convert spoken symbol cues to literal characters when the intent is clearly structural: braces, brackets, parentheses, colon, comma, quotes, slash, backslash, equals, arrow, newline.
6. When the speaker enumerates items with cues like "first", "second", "third", or "step one", format them as a numbered list when that improves readability.
7. Preserve code, shell commands, file paths, flags, JSON-like fragments, and short dictated snippets exactly. Do not paraphrase or "complete" them.
8. Detect questions and end them with "?" when the utterance is clearly interrogative.
9. Remove hallucinations, filler words, false starts, self-corrections, and pronunciation or spelling meta-commentary.
10. Output ONLY the merged text, no quotes or preamble.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MergeStrategy =
	| "exact_match"
	| "single_source"
	| "normalized_match"
	| "formatting_only"
	| "minor_diff"
	| "single_word_match"
	| "llm"
	| "llm_fallback"
	| "empty";

export type MergeReason =
	| "both_empty"
	| "groq_only"
	| "deepgram_only"
	| "structured_formatting_cues"
	| "exact_text_match"
	| "case_whitespace_match"
	| "punctuation_stripped_match"
	| "diff_below_threshold"
	| "diff_above_threshold"
	| "single_word_close_match"
	| "llm_succeeded"
	| "llm_error_fallback";

export interface MergeResult {
	text: string;
	strategy: MergeStrategy;
	reason: MergeReason;
	accuracy: {
		sourcesMatch: boolean;
		editDistance: number;
		confidence: number;
	};
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/**
 * Collapse all whitespace to single spaces and trim.
 */
function normalizeWhitespace(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

/**
 * Lowercase + collapse whitespace. Used for case/whitespace comparison.
 */
function normalizeCaseWhitespace(s: string): string {
	return normalizeWhitespace(s).toLowerCase();
}

/**
 * Remove all punctuation characters, lowercase, collapse whitespace.
 * Used for punctuation-only difference detection.
 */
function normalizePunctuation(s: string): string {
	// Remove decorative punctuation only; preserve code/math operators
	// (<, >, =, |, &, *, +, ^, ~) which are semantically meaningful
	// in technical speech transcriptions.
	return s
		.replace(/[.,!?;:'"()[\]{}\-–—/\\@#$%]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

// ---------------------------------------------------------------------------
// Gating constants
//
// MINOR_DIFF_THRESHOLD: maximum normalised Levenshtein distance (0–1) below
// which we consider the transcripts "close enough" to skip the LLM.
// Derived from stats: sources agree only 0.5% of the time, so the threshold
// must be conservative. 0.12 (≈12% character-level divergence) catches
// things like trailing punctuation variants or a single word difference on
// short utterances while keeping semantic disagreements for the LLM.
// ---------------------------------------------------------------------------
const MINOR_DIFF_THRESHOLD = 0.12;

// SINGLE_WORD_THRESHOLD: allow a conservative fast-path for longer single-word
// technical terms when the sources are extremely close. This is intentionally
// tighter than the previous experiment to avoid mistakes on everyday words.
const SINGLE_WORD_THRESHOLD = 0.2;
const SINGLE_WORD_MIN_LENGTH = 6;
const SINGLE_WORD_SHARED_EDGE_CHARS = 4;
const ORDINAL_ENUMERATION_PATTERN =
	/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/g;
const NUMBERED_ENUMERATION_PATTERN =
	/\b(step|item|point|issue|reason|problem|question|task|change|fix)\s+(one|two|three|four|five|first|second|third|fourth|fifth)\b/g;
const LITERAL_SYMBOL_PATTERNS = [
	/\bopen\s+(?:curly\s+)?(?:brace|bracket)\b/i,
	/\bclose\s+(?:curly\s+)?(?:brace|bracket)\b/i,
	/\bopen\s+(?:square\s+)?bracket\b/i,
	/\bclose\s+(?:square\s+)?bracket\b/i,
	/\bopen\s+(?:paren|parenthesis)\b/i,
	/\bclose\s+(?:paren|parenthesis)\b/i,
	/\b(?:double|single)\s+quote\b/i,
	/\bopen\s+quote\b/i,
	/\bclose\s+quote\b/i,
	/\bcolon\b/i,
	/\bcomma\b/i,
	/\bsemicolon\b/i,
	/\bbackslash\b/i,
	/\bslash\b/i,
	/\bunderscore\b/i,
	/\bequals\b/i,
	/\barrow\b/i,
	/\bnew\s*line\b/i,
];

function countMatches(pattern: RegExp, text: string): number {
	return text.match(pattern)?.length ?? 0;
}

function hasEnumerationCue(text: string): boolean {
	const normalized = normalizeCaseWhitespace(text);
	return (
		countMatches(ORDINAL_ENUMERATION_PATTERN, normalized) >= 2 ||
		countMatches(NUMBERED_ENUMERATION_PATTERN, normalized) >= 2
	);
}

function hasLiteralSymbolCue(text: string): boolean {
	return LITERAL_SYMBOL_PATTERNS.some((pattern) => pattern.test(text));
}

export function hasStructuredFormattingIntent(...texts: string[]): boolean {
	return texts.some(
		(text) => hasEnumerationCue(text) || hasLiteralSymbolCue(text),
	);
}

function commonPrefixLength(a: string, b: string): number {
	const limit = Math.min(a.length, b.length);
	let i = 0;
	while (i < limit && a[i] === b[i]) {
		i++;
	}
	return i;
}

function commonSuffixLength(a: string, b: string): number {
	const limit = Math.min(a.length, b.length);
	let i = 0;
	while (i < limit && a[a.length - 1 - i] === b[b.length - 1 - i]) {
		i++;
	}
	return i;
}

function isConservativeSingleWordMatch(
	groqText: string,
	deepgramText: string,
	normDist: number,
): boolean {
	const groqNormalized = normalizeCaseWhitespace(groqText);
	const deepgramNormalized = normalizeCaseWhitespace(deepgramText);
	const minLen = Math.min(groqNormalized.length, deepgramNormalized.length);

	if (minLen < SINGLE_WORD_MIN_LENGTH || normDist >= SINGLE_WORD_THRESHOLD) {
		return false;
	}

	const sharedPrefix = commonPrefixLength(groqNormalized, deepgramNormalized);
	const sharedSuffix = commonSuffixLength(groqNormalized, deepgramNormalized);

	return (
		sharedPrefix >= SINGLE_WORD_SHARED_EDGE_CHARS ||
		sharedSuffix >= SINGLE_WORD_SHARED_EDGE_CHARS
	);
}

// ---------------------------------------------------------------------------
// Deterministic merge decision
// ---------------------------------------------------------------------------

export interface GateDecision {
	strategy: MergeStrategy;
	reason: MergeReason;
	/** text to return immediately; undefined means "proceed to LLM" */
	text?: string;
}

/**
 * Pure deterministic function that decides how to merge two non-empty
 * transcripts without calling an LLM.
 *
 * Exported for unit testing.
 *
 * Returns `text` when a local decision is safe. Returns `text: undefined`
 * when the LLM must be called.
 *
 * Strategies in priority order:
 * 1. exact_match            – strings are identical
 * 2. normalized_match       – identical after case+whitespace normalisation
 * 3. formatting_only        – identical after full punctuation removal
 * 4. minor_diff             – normalised Levenshtein distance < threshold
 * 5. (no decision)          – LLM needed
 */
export function decideMerge(
	groqText: string,
	deepgramText: string,
): GateDecision {
	if (hasStructuredFormattingIntent(groqText, deepgramText)) {
		return {
			strategy: "llm",
			reason: "structured_formatting_cues",
			text: undefined,
		};
	}

	// 1. Exact match
	if (groqText === deepgramText) {
		return {
			strategy: "exact_match",
			reason: "exact_text_match",
			text: deepgramText,
		};
	}

	// 2. Case + whitespace only differences → prefer deepgram (better casing)
	if (
		normalizeCaseWhitespace(groqText) === normalizeCaseWhitespace(deepgramText)
	) {
		return {
			strategy: "normalized_match",
			reason: "case_whitespace_match",
			text: deepgramText,
		};
	}

	// 3. Punctuation-only differences → prefer deepgram (better punctuation)
	if (normalizePunctuation(groqText) === normalizePunctuation(deepgramText)) {
		return {
			strategy: "formatting_only",
			reason: "punctuation_stripped_match",
			text: deepgramText,
		};
	}

	// 4. Near-identical: low normalised edit distance
	//    BUT only if word counts match — a word-count divergence usually means
	//    Deepgram split a proper noun into phonetic pieces (e.g. "Hyprland" →
	//    "hyper land") and the LLM must arbitrate.
	const maxLen = Math.max(groqText.length, deepgramText.length);
	const rawDist = levenshteinDistance(groqText, deepgramText);
	const normDist = rawDist / (maxLen || 1);

	const groqWordCount = groqText.trim().split(/\s+/).length;
	const deepgramWordCount = deepgramText.trim().split(/\s+/).length;

	if (normDist < MINOR_DIFF_THRESHOLD && groqWordCount === deepgramWordCount) {
		// Prefer Groq for residual lexical differences. Formatting-only cases have
		// already returned above, so this path is primarily about word accuracy.
		return {
			strategy: "minor_diff",
			reason: "diff_below_threshold",
			text: groqText,
		};
	}

	// 5. Single-word transcripts: only fast-path longer, very-close matches
	//    with a strong shared prefix or suffix. This keeps obvious technical
	//    near-matches fast while avoiding mistakes on common short words.
	if (
		groqWordCount === 1 &&
		deepgramWordCount === 1 &&
		isConservativeSingleWordMatch(groqText, deepgramText, normDist)
	) {
		return {
			strategy: "single_word_match",
			reason: "single_word_close_match",
			text: groqText,
		};
	}

	// 6. Semantic disagreement likely – call the LLM
	return {
		strategy: "llm",
		reason: "diff_above_threshold",
		text: undefined,
	};
}

// ---------------------------------------------------------------------------
// TranscriptMerger
// ---------------------------------------------------------------------------

export class TranscriptMerger {
	private _client: Groq | null = null;
	private _cachedApiKey: string | null = null;

	private getClient(apiKey: string): Groq {
		if (!this._client || this._cachedApiKey !== apiKey) {
			this._client = new Groq({ apiKey });
			this._cachedApiKey = apiKey;
		}
		return this._client;
	}

	public reset(): void {
		this._client = null;
		this._cachedApiKey = null;
	}

	public async merge(
		groqText: string,
		deepgramText: string,
	): Promise<MergeResult> {
		const config = loadConfig();
		const mergeModel = config.transcription.mergeModel;
		const apiKey = config.apiKeys.groq;
		const sourcesMatch = groqText.trim() === deepgramText.trim();
		const groqIsEmpty = groqText.trim().length === 0;
		const deepgramIsEmpty = deepgramText.trim().length === 0;

		// --- Early exits for empty / single-source ---

		if (groqIsEmpty && deepgramIsEmpty) {
			return {
				text: "",
				strategy: "empty",
				reason: "both_empty",
				accuracy: { sourcesMatch, editDistance: 0, confidence: 0 },
			};
		}
		if (groqIsEmpty) {
			return {
				text: deepgramText,
				strategy: "single_source",
				reason: "deepgram_only",
				accuracy: { sourcesMatch, editDistance: 0, confidence: 0.5 },
			};
		}
		if (deepgramIsEmpty) {
			return {
				text: groqText,
				strategy: "single_source",
				reason: "groq_only",
				accuracy: { sourcesMatch, editDistance: 0, confidence: 0.5 },
			};
		}

		// --- Deterministic gating ---

		const gate = decideMerge(groqText, deepgramText);

		if (gate.text !== undefined) {
			// Gate fired: skip LLM entirely
			logger.debug(
				{
					strategy: gate.strategy,
					reason: gate.reason,
					groqLen: groqText.length,
					deepgramLen: deepgramText.length,
				},
				"Merge gate: skipping LLM",
			);

			// Compute edit distance for observability even on gated paths.
			// Use the same normalization level that matched so editDistance
			// reflects semantic residual, not cosmetic noise (e.g. case flips).
			let distText = gate.text;
			let distGroq = groqText;
			if (gate.strategy === "normalized_match") {
				distText = normalizeCaseWhitespace(gate.text);
				distGroq = normalizeCaseWhitespace(groqText);
			} else if (gate.strategy === "formatting_only") {
				distText = normalizePunctuation(gate.text);
				distGroq = normalizePunctuation(groqText);
			}
			const dist = levenshteinDistance(distText, distGroq);
			const maxLen = Math.max(distText.length, distGroq.length) || 1;
			const normDist = dist / maxLen;

			return {
				text: gate.text,
				strategy: gate.strategy,
				reason: gate.reason,
				accuracy: {
					sourcesMatch: gate.strategy === "exact_match",
					editDistance: Math.round(normDist * 100),
					confidence: Math.round(Math.max(0, 1 - normDist) * 100) / 100,
				},
			};
		}

		// --- LLM merge ---

		const startTime = Date.now();
		let finalText: string;
		let mergeStrategy: MergeStrategy = "llm";
		let mergeReason: MergeReason = "llm_succeeded";

		try {
			const formattingHints: string[] = [];
			if (hasEnumerationCue(groqText) || hasEnumerationCue(deepgramText)) {
				formattingHints.push("enumeration/list structure");
			}
			if (hasLiteralSymbolCue(groqText) || hasLiteralSymbolCue(deepgramText)) {
				formattingHints.push("literal symbols or code-like structure");
			}

			const completion = await withRetry(
				async (signal) => {
					return await this.getClient(apiKey).chat.completions.create(
						{
							model: mergeModel,
							messages: [
								{ role: "system", content: SYSTEM_PROMPT },
								{
									role: "user",
									content: `${formattingHints.length > 0 ? `Formatting cues detected: ${formattingHints.join(", ")}.\n\n` : ""}Source A (Groq Whisper):\n${groqText}\n\nSource B (Deepgram Nova):\n${deepgramText}`,
								},
							],
							temperature: 0.1,
							max_tokens: 8192,
							seed: 42,
						},
						{ signal, timeout: 30000, maxRetries: 0 },
					);
				},
				{
					maxRetries: 2,
					backoffs: [500, 1000],
					operationName: "LLM merge",
					timeout: 30000,
					shouldRetry: (error: Error) =>
						/ECONNRESET|ETIMEDOUT|rate_limit/i.test(error.message),
				},
			);

			finalText = completion.choices[0]?.message?.content?.trim() || "";
			const timeMs = Date.now() - startTime;

			logger.debug(
				{
					model: mergeModel,
					timeMs,
					resultLength: finalText.length,
					groqTextLength: groqText.length,
					deepgramTextLength: deepgramText.length,
				},
				"LLM merge complete",
			);
		} catch (error) {
			logError("LLM merge failed, using fallback", error);
			finalText = deepgramText || groqText;
			mergeStrategy = "llm_fallback";
			mergeReason = "llm_error_fallback";
		}

		const distToGroq = levenshteinDistance(finalText, groqText);
		const distToDeepgram = levenshteinDistance(finalText, deepgramText);

		// Normalize each distance by the max length of the two strings being compared
		const maxDistGroq = Math.max(finalText.length, groqText.length) || 1;
		const maxDistDeepgram =
			Math.max(finalText.length, deepgramText.length) || 1;
		const normalizedDistGroq = distToGroq / maxDistGroq;
		const normalizedDistDeepgram = distToDeepgram / maxDistDeepgram;
		const editDistance = Math.round(
			(normalizedDistGroq + normalizedDistDeepgram) * 50,
		);
		const confidence = Math.max(
			0,
			Math.min(1, 1 - (normalizedDistGroq + normalizedDistDeepgram) / 2),
		);

		return {
			text: finalText,
			strategy: mergeStrategy,
			reason: mergeReason,
			accuracy: {
				sourcesMatch: false,
				editDistance,
				confidence: Math.round(confidence * 100) / 100,
			},
		};
	}
}
