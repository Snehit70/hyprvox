import { describe, expect, test } from "bun:test";
import { normalizeKeyName, formatCombination } from "../../src/cli/config";

describe("Hotkey Formatting", () => {
  test("should normalize basic key names", () => {
    expect(normalizeKeyName("SPACE")).toBe("Space");
    expect(normalizeKeyName("RETURN")).toBe("Enter");
    expect(normalizeKeyName("LEFT CONTROL")).toBe("Ctrl");
    expect(normalizeKeyName("RIGHT CONTROL")).toBe("Right Control");
    expect(normalizeKeyName("UP ARROW")).toBe("Up");
    expect(normalizeKeyName("f8")).toBe("F8");
    expect(normalizeKeyName("a")).toBe("A");
  });

  test("should format single key combinations", () => {
    expect(formatCombination(new Set(["RIGHT CONTROL"]))).toBe("Right Control");
    expect(formatCombination(new Set(["SPACE"]))).toBe("Space");
    expect(formatCombination(new Set(["F8"]))).toBe("F8");
    expect(formatCombination(new Set(["UP ARROW"]))).toBe("Up");
  });

  test("should format modifier combinations", () => {
    expect(formatCombination(new Set(["LEFT CONTROL", "SPACE"]))).toBe("Ctrl+Space");
    expect(formatCombination(new Set(["LEFT CONTROL", "LEFT ALT", "A"]))).toBe("Ctrl+Alt+A");
    expect(formatCombination(new Set(["RIGHT CONTROL", "LEFT SHIFT", "DELETE"]))).toBe("Ctrl+Shift+Delete");
    expect(formatCombination(new Set(["LEFT META", "S"]))).toBe("Meta+S");
  });

  test("should handle node-global-key-listener specific names", () => {
    expect(formatCombination(new Set(["LEFT CONTROL", "RIGHT CONTROL"]))).toBe("Ctrl");
    expect(formatCombination(new Set(["LEFT CONTROL", "RIGHT CONTROL", "A"]))).toBe("Ctrl+A");
  });
});
