import { describe, expect, it } from "vitest";
import {
	trimHallucinationSuffix,
	validateTranscript,
} from "../src/transcribe/quality";

describe("transcript quality validation", () => {
	it("detects preserve-the-following instruction artifacts", () => {
		const result = validateTranscript(
			"The issue is clear. Preserve the following terms in the following order.",
		);

		expect(result.valid).toBe(false);
		expect(result.reasons).toContain("prompt_artifact");
	});

	it("does not reject ordinary use of preserve", () => {
		const result = validateTranscript(
			"We should preserve the user's original wording as much as possible.",
		);

		expect(result.valid).toBe(true);
	});

	it("trims detachable YouTube-style suffixes", () => {
		const result = trimHallucinationSuffix(
			"We should improve the navigation bar. Thank you for watching.",
		);

		expect(result.trimmed).toBe(true);
		expect(result.text).toBe("We should improve the navigation bar.");
	});

	it("treats suffix trimming as recoverable", () => {
		const result = validateTranscript(
			"We should improve the navigation bar. Thank you for watching.",
		);

		expect(result.valid).toBe(true);
		expect(result.trimmedSuffix).toBe(true);
		expect(result.reasons).toContain("hallucination_suffix");
		expect(result.text).toBe("We should improve the navigation bar.");
	});

	it("detects mixed-script garbage in English transcripts", () => {
		const result = validateTranscript(
			"The response format should remain the same 녹 complaint and edit.",
		);

		expect(result.valid).toBe(false);
		expect(result.reasons).toContain("mixed_script");
	});
});
