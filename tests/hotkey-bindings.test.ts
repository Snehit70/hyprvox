import { describe, expect, test } from "vitest";
import type { Config } from "../src/config/schema";
import {
	createHotkeyBindings,
	matchesHotkeyBinding,
} from "../src/daemon/hotkey";

function hotkeyConfig(
	sonioxEnabled: boolean,
): Pick<Config, "behavior" | "liveDictation"> {
	return {
		behavior: {
			hotkey: "Right Control",
			toggleMode: true,
			notifications: true,
			clipboard: {
				append: true,
				minDuration: 0.6,
				maxDuration: 600,
			},
		},
		liveDictation: {
			enabled: true,
			insertionCommand: "auto",
			retypeFormatted: true,
			soniox: {
				enabled: sonioxEnabled,
				triggerKey: "Right Alt",
				paragraphPauseMs: 3000,
			},
		},
	};
}

describe("hotkey bindings", () => {
	test("keeps only the default binding when Soniox bypass is disabled", () => {
		const bindings = createHotkeyBindings(hotkeyConfig(false));

		expect(bindings.map((binding) => binding.event)).toEqual(["trigger"]);
	});

	test("adds a separate Soniox trigger binding when enabled", () => {
		const bindings = createHotkeyBindings(hotkeyConfig(true));

		expect(bindings.map((binding) => binding.event)).toEqual([
			"trigger",
			"soniox-trigger",
		]);
		expect(bindings[1]).toMatchObject({
			hotkey: "RIGHT ALT",
			triggerKey: "RIGHT ALT",
			modifiers: [],
		});
	});

	test("matches modifier chords without firing the Soniox binding", () => {
		const [defaultBinding, sonioxBinding] = createHotkeyBindings({
			...hotkeyConfig(true),
			behavior: {
				...hotkeyConfig(true).behavior,
				hotkey: "Ctrl+Space",
			},
		});
		if (!defaultBinding || !sonioxBinding) {
			throw new Error("Expected default and Soniox hotkey bindings");
		}

		expect(
			matchesHotkeyBinding(defaultBinding, "SPACE", { "LEFT CTRL": true }),
		).toBe(true);
		expect(
			matchesHotkeyBinding(sonioxBinding, "SPACE", { "LEFT CTRL": true }),
		).toBe(false);
	});
});
