import { describe, expect, it } from "vitest";
import { assessGroqLiveQualityFallback } from "../src/transcribe/groq-live-quality";

describe("assessGroqLiveQualityFallback", () => {
	it("falls back when live Groq is materially shorter than valid Deepgram", () => {
		const liveGroqText = Array.from({ length: 80 }, () => "liveword").join(" ");
		const deepgramText = Array.from(
			{ length: 180 },
			() => "deepgramword",
		).join(" ");

		const decision = assessGroqLiveQualityFallback({
			chunkingUsed: true,
			fallbackToFullAudio: true,
			liveGroqText,
			deepgramText,
		});

		expect(decision).toEqual({
			shouldFallback: true,
			reason: "live_materially_shorter_than_deepgram",
		});
	});

	it("falls back when live Groq is materially longer and misses exact supported tokens", () => {
		const liveGroqText = Array.from(
			{ length: 8 },
			() =>
				"Hyperbox is growing quickly and Hyperbox has great momentum. Hyperbox is growing quickly and Hyperbox has great momentum. The feature branch is FEAD slash GRQQ chunking. I will post more consistently on Twitter and LinkedIn.",
		).join(" ");
		const deepgramText = Array.from(
			{ length: 6 },
			() =>
				"Hyprvox is growing quickly and has great momentum. The feature branch is feat slash groq chunking. I will post more consistently on Twitter and LinkedIn.",
		).join(" ");

		const decision = assessGroqLiveQualityFallback({
			chunkingUsed: true,
			fallbackToFullAudio: true,
			liveGroqText,
			deepgramText,
			boostWords: ["Hyprvox", "Codex"],
		});

		expect(decision).toEqual({
			shouldFallback: true,
			reason: "live_materially_longer_and_divergent_than_deepgram",
		});
	});

	it("does not fall back when live Groq has comparable length", () => {
		const liveGroqText = Array.from(
			{ length: 160 },
			() => "sourceword",
		).join(" ");
		const deepgramText = Array.from(
			{ length: 180 },
			() => "sourceword",
		).join(" ");

		const decision = assessGroqLiveQualityFallback({
			chunkingUsed: true,
			fallbackToFullAudio: true,
			liveGroqText,
			deepgramText,
		});

		expect(decision).toEqual({ shouldFallback: false, reason: "none" });
	});

	it("does not fall back on longer live Groq without divergence signals", () => {
		const liveGroqText = Array.from(
			{ length: 220 },
			() => "Hyprvox roadmap update",
		).join(" ");
		const deepgramText = Array.from(
			{ length: 150 },
			() => "Hyprvox roadmap update",
		).join(" ");

		const decision = assessGroqLiveQualityFallback({
			chunkingUsed: true,
			fallbackToFullAudio: true,
			liveGroqText,
			deepgramText,
			boostWords: ["Hyprvox"],
		});

		expect(decision).toEqual({ shouldFallback: false, reason: "none" });
	});

	it("does not fall back when full-audio fallback is disabled", () => {
		const decision = assessGroqLiveQualityFallback({
			chunkingUsed: true,
			fallbackToFullAudio: false,
			liveGroqText: "short live text",
			deepgramText: Array.from(
				{ length: 180 },
				() => "deepgramword",
			).join(" "),
		});

		expect(decision).toEqual({ shouldFallback: false, reason: "none" });
	});
});
