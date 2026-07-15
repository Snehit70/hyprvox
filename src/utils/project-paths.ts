import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Walk up from this module until the hyprvox package.json is found. The
// module's own directory is not a reliable anchor: under Bun this file runs
// from src/utils/, but the Electron app bundles it into dist/app/, and that
// directory carries its own package.json (named "hyprvox-overlay" for window
// identity), so a fixed "../.." would resolve to the wrong place.
function findProjectRoot(startDir: string): string {
	let dir = startDir;
	while (true) {
		const pkgPath = join(dir, "package.json");
		if (existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
				if (pkg.name === "hyprvox") {
					return dir;
				}
			} catch {
				// Unreadable package.json — keep walking up.
			}
		}
		const parent = dirname(dir);
		if (parent === dir) {
			// Filesystem root reached without a match; fall back to the source
			// layout (src/utils -> repo root) so a broken install still points
			// somewhere sensible.
			return join(startDir, "..", "..");
		}
		dir = parent;
	}
}

export const projectRoot = findProjectRoot(
	dirname(fileURLToPath(import.meta.url)),
);

export function getBundledOverlayPath(): string {
	return join(projectRoot, "overlay");
}
