import { describe, expect, it } from "vitest";
import {
	buildMergeUserPrompt,
	calculateMergeMaxTokens,
	decideMerge,
	extractExactTokenHints,
	hasStructuredFormattingIntent,
	isRequestTooLargeError,
	type MergeReason,
	type MergeStrategy,
	shouldRouteFormattingToLlm,
	TranscriptMerger,
} from "../src/transcribe/merger";
import { exactTokenFixtures } from "./fixtures/transcript-quality";

describe("decideMerge", () => {
	describe("exact match", () => {
		it("returns exact_match when texts are identical", () => {
			const result = decideMerge("hello world", "hello world");
			expect(result.strategy).toBe("exact_match");
			expect(result.reason).toBe("exact_text_match");
			expect(result.text).toBe("hello world");
		});

		it("routes enumerated dictation to the LLM even when sources match exactly", () => {
			const result = decideMerge(
				"the first issue is config the second issue is auth",
				"the first issue is config the second issue is auth",
			);
			expect(result.strategy).toBe("llm");
			expect(result.reason).toBe("structured_formatting_cues");
			expect(result.text).toBeUndefined();
		});

		it("keeps enumerated prose on the deterministic path in verbatim mode", () => {
			const text =
				"the first example is good and the second example is confusing";
			const result = decideMerge(text, text, "verbatim");

			expect(result.strategy).toBe("exact_match");
			expect(result.text).toBe(text);
		});
	});

	describe("case + whitespace normalization", () => {
		it("handles case difference only", () => {
			const result = decideMerge("Hello World", "hello world");
			expect(result.strategy).toBe("normalized_match");
			expect(result.reason).toBe("case_whitespace_match");
			expect(result.text).toBe("hello world");
		});

		it("handles extra whitespace", () => {
			const result = decideMerge("hello   world", "hello world");
			expect(result.strategy).toBe("normalized_match");
			expect(result.reason).toBe("case_whitespace_match");
		});

		it("handles leading/trailing whitespace", () => {
			const result = decideMerge("  hello world  ", "hello world");
			expect(result.strategy).toBe("normalized_match");
		});

		it("handles case + whitespace combined", () => {
			const result = decideMerge("  Hello   World  ", "hello world");
			expect(result.strategy).toBe("normalized_match");
		});
	});

	describe("punctuation normalization", () => {
		it("handles trailing punctuation difference", () => {
			const result = decideMerge("hello world", "hello world!");
			expect(result.strategy).toBe("formatting_only");
			expect(result.reason).toBe("punctuation_stripped_match");
		});

		it("handles punctuation difference only", () => {
			const result = decideMerge("hello, world", "hello world");
			expect(result.strategy).toBe("formatting_only");
		});

		it("handles multiple punctuation marks", () => {
			const result = decideMerge("Hello, world!", "hello world");
			expect(result.strategy).toBe("formatting_only");
		});
	});

	describe("minor diff threshold", () => {
		it("returns minor_diff for small differences below threshold with same word count", () => {
			// Single character difference in a longer string = well below 12%
			// Same word count, so minor_diff gate fires
			const result = decideMerge("hello world", "hello worldx");
			expect(result.strategy).toBe("minor_diff");
			expect(result.reason).toBe("diff_below_threshold");
			expect(result.text).toBe("hello world");
		});

		it("returns llm when difference exceeds threshold", () => {
			// Two completely different sentences
			const result = decideMerge(
				"the quick brown fox jumps over the lazy dog",
				"a completely different sentence here",
			);
			expect(result.strategy).toBe("llm");
			expect(result.reason).toBe("diff_above_threshold");
			expect(result.text).toBeUndefined();
		});

		it("handles minor word substitution - goes to LLM for meaningful changes", () => {
			// "cat" -> "dog" is a meaningful word change (3/22 ≈ 13.6%), above threshold
			const result = decideMerge(
				"the cat sat on the mat",
				"the dog sat on the mat",
			);
			expect(result.strategy).toBe("llm");
		});

		it("sends to LLM when word count differs even if edit distance is low", () => {
			// Deepgram splitting "Hyprland" into "hyper land" — word count diverges
			// so minor_diff gate must NOT fire, even though char-level distance is <12%
			const result = decideMerge(
				"set up the Hyprland config",
				"set up the hyper land config",
			);
			expect(result.strategy).toBe("llm");
			expect(result.reason).toBe("diff_above_threshold");
		});

		it("sends to LLM when Deepgram splits a proper noun", () => {
			// "Convex" → "con next" — same pattern as Hyprland
			const result = decideMerge(
				"deploy to Convex backend",
				"deploy to con next backend",
			);
			expect(result.strategy).toBe("llm");
			expect(result.reason).toBe("diff_above_threshold");
		});

		it("prefers Groq text for minor technical token diffs", () => {
			const result = decideMerge("update config path", "update konfig path");
			expect(result.strategy).toBe("minor_diff");
			expect(result.reason).toBe("diff_below_threshold");
			expect(result.text).toBe("update config path");
		});
	});

	describe("exact token preservation routing", () => {
		it.each(
			exactTokenFixtures,
		)("routes exact-token disagreement to LLM: $name", ({
			groqText,
			deepgramText,
		}) => {
			const result = decideMerge(groqText, deepgramText);

			expect(result.strategy).toBe("llm");
			expect(result.reason).toBe("diff_above_threshold");
			expect(result.text).toBeUndefined();
		});
	});

	describe("single word match", () => {
		it("gates single-word transcripts with small difference", () => {
			// "config" vs "konfig" — 1 char diff / 6 = 17% (above minor_diff
			// 12% but below the conservative single-word threshold). Without
			// this gate it would
			// go to LLM.
			const result = decideMerge("config", "konfig");
			expect(result.strategy).toBe("single_word_match");
			expect(result.reason).toBe("single_word_close_match");
			expect(result.text).toBe("config");
		});

		it("gates single-word with casing difference already caught by normalization", () => {
			// "Convex" vs "convex" — already caught by case normalization
			const result = decideMerge("Convex", "convex");
			expect(result.strategy).toBe("normalized_match");
		});

		it("sends completely different single words to LLM", () => {
			// "hello" vs "world" — 100% distance, well beyond the conservative gate
			const result = decideMerge("hello", "world");
			expect(result.strategy).toBe("llm");
		});

		it("gates single technical term with mild phonetic difference", () => {
			// "deepgram" vs "deepgrm" — 1 char deletion / 8 = 12.5%.
			// It shares a long prefix, so the conservative single-word
			// gate still allows it.
			const result = decideMerge("deepgram", "deepgrm");
			expect(result.strategy).toBe("single_word_match");
			expect(result.text).toBe("deepgram");
		});

		it("does not gate short everyday words with one-character difference", () => {
			const result = decideMerge("git", "get");
			expect(result.strategy).toBe("llm");
			expect(result.reason).toBe("diff_above_threshold");
		});

		it("does not gate longer words without a strong shared edge", () => {
			const result = decideMerge("branch", "brunch");
			expect(result.strategy).toBe("llm");
			expect(result.reason).toBe("diff_above_threshold");
		});

		it("does not gate shorter six-minus words even when close", () => {
			const result = decideMerge("cache", "catch");
			expect(result.strategy).toBe("llm");
			expect(result.reason).toBe("diff_above_threshold");
		});

		it("does not gate multi-word transcripts", () => {
			// Ensure this gate doesn't fire for multi-word inputs
			const result = decideMerge("hello world", "hello word");
			// 1 char diff out of ~11 = ~9%, minor_diff catches this
			expect(result.strategy).toBe("minor_diff");
		});
	});

	describe("edge cases", () => {
		it("handles empty strings", () => {
			// Empty strings should be handled before calling decideMerge
			// This is a sanity check - the function assumes non-empty inputs
			const result = decideMerge("", "");
			expect(result.strategy).toBe("exact_match");
		});

		it("handles single character strings", () => {
			const result = decideMerge("a", "b");
			// Single char diff is 100% - above threshold, so LLM
			expect(result.strategy).toBe("llm");
		});

		it("prefers deepgram output when gating", () => {
			const result = decideMerge("HELLO WORLD", "hello world.");
			// Should prefer deepgram (better casing and punctuation)
			expect(result.text).toBe("hello world.");
		});

		it("routes literal symbol dictation to the LLM", () => {
			const result = decideMerge("1 open curly bracket", "1 open curly brace");
			expect(result.strategy).toBe("llm");
			expect(result.reason).toBe("structured_formatting_cues");
			expect(result.text).toBeUndefined();
		});
	});
});

describe("hasStructuredFormattingIntent", () => {
	it("detects enumerated list cues", () => {
		expect(
			hasStructuredFormattingIntent(
				"the first issue is config and the second issue is auth",
			),
		).toBe(true);
	});

	it("detects spoken symbol cues", () => {
		expect(
			hasStructuredFormattingIntent("open curly bracket foo colon bar"),
		).toBe(true);
	});

	it("does not flag ordinary prose", () => {
		expect(
			hasStructuredFormattingIntent("we should update the config path later"),
		).toBe(false);
	});
});

describe("shouldRouteFormattingToLlm", () => {
	it("routes list-like dictation in clean and structured modes", () => {
		const text = "the first issue is config and the second issue is auth";

		expect(shouldRouteFormattingToLlm("clean", text)).toBe(true);
		expect(shouldRouteFormattingToLlm("structured", text)).toBe(true);
	});

	it("does not route ordinal prose in verbatim mode", () => {
		expect(
			shouldRouteFormattingToLlm(
				"verbatim",
				"the first example is good and the second example is confusing",
			),
		).toBe(false);
	});

	it("still routes literal symbol dictation in verbatim mode", () => {
		expect(
			shouldRouteFormattingToLlm("verbatim", "open curly bracket foo"),
		).toBe(true);
	});
});

describe("extractExactTokenHints", () => {
	it("extracts filenames, acronyms, camel-case names, ports, URLs, and headers", () => {
		const tokens = extractExactTokenHints(
			"Open `AGENTS.md`, update CodeRabbit, CRUD, and localhost:3000.",
			"Call https://api.example.com with Authorization: Bearer and VITE_API_URL.",
		);

		expect(tokens).toEqual(
			expect.arrayContaining([
				"AGENTS.md",
				"CodeRabbit",
				"CRUD",
				"localhost:3000",
				"https://api.example.com",
				"Authorization: Bearer",
				"VITE_API_URL",
			]),
		);
	});

	it("deduplicates exact tokens case-insensitively", () => {
		const tokens = extractExactTokenHints("AGENTS.md", "agents.md AGENTS.md");

		expect(tokens).toEqual(["AGENTS.md"]);
	});

	it("does not extract ordinary prose words", () => {
		const tokens = extractExactTokenHints(
			"we should update the config later and keep the text readable",
		);

		expect(tokens).toEqual([]);
	});
});

describe("buildMergeUserPrompt", () => {
	it("includes exact-token preservation hints from both sources", () => {
		const prompt = buildMergeUserPrompt(
			"Open AGENTS.md and update CRUD handlers.",
			"Open agents dot MD and update cred handlers.",
			[],
		);

		expect(prompt).toContain("Preserve these exact tokens");
		expect(prompt).toContain("AGENTS.md");
		expect(prompt).toContain("CRUD");
	});

	it("includes known project terms when provided", () => {
		const prompt = buildMergeUserPrompt(
			"Open agents dot MD.",
			"Open AGENTS.md.",
			[],
			["AGENTS.md", "CodeRabbit"],
		);

		expect(prompt).toContain("Known project terms: AGENTS.md, CodeRabbit.");
	});

	it("includes the selected formatting mode instruction", () => {
		const prompt = buildMergeUserPrompt(
			"first issue config second issue auth",
			"first issue config second issue auth",
			["enumeration/list structure"],
			[],
			"structured",
		);

		expect(prompt).toContain("Formatting mode: structured");
		expect(prompt).toContain("format them as a readable list");
	});

	it("omits exact-token section for ordinary prose", () => {
		const prompt = buildMergeUserPrompt(
			"we should update the config later",
			"we should update the config later",
			[],
		);

		expect(prompt).not.toContain("Preserve these exact tokens");
	});
});

describe("TranscriptMerger", () => {
	it("stores a defensive copy of context lexicon terms", () => {
		const merger = new TranscriptMerger();
		const terms = ["AGENTS.md"];

		merger.setContextLexicon(terms);
		terms.push("MUTATED.md");
		const state = merger as unknown as { contextLexicon: string[] };

		expect(state.contextLexicon).toEqual(["AGENTS.md"]);
	});
});

describe("MergeStrategy types", () => {
	it("includes all expected strategies", () => {
		const strategies: MergeStrategy[] = [
			"exact_match",
			"single_source",
			"normalized_match",
			"formatting_only",
			"minor_diff",
			"single_word_match",
			"llm",
			"llm_retry_cleaned",
			"llm_fallback",
			"empty",
		];
		expect(strategies).toHaveLength(10);
	});
});

describe("MergeReason types", () => {
	it("includes all expected reasons", () => {
		const reasons: MergeReason[] = [
			"both_empty",
			"groq_only",
			"deepgram_only",
			"structured_formatting_cues",
			"exact_text_match",
			"case_whitespace_match",
			"punctuation_stripped_match",
			"diff_below_threshold",
			"diff_above_threshold",
			"single_word_close_match",
			"llm_succeeded",
			"llm_retry_succeeded",
			"llm_error_fallback",
		];
		expect(reasons).toHaveLength(13);
	});
});

describe("merge token budgeting", () => {
	it("keeps merge completion tokens well below the old 8k default", () => {
		const groqText =
			"We can always improve many things, but you should understand how Hyprvox works.";
		const deepgramText =
			"We can always improve many things, but you should understand how Hyprvox works and how we can improve it further.";
		const userPrompt = buildMergeUserPrompt(groqText, deepgramText, []);

		const maxTokens = calculateMergeMaxTokens(
			groqText,
			deepgramText,
			userPrompt,
		);

		expect(maxTokens).toBeGreaterThanOrEqual(128);
		expect(maxTokens).toBeLessThanOrEqual(1024);
	});

	it("drops completion budget to zero when the prompt already exceeds the request budget", () => {
		const longText = "alpha ".repeat(20_000);
		const userPrompt = buildMergeUserPrompt(longText, longText, []);

		const maxTokens = calculateMergeMaxTokens(
			longText,
			longText,
			userPrompt,
			100,
		);

		expect(maxTokens).toBe(0);
	});
});

describe("request-too-large detection", () => {
	it("detects Groq 413 token budget errors as non-retryable", () => {
		const error = {
			status: 413,
			message: "413 request too large",
			error: {
				error: {
					code: "rate_limit_exceeded",
					type: "tokens",
					message:
						"Request too large for model on tokens per minute (TPM): Limit 6000, Requested 8906",
				},
			},
		};

		expect(isRequestTooLargeError(error)).toBe(true);
	});

	it("does not flag transient network failures as request-too-large", () => {
		expect(isRequestTooLargeError(new Error("ECONNRESET"))).toBe(false);
	});

	it("does not match unrelated requested-resource errors", () => {
		expect(
			isRequestTooLargeError(new Error("The requested resource was not found")),
		).toBe(false);
	});

	it("does not treat Groq 429 throttling as request-too-large", () => {
		const error = {
			status: 429,
			message:
				"Rate limit reached for model on tokens per minute (TPM): Limit 7000, Used 0, Requested 8906",
			error: {
				error: {
					code: "rate_limit_exceeded",
					type: "tokens",
				},
			},
		};

		expect(isRequestTooLargeError(error)).toBe(false);
	});
});
