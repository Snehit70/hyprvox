import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContextLexicon } from "../src/transcribe/lexicon";

describe("buildContextLexicon", () => {
	it("includes boost words, common technical terms, and repo filenames", () => {
		const rootDir = mkdtempSync(join(tmpdir(), "hyprvox-lexicon-"));
		writeFileSync(join(rootDir, "AGENTS.md"), "");
		writeFileSync(join(rootDir, "package.json"), "");
		mkdirSync(join(rootDir, "src"));
		writeFileSync(join(rootDir, "src", "OAuthClient.ts"), "");

		const terms = buildContextLexicon({
			rootDir,
			boostWords: ["Aceon", "CodeRabbit"],
		});

		expect(terms).toEqual(
			expect.arrayContaining([
				"Aceon",
				"CodeRabbit",
				"Hyprvox",
				"AGENTS.md",
				"package.json",
				"OAuthClient.ts",
			]),
		);
	});

	it("deduplicates terms case-insensitively", () => {
		const terms = buildContextLexicon({
			rootDir: mkdtempSync(join(tmpdir(), "hyprvox-lexicon-")),
			boostWords: ["Groq", "groq", "GROQ"],
		});

		expect(terms.filter((term) => term.toLowerCase() === "groq")).toHaveLength(
			1,
		);
	});

	it("respects max term limit", () => {
		const terms = buildContextLexicon({
			rootDir: mkdtempSync(join(tmpdir(), "hyprvox-lexicon-")),
			boostWords: ["one", "two", "three"],
			maxTerms: 2,
		});

		expect(terms).toHaveLength(2);
	});

	it("does not scan the current shell directory by default", () => {
		const terms = buildContextLexicon({ boostWords: ["Aceon"] });

		expect(terms).toContain("Aceon");
		expect(terms).toContain("Hyprvox");
		expect(terms).not.toContain("package.json");
	});
});
