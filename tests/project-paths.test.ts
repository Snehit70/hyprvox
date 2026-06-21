import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getBundledOverlayPath, projectRoot } from "../src/utils/project-paths";

describe("project paths", () => {
	it("resolves the packaged project root and bundled overlay path", () => {
		expect(existsSync(join(projectRoot, "package.json"))).toBe(true);
		expect(getBundledOverlayPath()).toBe(join(projectRoot, "overlay"));
		expect(existsSync(getBundledOverlayPath())).toBe(true);
		expect(
			existsSync(join(getBundledOverlayPath(), "hyprvox-overlay.py")),
		).toBe(true);
	});
});
