import { describe, expect, it } from "vitest";
import {
	assessLongRecordingQuality,
	LONG_RECORDING_DURATION_MS,
} from "../src/transcribe/long-recording";

describe("assessLongRecordingQuality", () => {
	it("does not enter long-recording mode for short recordings", () => {
		const result = assessLongRecordingQuality({
			recordingDurationMs: 10_000,
			finalText: "short transcript",
			groqText: "short transcript",
			deepgramText: "short transcript",
		});

		expect(result.isLongRecording).toBe(false);
		expect(result.suspiciousMergeExpansion).toBe(false);
		expect(result.fallbackSource).toBe("none");
	});

	it("flags long merge output that expands far beyond both sources", () => {
		const source =
			"We need to update the config and preserve the current behavior. ".repeat(
				4,
			);
		const result = assessLongRecordingQuality({
			recordingDurationMs: LONG_RECORDING_DURATION_MS,
			finalText: `${source} ${"This extra invented bridge sentence was not in either source. ".repeat(5)}`,
			groqText: source,
			deepgramText: source,
		});

		expect(result.isLongRecording).toBe(true);
		expect(result.suspiciousMergeExpansion).toBe(true);
		expect(result.fallbackSource).toBe("deepgram");
		expect(result.fallbackText).toBe(source);
	});

	it("does not flag small expansion in long recordings", () => {
		const source =
			"We need to update the config and preserve the current behavior. ".repeat(
				15,
			);
		const result = assessLongRecordingQuality({
			recordingDurationMs: LONG_RECORDING_DURATION_MS,
			finalText: `${source} Okay.`,
			groqText: source,
			deepgramText: source,
		});

		expect(result.isLongRecording).toBe(true);
		expect(result.suspiciousMergeExpansion).toBe(false);
		expect(result.fallbackSource).toBe("none");
	});

	it("uses word count as a long-recording signal", () => {
		const source = "word ".repeat(151);
		const result = assessLongRecordingQuality({
			recordingDurationMs: 10_000,
			finalText: source,
			groqText: source,
			deepgramText: source,
		});

		expect(result.isLongRecording).toBe(true);
	});
});
