import { EventEmitter } from "node:events";
import { describe, expect, test } from "vitest";
import { attachLiveDictationTranscriptHandler } from "../src/daemon/recording-session";
import type { TextTyper } from "../src/output/live-dictation";
import type { LiveTranscriptEvent } from "../src/transcribe/live-provider";

describe("recording session live dictation", () => {
	test("types only committed provider transcript events", async () => {
		const provider = new EventEmitter();
		const typed: string[] = [];
		const typer: TextTyper = {
			typeText: async (text) => {
				typed.push(text);
			},
		};

		attachLiveDictationTranscriptHandler({
			provider,
			typer,
		});

		provider.emit("transcript", "hello wor", {
			text: "hello wor",
			isFinal: false,
			speechFinal: false,
		} satisfies LiveTranscriptEvent);
		provider.emit("transcript", "hello world", {
			text: "hello world",
			isFinal: true,
			speechFinal: false,
		} satisfies LiveTranscriptEvent);
		provider.emit("transcript", "hello world again", {
			text: "hello world again",
			isFinal: false,
			speechFinal: true,
		} satisfies LiveTranscriptEvent);

		await new Promise((resolve) => setImmediate(resolve));

		expect(typed).toEqual(["hello world", " again"]);
	});
});
