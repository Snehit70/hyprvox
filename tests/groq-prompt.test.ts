import { describe, expect, it } from "vitest";
import {
	buildTranscriptionPrompt,
	MAX_TRANSCRIPTION_PROMPT_CHARS,
} from "../src/transcribe/groq";

describe("buildTranscriptionPrompt", () => {
	it("keeps the transcription prompt within Groq's prompt budget", () => {
		const boostWords = Array.from(
			{ length: 200 },
			(_, index) => `VERY-LONG-TECHNICAL-TERM-${index}.md`,
		);

		const prompt = buildTranscriptionPrompt(boostWords);

		expect(prompt.length).toBeLessThanOrEqual(MAX_TRANSCRIPTION_PROMPT_CHARS);
	});

	it("prioritizes earlier configured terms when fitting prompt hints", () => {
		const boostWords = [
			"Hyprland",
			"Waybar",
			"Convex",
			...Array.from(
				{ length: 200 },
				(_, index) => `VERY-LONG-TECHNICAL-TERM-${index}.md`,
			),
		];

		const prompt = buildTranscriptionPrompt(boostWords);

		expect(prompt).toContain("Hyprland");
		expect(prompt).toContain("Waybar");
		expect(prompt).toContain("Convex");
		expect(prompt.length).toBeLessThanOrEqual(MAX_TRANSCRIPTION_PROMPT_CHARS);
	});
});
