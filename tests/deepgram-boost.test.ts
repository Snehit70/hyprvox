import { describe, expect, it } from "vitest";
import {
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
			(_, index) => `term-${index}`,
		);

		expect(sanitizeDeepgramKeyterms(terms)).toHaveLength(MAX_DEEPGRAM_KEYTERMS);
	});
});
