import { describe, expect, it } from "vitest";
import {
	MAX_DEEPGRAM_KEYTERM_QUERY_CHARS,
	MAX_DEEPGRAM_KEYTERM_TOKENS,
	MAX_DEEPGRAM_KEYTERMS,
	sanitizeDeepgramKeyterms,
} from "../src/transcribe/deepgram-boost";

describe("sanitizeDeepgramKeyterms", () => {
	it("trims whitespace, deduplicates, and preserves first casing", () => {
		expect(
			sanitizeDeepgramKeyterms([
				" Hyprland ",
				"hyprland",
				"Waybar",
				"  ",
				"Open   TUI",
			]),
		).toEqual(["Hyprland", "Waybar", "Open TUI"]);
	});

	it("caps the list at the Deepgram keyterm limit", () => {
		const terms = Array.from(
			{ length: MAX_DEEPGRAM_KEYTERMS + 25 },
			(_, index) => `t${index}`,
		);

		expect(sanitizeDeepgramKeyterms(terms)).toHaveLength(MAX_DEEPGRAM_KEYTERMS);
	});

	it("caps the list at the Deepgram token limit", () => {
		const terms = Array.from(
			{ length: MAX_DEEPGRAM_KEYTERM_TOKENS + 25 },
			(_, index) => `term ${index}`,
		);
		const keyterms = sanitizeDeepgramKeyterms(terms);
		const tokenCount = keyterms.reduce(
			(total, term) => total + term.split(/\s+/).length,
			0,
		);

		expect(tokenCount).toBeLessThanOrEqual(MAX_DEEPGRAM_KEYTERM_TOKENS);
	});

	it("caps encoded keyterms to avoid oversized streaming URLs", () => {
		const terms = Array.from(
			{ length: MAX_DEEPGRAM_KEYTERMS },
			(_, index) => `VERY-LONG-PROJECT-FILENAME-${index}.md`,
		);
		const keyterms = sanitizeDeepgramKeyterms(terms);
		const queryChars = keyterms.reduce(
			(total, term, index) =>
				total +
				(index === 0 ? 0 : 1) +
				`keyterm=${encodeURIComponent(term)}`.length,
			0,
		);

		expect(queryChars).toBeLessThanOrEqual(MAX_DEEPGRAM_KEYTERM_QUERY_CHARS);
	});
});
