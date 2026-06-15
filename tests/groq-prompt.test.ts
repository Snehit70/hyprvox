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

	it("fits contextual continuity hints within the same prompt budget", () => {
		const prompt = buildTranscriptionPrompt(
			["Hyprvox", "Deepgram", "Groq"],
			"The previous accepted chunk ended with an explanation about live chunk overlap and the next accepted chunk begins with a note about reducing latency for longer recordings while preserving dictated technical terms.",
		);

		expect(prompt).toContain("Recent text");
		expect(prompt).toContain("Hyprvox");
		expect(prompt.length).toBeLessThanOrEqual(MAX_TRANSCRIPTION_PROMPT_CHARS);
	});

	it("avoids instruction-heavy preserve phrasing in the base prompt", () => {
		const prompt = buildTranscriptionPrompt(["Hyprvox", "Groq"]);

		expect(prompt).toContain("Vocabulary");
		expect(prompt).not.toContain("Preserve commands");
		expect(prompt).not.toContain("Surrounding transcript context for continuity only");
		expect(prompt).not.toContain("If punctuation is spoken explicitly");
	});
});
