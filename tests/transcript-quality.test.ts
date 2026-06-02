import { describe, expect, it } from "vitest";
import {
	trimHallucinationSuffix,
	validateTranscript,
} from "../src/transcribe/quality";
import {
	garbageFixtures,
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

	it("detects vocabulary-hint prompt artifacts", () => {
		const result = validateTranscript(
			"Likely vocabulary includes commands, file paths, acronyms, project names, and code terms.",
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

	it("detects chain-of-thought and meta leakage", () => {
		const result = validateTranscript(
			"<think>We need to analyze the user request.</think> The final transcript is update the docs.",
		);

		expect(result.valid).toBe(false);
		expect(result.reasons).toContain("cot_meta");
	});

	it("flags meta reasoning that references the user's request", () => {
		const result = validateTranscript(
			"Let me think step by step about the user's request and produce the answer.",
		);

		expect(result.valid).toBe(false);
		expect(result.reasons).toContain("cot_meta");
	});

	it("does not flag ordinary first-person speech as cot meta", () => {
		const ordinary = [
			"Let me answer your next five questions.",
			"Let me think about this for a moment.",
			"I should figure out the bug before lunch.",
			"We need to address the failing tests today.",
		];

		for (const text of ordinary) {
			const result = validateTranscript(text);
			expect(
				result.reasons,
				`unexpected cot_meta flag for: ${text}`,
			).not.toContain("cot_meta");
		}
	});

	it("does not flag ordinary English words with long consonant clusters", () => {
		const ordinary = [
			"What are our strengths",
			"She counted twelfths and eighths",
			"The two lengths differ",
			"He has the rights",
		];

		for (const text of ordinary) {
			const result = validateTranscript(text);
			expect(result.valid, `unexpected garbage flag for: ${text}`).toBe(true);
			expect(result.reasons).not.toContain("garbage");
		}
	});

	it("still flags consonant-heavy garbage tokens", () => {
		const result = validateTranscript("Puighmmbrquy Loy Gotta");

		expect(result.valid).toBe(false);
		expect(result.reasons).toContain("garbage");
	});

	it("detects injected file and command token bursts", () => {
		const result = validateTranscript(
			"Let's run the review and update the plan. test-audio.mp3 benchmark-audio.ts test-audio.mp3",
		);

		expect(result.valid).toBe(false);
		expect(result.reasons).toContain("token_injection");
	});

	it("allows ordinary technical tokens in dictated instructions", () => {
		const result = validateTranscript(
			"Open AGENTS.md, update README.md, and run bun test after the change.",
		);

		expect(result.valid).toBe(true);
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

	it.each(garbageFixtures)("detects garbage fixture: $name", ({
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
