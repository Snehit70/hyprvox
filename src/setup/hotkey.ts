import type { ConfigFile } from "../config/schema";

export type SetupHotkeyChoice = "built-in" | "compositor";

export function resolveSetupHotkey(
	baseConfig: ConfigFile,
	choice: SetupHotkeyChoice,
): string {
	if (choice === "compositor") return "disabled";
	return baseConfig.behavior?.hotkey ?? "Right Control";
}
