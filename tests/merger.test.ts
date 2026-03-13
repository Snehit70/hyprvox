import { describe, expect, it } from "vitest";
import {
	decideMerge,
	type GateDecision,
	type MergeReason,
	type MergeStrategy,
} from "../src/transcribe/merger";

describe("decideMerge", () => {
	describe("exact match", () => {
		it("returns exact_match when texts are identical", () => {
			const result = decideMerge("hello world", "hello world");
			expect(result.strategy).toBe("exact_match");
			expect(result.reason).toBe("exact_text_match");
			expect(result.text).toBe("hello world");
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
		it("returns minor_diff for small differences below threshold", () => {
			// Single character difference in a longer string = well below 12%
			const result = decideMerge("hello world", "hello worldx");
			expect(result.strategy).toBe("minor_diff");
			expect(result.reason).toBe("diff_below_threshold");
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
			// "cat" -> "dog" is a meaningful word change (1/7 = 14%), above threshold
			const result = decideMerge(
				"the cat sat on the mat",
				"the dog sat on the mat",
			);
			expect(result.strategy).toBe("llm");
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
			"llm",
			"llm_fallback",
			"empty",
		];
		expect(strategies).toHaveLength(8);
	});
});

describe("MergeReason types", () => {
	it("includes all expected reasons", () => {
		const reasons: MergeReason[] = [
			"both_empty",
			"groq_only",
			"deepgram_only",
			"exact_text_match",
			"case_whitespace_match",
			"punctuation_stripped_match",
			"diff_below_threshold",
			"diff_above_threshold",
			"llm_succeeded",
			"llm_error_fallback",
		];
		expect(reasons).toHaveLength(10);
	});
});
