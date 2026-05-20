import { describe, expect, it } from "vitest";
import type { MergeResult } from "../src/transcribe/merger";
import { recoverTranscriptQuality } from "../src/transcribe/recovery";

const accuracy: MergeResult["accuracy"] = {
	sourcesMatch: false,
	editDistance: 20,
	confidence: 0.8,
};

function repairResult(text: string): MergeResult {
	return {
		text,
		strategy: "llm_retry_cleaned",
		reason: "llm_retry_succeeded",
		accuracy,
	};
}

describe("recoverTranscriptQuality", () => {
	it("accepts valid merged text without retry or fallback", async () => {
		const result = await recoverTranscriptQuality({
			finalText: "Update the config loader tests.",
			groqText: "Update the config loader tests.",
			deepgramText: "Update the config loader tests.",
			mergeStrategy: "llm",
			mergeReason: "llm_succeeded",
			accuracy,
		});

		expect(result.finalText).toBe("Update the config loader tests.");
		expect(result.validation.valid).toBe(true);
		expect(result.validationRetryCount).toBe(0);
		expect(result.validationFallbackSource).toBe("none");
		expect(result.repairAttempted).toBe(false);
	});

	it("uses successful repair when merged output fails validation", async () => {
		const result = await recoverTranscriptQuality({
			finalText:
				"Update the daemon service. Preserve the following terms in the following order.",
			groqText: "Update the daemon service.",
			deepgramText: "Update the daemon service.",
			mergeStrategy: "llm",
			mergeReason: "llm_succeeded",
			accuracy,
			repairMerge: async () => repairResult("Update the daemon service."),
		});

		expect(result.finalText).toBe("Update the daemon service.");
		expect(result.initialValidation.reasons).toContain("prompt_artifact");
		expect(result.validation.valid).toBe(true);
		expect(result.validationRetryCount).toBe(1);
		expect(result.validationFallbackSource).toBe("none");
		expect(result.mergeStrategy).toBe("llm_retry_cleaned");
		expect(result.mergeReason).toBe("llm_retry_succeeded");
	});

	it("falls back to clean Deepgram source when repair fails", async () => {
		const result = await recoverTranscriptQuality({
			finalText: "Transcript 1 is better. Transcript 2 is worse.",
			groqText: "Preserve the following commands for the app.",
			deepgramText: "Run the focused quality tests.",
			mergeStrategy: "llm",
			mergeReason: "llm_succeeded",
			repairMerge: async () => {
				throw new Error("repair failed");
			},
		});

		expect(result.finalText).toBe("Run the focused quality tests.");
		expect(result.repairAttempted).toBe(true);
		expect(result.repairFailed).toBe(true);
		expect(result.validation.valid).toBe(true);
		expect(result.validationFallbackSource).toBe("deepgram");
		expect(result.mergeStrategy).toBe("single_source");
		expect(result.mergeReason).toBe("deepgram_only");
		expect(result.accuracy).toBeUndefined();
	});

	it("falls back when repair returns chain-of-thought leakage", async () => {
		const result = await recoverTranscriptQuality({
			finalText: "<think>I should reason about this.</think> Update the docs.",
			groqText: "Update the docs.",
			deepgramText: "Update the docs.",
			mergeStrategy: "llm",
			mergeReason: "llm_succeeded",
			repairMerge: async () =>
				repairResult("The user wants me to output update the docs."),
		});

		expect(result.initialValidation.reasons).toContain("cot_meta");
		expect(result.finalText).toBe("Update the docs.");
		expect(result.validation.valid).toBe(true);
		expect(result.validationFallbackSource).toBe("deepgram");
	});

	it("falls back to Groq when Deepgram source is invalid", async () => {
		const result = await recoverTranscriptQuality({
			finalText: "Transcript 1 is better. Transcript 2 is worse.",
			groqText: "Run the focused quality tests.",
			deepgramText: "Preserve the following commands for the app.",
			mergeStrategy: "llm",
			mergeReason: "llm_succeeded",
			repairMerge: async () => repairResult("Merge the two transcripts."),
		});

		expect(result.finalText).toBe("Run the focused quality tests.");
		expect(result.repairAttempted).toBe(true);
		expect(result.repairFailed).toBe(false);
		expect(result.validation.valid).toBe(true);
		expect(result.validationFallbackSource).toBe("groq");
		expect(result.mergeStrategy).toBe("single_source");
		expect(result.mergeReason).toBe("groq_only");
		expect(result.accuracy).toBeUndefined();
	});

	it("keeps failure when merge, repair, and sources are invalid", async () => {
		const result = await recoverTranscriptQuality({
			finalText: "Transcript 1 is better. Transcript 2 is worse.",
			groqText: "Preserve the following commands for the app.",
			deepgramText: "Merge the two transcripts.",
			mergeStrategy: "llm",
			mergeReason: "llm_succeeded",
			repairMerge: async () =>
				repairResult("Output only the final transcript."),
		});

		expect(result.validation.valid).toBe(false);
		expect(result.validation.reasons).toContain("prompt_artifact");
		expect(result.validationFallbackSource).toBe("none");
	});
});
