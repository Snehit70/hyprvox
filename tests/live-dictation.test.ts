import { describe, expect, test } from "vitest";
import {
	DesktopTextTyper,
	LiveDictationWriter,
} from "../src/output/live-dictation";

describe("LiveDictationWriter", () => {
	test("types only the newly committed transcript delta", async () => {
		const typed: string[] = [];
		const writer = new LiveDictationWriter({
			typeText: async (text) => {
				typed.push(text);
			},
		});

		await writer.acceptCommittedTranscript("hello");
		await writer.acceptCommittedTranscript("hello world");
		await writer.acceptCommittedTranscript("hello world");
		await writer.acceptCommittedTranscript("hello world again");

		expect(typed).toEqual(["hello", " world", " again"]);
	});

	test("uses wtype for focused text insertion on Wayland", async () => {
		const commands: Array<{ command: string; args: string[] }> = [];
		const typer = new DesktopTextTyper({
			env: { WAYLAND_DISPLAY: "wayland-1" },
			isCommandAvailable: (command) => command === "wtype",
			runCommand: async (command, args) => {
				commands.push({ command, args });
			},
		});

		await typer.typeText("hello world");

		expect(commands).toEqual([{ command: "wtype", args: ["hello world"] }]);
	});

	test("uses xdotool for focused text insertion outside Wayland", async () => {
		const commands: Array<{ command: string; args: string[] }> = [];
		const typer = new DesktopTextTyper({
			env: {},
			isCommandAvailable: (command) => command === "xdotool",
			runCommand: async (command, args) => {
				commands.push({ command, args });
			},
		});

		await typer.typeText("hello x11");

		expect(commands).toEqual([
			{
				command: "xdotool",
				args: ["type", "--clearmodifiers", "--", "hello x11"],
			},
		]);
	});
});
