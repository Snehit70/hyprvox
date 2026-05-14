import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Groq from "groq-sdk";

type HistoryEntry = {
	timestamp: string;
	text: string;
	duration: number;
	engine?: string;
	processingTime?: number;
};

type LogEvent = {
	time: string;
	msg?: string;
	text?: string;
	engine?: string;
	textLength?: number;
	recordingDurationMs?: number;
	processingMs?: number;
	mergeStrategy?: string;
	mergeConfidence?: number;
};

type EvalCase = {
	id: number;
	timestamp: string;
	durationMs: number;
	issue: string;
	deepgram: string;
	qwenFinal: string;
};

type EvalResult = {
	caseId: number;
	issue: string;
	model: string;
	ok: boolean;
	timeMs: number;
	inputChars: number;
	outputChars?: number;
	qwenFlags: QualityFlags;
	modelFlags?: QualityFlags;
	text?: string;
	error?: string;
};

type QualityFlags = {
	preserveArtifact: boolean;
	outroSuffix: boolean;
	mixedScript: boolean;
	mentionsTranscriptMeta: boolean;
};

const DEFAULT_MODELS = ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"];
const DEFAULT_CASE_IDS = [120, 145, 158, 160, 203, 210];
const DEFAULT_SLEEP_MS = 5_000;
const START = new Date("2026-05-04T13:48:00.000Z");
const END = new Date("2026-05-14T23:59:59.999Z");

const SYSTEM_PROMPT = `You are merging speech-to-text transcripts into one faithful final transcript.
Output only the final transcript.
Do not summarize.
Do not add instructions.
Do not mention the transcript, source A, source B, or the speaker.
Remove internal instruction artifacts such as "Preserve the following terms" or "Preserve the following commands".
Remove detached outro hallucinations such as "Thank you for watching" or "link in the description" when they are not actual user speech.
Preserve spoken order, user wording, technical terms, filenames, commands, and product names as much as possible.`;

function getArg(name: string): string | undefined {
	const prefix = `--${name}=`;
	return process.argv
		.find((arg) => arg.startsWith(prefix))
		?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function qualityFlags(text: string): QualityFlags {
	return {
		preserveArtifact: /preserve the following/i.test(text),
		outroSuffix:
			/thank you for watching|thanks for watching|link in the description|software development process/i.test(
				text,
			),
		mixedScript: [...text].some((char) => char.charCodeAt(0) > 127),
		mentionsTranscriptMeta:
			/source_[ab]|source a|source b|transcript block/i.test(text),
	};
}

function detectIssue(text: string): string {
	const flags = qualityFlags(text);
	if (flags.preserveArtifact) return "preserve_artifact";
	if (flags.outroSuffix) return "outro_suffix";
	if (flags.mixedScript) return "mixed_script";
	return "quality_issue";
}

function parseJsonLines(filePath: string): LogEvent[] {
	return readFileSync(filePath, "utf8")
		.split("\n")
		.flatMap((line) => {
			if (!line.startsWith("{")) return [];
			try {
				return [JSON.parse(line) as LogEvent];
			} catch {
				return [];
			}
		});
}

function buildCases(): EvalCase[] {
	const config = JSON.parse(
		readFileSync("/home/snehit/.config/hypr/vox/config.json", "utf8"),
	) as { paths: { logs: string; history: string } };
	const history = (
		JSON.parse(readFileSync(config.paths.history, "utf8")) as HistoryEntry[]
	).filter((entry) => {
		const time = new Date(entry.timestamp);
		return time >= START && time <= END;
	});

	const logFiles = readdirSync(config.paths.logs)
		.filter((file) => /^hyprvox-2026-05-(0[4-9]|1[0-4])\.log$/.test(file))
		.sort();

	const sessions: Array<{ complete?: string; chunks: string[] }> = [];
	let current: { chunks: string[] } | null = null;

	for (const file of logFiles) {
		for (const event of parseJsonLines(join(config.paths.logs, file))) {
			const time = new Date(event.time);
			if (time < START || time > END) continue;

			if (event.msg === "Recording started") {
				current = { chunks: [] };
			} else if (
				current &&
				event.msg === "Received streaming transcript chunk"
			) {
				current.chunks.push(event.text ?? "");
			} else if (current && event.msg === "Transcription complete") {
				sessions.push({ complete: event.time, chunks: current.chunks });
				current = null;
			}
		}
	}

	return history.map((entry, index) => {
		const session = sessions[index];
		return {
			id: index + 1,
			timestamp: entry.timestamp,
			durationMs: entry.duration,
			issue: detectIssue(entry.text),
			deepgram: session?.chunks.join(" ") ?? "",
			qwenFinal: entry.text,
		};
	});
}

function makeUserPrompt(testCase: EvalCase): string {
	return `Case ${testCase.id}
Observed issue in current Qwen output: ${testCase.issue}

<current_qwen_final>
${testCase.qwenFinal}
</current_qwen_final>

<deepgram_streaming_chunks>
${testCase.deepgram}
</deepgram_streaming_chunks>`;
}

async function run(): Promise<void> {
	const config = JSON.parse(
		readFileSync("/home/snehit/.config/hypr/vox/config.json", "utf8"),
	) as { apiKeys: { groq: string } };
	const client = new Groq({ apiKey: config.apiKeys.groq });
	const outputPath = getArg("output") ?? "analysis.md";
	const sleepMs = Number(getArg("sleep-ms") ?? DEFAULT_SLEEP_MS);
	const limit = Number(getArg("limit") ?? 0);
	const smoke = hasFlag("smoke");
	const models = (getArg("models")?.split(",") ?? DEFAULT_MODELS).map((model) =>
		model.trim(),
	);
	const caseIds = (
		getArg("case-ids")?.split(",").map(Number) ?? DEFAULT_CASE_IDS
	)
		.filter(Number.isFinite)
		.slice(0, limit > 0 ? limit : undefined);
	const allCases = buildCases();
	const cases = allCases.filter((testCase) => caseIds.includes(testCase.id));
	const selectedCases = smoke ? cases.slice(0, 1) : cases;
	const results: EvalResult[] = [];

	for (const testCase of selectedCases) {
		for (const model of models) {
			const userPrompt = makeUserPrompt(testCase);
			const start = Date.now();
			try {
				const completion = await client.chat.completions.create({
					model,
					messages: [
						{ role: "system", content: SYSTEM_PROMPT },
						{ role: "user", content: userPrompt },
					],
					temperature: 0,
					max_tokens: 1200,
				});
				const text = completion.choices[0]?.message?.content?.trim() ?? "";
				results.push({
					caseId: testCase.id,
					issue: testCase.issue,
					model,
					ok: true,
					timeMs: Date.now() - start,
					inputChars: userPrompt.length,
					outputChars: text.length,
					qwenFlags: qualityFlags(testCase.qwenFinal),
					modelFlags: qualityFlags(text),
					text,
				});
				console.log(
					JSON.stringify({
						caseId: testCase.id,
						model,
						ok: true,
						timeMs: Date.now() - start,
						outputChars: text.length,
					}),
				);
			} catch (error) {
				results.push({
					caseId: testCase.id,
					issue: testCase.issue,
					model,
					ok: false,
					timeMs: Date.now() - start,
					inputChars: userPrompt.length,
					qwenFlags: qualityFlags(testCase.qwenFinal),
					error: error instanceof Error ? error.message : String(error),
				});
				console.log(
					JSON.stringify({
						caseId: testCase.id,
						model,
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					}),
				);
			}
			await sleep(sleepMs);
		}
	}

	writeFileSync(outputPath, renderMarkdown(selectedCases, results));
}

function renderMarkdown(cases: EvalCase[], results: EvalResult[]): string {
	const now = new Date().toISOString();
	const successful = results.filter((result) => result.ok);
	const byModel = new Map<string, EvalResult[]>();
	for (const result of results) {
		const list = byModel.get(result.model) ?? [];
		list.push(result);
		byModel.set(result.model, list);
	}

	const modelRows = [...byModel.entries()]
		.map(([model, rows]) => {
			const okRows = rows.filter((row) => row.ok);
			const avgTime = okRows.length
				? Math.round(
						okRows.reduce((sum, row) => sum + row.timeMs, 0) / okRows.length,
					)
				: 0;
			const artifacts = okRows.filter(
				(row) => row.modelFlags?.preserveArtifact,
			).length;
			const outros = okRows.filter((row) => row.modelFlags?.outroSuffix).length;
			const mixed = okRows.filter((row) => row.modelFlags?.mixedScript).length;
			return `| ${model} | ${okRows.length}/${rows.length} | ${avgTime} | ${artifacts} | ${outros} | ${mixed} |`;
		})
		.join("\n");

	const caseSections = cases
		.map((testCase) => {
			const caseResults = results.filter(
				(result) => result.caseId === testCase.id,
			);
			const resultText = caseResults
				.map((result) => {
					if (!result.ok) {
						return `#### ${result.model}\n\nFailed: ${result.error}\n`;
					}
					return `#### ${result.model}\n\nTime: ${result.timeMs}ms  \nFlags: ${JSON.stringify(result.modelFlags)}\n\n${result.text}\n`;
				})
				.join("\n");

			return `### Case ${testCase.id}: ${testCase.issue}

Timestamp: ${testCase.timestamp}  
Duration: ${Math.round(testCase.durationMs / 1000)}s  
Input chars: Qwen ${testCase.qwenFinal.length}, Deepgram ${testCase.deepgram.length}

#### Current Qwen Final

Flags: ${JSON.stringify(qualityFlags(testCase.qwenFinal))}

${testCase.qwenFinal}

${resultText}`;
		})
		.join("\n---\n\n");

	return `# Hyprvox Merge Model Evaluation

**Generated:** ${now}  
**Models tested:** ${[...byModel.keys()].join(", ")}  
**Cases tested:** ${cases.map((testCase) => testCase.id).join(", ")}  
**Method:** Compare current saved Qwen output against model outputs generated from current Qwen final text plus reconstructed Deepgram streaming chunks. Full Groq/Whisper source text is not available in historical logs because current code logs only Groq text length.

## Summary

| Model | Successful calls | Avg time ms | Preserve artifacts | Outro suffixes | Mixed script |
|---|---:|---:|---:|---:|---:|
${modelRows}

Successful calls: ${successful.length}/${results.length}

## Notes

- This is not a perfect replay of the original merge because historical logs do not contain full Groq/Whisper text.
- Deepgram chunks and current Qwen final outputs are real production data.
- The script intentionally uses minimal Groq parameters: model, messages, temperature, and max_tokens.
- Calls are throttled with sleep between requests to avoid rate limits.

## Case Results

${caseSections}
`;
}

run().catch((error) => {
	console.error(error);
	process.exit(1);
});
