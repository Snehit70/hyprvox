import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const MAX_LEXICON_TERMS = 120;
const MAX_FILENAME_TERMS = 80;
const SKIP_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"coverage",
	".next",
	".turbo",
	".cache",
	"logs",
]);

const COMMON_TECHNICAL_TERMS = [
	"Hyprvox",
	"Hyprland",
	"Groq",
	"Deepgram",
	"CodeRabbit",
	"TypeScript",
	"JavaScript",
	"Bun",
	"React",
	"Electron",
	"Whisper",
	"Nova-3",
	"CRUD",
	"SSE",
	"JWT",
	"OAuth",
	"CORS",
	"API",
	"CLI",
	"IPC",
];

export interface ContextLexiconOptions {
	rootDir?: string;
	boostWords?: string[];
	maxTerms?: number;
}

function addTerm(terms: string[], seen: Set<string>, rawTerm: string): void {
	const term = rawTerm.trim().replace(/\s+/g, " ");
	if (term.length < 2 || term.length > 80) return;

	const key = term.toLowerCase();
	if (seen.has(key)) return;

	seen.add(key);
	terms.push(term);
}

function collectFilenames(rootDir: string): string[] {
	const filenames: string[] = [];
	const stack = [rootDir];

	while (stack.length > 0 && filenames.length < MAX_FILENAME_TERMS) {
		const dir = stack.pop();
		if (!dir) break;

		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (filenames.length >= MAX_FILENAME_TERMS) break;
			if (entry.startsWith(".") && entry !== ".github") continue;

			const path = join(dir, entry);
			let isDirectory = false;
			try {
				isDirectory = statSync(path).isDirectory();
			} catch {
				continue;
			}

			if (isDirectory) {
				if (!SKIP_DIRS.has(entry)) stack.push(path);
				continue;
			}

			const name = basename(entry);
			if (/[._-]/.test(name) || /[A-Z]{2,}/.test(name)) {
				filenames.push(name);
			}
		}
	}

	return filenames;
}

export function buildContextLexicon({
	rootDir = process.cwd(),
	boostWords = [],
	maxTerms = MAX_LEXICON_TERMS,
}: ContextLexiconOptions = {}): string[] {
	const terms: string[] = [];
	const seen = new Set<string>();

	for (const term of boostWords) addTerm(terms, seen, term);
	for (const term of COMMON_TECHNICAL_TERMS) addTerm(terms, seen, term);
	for (const filename of collectFilenames(rootDir))
		addTerm(terms, seen, filename);

	return terms.slice(0, maxTerms);
}
