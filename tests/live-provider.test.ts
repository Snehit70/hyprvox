import { describe, expect, test } from "vitest";
import {
	isCommittedLiveTranscript,
	type LiveTranscriptEvent,
} from "../src/transcribe/live-provider";

describe("live provider transcript events", () => {
	test("commits only final or speech-final transcript events", () => {
		const interim: LiveTranscriptEvent = {
			text: "hello wor",
			isFinal: false,
			speechFinal: false,
		};
		const finalChunk: LiveTranscriptEvent = {
			text: "hello world",
			isFinal: true,
			speechFinal: false,
		};
		const speechFinalChunk: LiveTranscriptEvent = {
			text: "hello again",
			isFinal: false,
			speechFinal: true,
		};

		expect(isCommittedLiveTranscript(interim)).toBe(false);
		expect(isCommittedLiveTranscript(finalChunk)).toBe(true);
		expect(isCommittedLiveTranscript(speechFinalChunk)).toBe(true);
	});
});
