import { describe, expect, it } from "vitest";
import {
	trimHallucinationSuffix,
	validateTranscript,
} from "../src/transcribe/quality";
import {
	mixedScriptFixtures,
	promptArtifactFalsePositiveFixtures,
	promptArtifactFixtures,
	suffixFixtures,
} from "./fixtures/transcript-quality";

describe("transcript quality validation", () => {
	it("detects preserve-the-following instruction artifacts", () => {
		const result = validateTranscript(
			"The issue is clear. Preserve the following terms in the following order.",
		);

		expect(result.valid).toBe(false);
		expect(result.reasons).toContain("prompt_artifact");
	});

	it.each(promptArtifactFixtures)("detects prompt artifact fixture: $name", ({
		input,
		expectedReasons,
	}) => {
		const result = validateTranscript(input);

		expect(result.valid).toBe(false);
		for (const reason of expectedReasons) {
			expect(result.reasons).toContain(reason);
		}
	});

	it("does not reject ordinary use of preserve", () => {
		const result = validateTranscript(
			"We should preserve the user's original wording as much as possible.",
		);

		expect(result.valid).toBe(true);
	});

	it.each(
		promptArtifactFalsePositiveFixtures,
	)("allows prompt-artifact false-positive fixture: $name", ({
		input,
		expectedReasons,
	}) => {
		const result = validateTranscript(input);

		expect(result.valid).toBe(true);
		expect(result.reasons).toEqual(expectedReasons);
	});

	it("trims detachable YouTube-style suffixes", () => {
		const result = trimHallucinationSuffix(
			"We should improve the navigation bar. Thank you for watching.",
		);

		expect(result.trimmed).toBe(true);
		expect(result.text).toBe("We should improve the navigation bar.");
	});

	it.each(suffixFixtures)("trims suffix fixture: $name", ({
		input,
		expectedText,
		expectedReasons,
	}) => {
		const result = validateTranscript(input);

		expect(result.valid).toBe(true);
		expect(result.trimmedSuffix).toBe(true);
		expect(result.text).toBe(expectedText);
		for (const reason of expectedReasons) {
			expect(result.reasons).toContain(reason);
		}
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

	it.each(mixedScriptFixtures)("detects mixed-script fixture: $name", ({
		input,
		expectedReasons,
	}) => {
		const result = validateTranscript(input);

		expect(result.valid).toBe(false);
		for (const reason of expectedReasons) {
			expect(result.reasons).toContain(reason);
		}
	});
});
