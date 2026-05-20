import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Groq from "groq-sdk";
import { logger } from "../src/utils/logger";

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
	groq: string;
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
	qualityScore?: number;
	text?: string;
	error?: string;
};

type QualityFlags = {
	preserveArtifact: boolean;
	outroSuffix: boolean;
	mixedScript: boolean;
	mentionsTranscriptMeta: boolean;
	cotLeak: boolean;
};

type QualityBreakdown = {
	precision: number;
	recall: number;
	f1: number;
	lengthRatio: number;
	score: number;
};

const DEFAULT_MODELS = [
	"qwen/qwen3-32b",
	"llama-3.3-70b-versatile",
	"openai/gpt-oss-120b",
];
const DEFAULT_SLEEP_MS = 1_500;
const START = new Date("2026-05-15T00:00:00.000Z");
const END = new Date("2026-05-21T00:00:00.000Z");
const DEFAULT_CONFIG_PATH = join(
	homedir(),
	".config",
	"hypr",
	"vox",
	"config.json",
);
const NON_LATIN_SCRIPT_PATTERN =
	/[\u0600-\u06FF\u0750-\u077F\u0E00-\u0E7F\u1100-\u11FF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/;
const LATIN_SCRIPT_PATTERN = /\p{Script=Latin}/u;

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
	const hasLatin = LATIN_SCRIPT_PATTERN.test(text);
	const hasOtherScript = NON_LATIN_SCRIPT_PATTERN.test(text);
	return {
		preserveArtifact: /preserve the following/i.test(text),
		outroSuffix:
			/thank you for watching|thanks for watching|link in the description|software development process/i.test(
				text,
			),
		mixedScript: hasLatin && hasOtherScript,
		mentionsTranscriptMeta:
			/source_[ab]|source a|source b|transcript block/i.test(text),
		cotLeak:
			/<\s*think\s*>|<\s*\/\s*think\s*>|the user wants me to|first, i need to check/i.test(
				text,
			),
	};
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}._\-/\s]/gu, " ")
		.split(/\s+/u)
		.filter(Boolean);
}

function toFreq(tokens: string[]): Map<string, number> {
	const freq = new Map<string, number>();
	for (const token of tokens) {
		freq.set(token, (freq.get(token) ?? 0) + 1);
	}
	return freq;
}

function qualityScore(
	testCase: EvalCase,
	output: string,
	flags: QualityFlags,
): QualityBreakdown {
	const outputTokens = tokenize(output);
	const outputFreq = toFreq(outputTokens);

	const sourceScores = [testCase.groq, testCase.deepgram]
		.filter(Boolean)
		.map((source) => {
			const sourceTokens = tokenize(source);
			const sourceFreq = toFreq(sourceTokens);

			let overlap = 0;
			for (const [token, outCount] of outputFreq.entries()) {
				overlap += Math.min(outCount, sourceFreq.get(token) ?? 0);
			}

			const precision =
				outputTokens.length > 0 ? overlap / outputTokens.length : 0;
			const recall =
				sourceTokens.length > 0 ? overlap / sourceTokens.length : 0;
			const f1 =
				precision + recall > 0
					? (2 * precision * recall) / (precision + recall)
					: 0;

			return { precision, recall, f1 };
		});

	const bestScore = sourceScores.reduce(
		(best, candidate) => (candidate.f1 > best.f1 ? candidate : best),
		sourceScores[0] ?? { precision: 0, recall: 0, f1: 0 },
	);

	const sourceLen = Math.max(testCase.groq.length, testCase.deepgram.length, 1);
	const lengthRatio = output.length / sourceLen;

	let score = bestScore.f1 * 100;
	if (flags.cotLeak) score -= 60;
	if (flags.preserveArtifact) score -= 35;
	if (flags.outroSuffix) score -= 20;
	if (flags.mixedScript) score -= 20;
	if (flags.mentionsTranscriptMeta) score -= 20;

	if (lengthRatio > 2.5) {
		score -= 30;
	} else if (lengthRatio > 1.8) {
		score -= 15;
	}

	if (bestScore.precision < 0.6) score -= 20;

	const bounded = Math.max(0, Math.min(100, score));
	return {
		precision: bestScore.precision,
		recall: bestScore.recall,
		f1: bestScore.f1,
		lengthRatio,
		score: bounded,
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
		readFileSync(getArg("config") ?? DEFAULT_CONFIG_PATH, "utf8"),
	) as { paths: { logs: string; history: string } };
	const history = (
		JSON.parse(readFileSync(config.paths.history, "utf8")) as HistoryEntry[]
	).filter((entry) => {
		const time = new Date(entry.timestamp);
		return time >= START && time <= END;
	});

	const logFiles = readdirSync(config.paths.logs)
		.filter((file) => /^hyprvox-2026-05-(1[5-9]|20)\.log$/.test(file))
		.sort();

	const sessions: Array<{ complete: string; chunks: string[]; groq: string }> =
		[];
	let current: { chunks: string[] } | null = null;
	let currentGroq = "";

	for (const file of logFiles) {
		for (const event of parseJsonLines(join(config.paths.logs, file))) {
			const time = new Date(event.time);
			if (time < START || time > END) continue;

			if (event.msg === "Recording started") {
				current = { chunks: [] };
				currentGroq = "";
			} else if (
				current &&
				event.msg === "Received streaming transcript chunk"
			) {
				current.chunks.push(event.text ?? "");
			} else if (current && event.msg === "Groq source transcript") {
				currentGroq = event.text ?? "";
			} else if (current && event.msg === "Transcription complete") {
				sessions.push({
					complete: event.time,
					chunks: current.chunks,
					groq: currentGroq,
				});
				current = null;
				currentGroq = "";
			}
		}
	}

	const unmatchedSessions = [...sessions];

	return history.map((entry, index) => {
		const entryTime = new Date(entry.timestamp).getTime();
		let sessionIndex = -1;
		let nearestDelta = Number.POSITIVE_INFINITY;
		for (const [candidateIndex, session] of unmatchedSessions.entries()) {
			const delta = Math.abs(new Date(session.complete).getTime() - entryTime);
			if (delta < nearestDelta) {
				nearestDelta = delta;
				sessionIndex = candidateIndex;
			}
		}
		const session =
			sessionIndex >= 0
				? unmatchedSessions.splice(sessionIndex, 1)[0]
				: undefined;
		if (!session) {
			logger.warn(
				{ historyId: index + 1 },
				"No log session matched history entry",
			);
		}
		return {
			id: index + 1,
			timestamp: entry.timestamp,
			durationMs: entry.duration,
			issue: detectIssue(entry.text),
			groq: session?.groq ?? "",
			deepgram: session?.chunks.join(" ") ?? "",
			qwenFinal: entry.text,
		};
	});
}

function makeUserPrompt(testCase: EvalCase): string {
	return `Case ${testCase.id}
Observed issue in current Qwen output: ${testCase.issue}

<groq_source_transcript>
${testCase.groq}
</groq_source_transcript>

<current_qwen_final>
${testCase.qwenFinal}
</current_qwen_final>

<deepgram_streaming_chunks>
${testCase.deepgram}
</deepgram_streaming_chunks>`;
}

async function run(): Promise<void> {
	const config = JSON.parse(
		readFileSync(getArg("config") ?? DEFAULT_CONFIG_PATH, "utf8"),
	) as { apiKeys: { groq: string } };
	const client = new Groq({ apiKey: config.apiKeys.groq });
	const outputPath = getArg("output") ?? "analysis.md";
	const sleepMs = Number(getArg("sleep-ms") ?? DEFAULT_SLEEP_MS);
	const limit = Number(getArg("limit") ?? 0);
	const smoke = hasFlag("smoke");
	const issuesOnly = hasFlag("issues-only");
	const caseIds = getArg("case-ids")
		?.split(",")
		.map((value) => Number(value.trim()))
		.filter(Number.isFinite);
	const models = (getArg("models")?.split(",") ?? DEFAULT_MODELS).map((model) =>
		model.trim(),
	);
	const allCases = buildCases();
	const candidateCases = issuesOnly
		? allCases.filter((testCase) =>
				Object.values(qualityFlags(testCase.qwenFinal)).some(Boolean),
			)
		: allCases;
	const scopedCases =
		caseIds && caseIds.length > 0
			? candidateCases.filter((testCase) => caseIds.includes(testCase.id))
			: candidateCases;
	const limitedCases = limit > 0 ? scopedCases.slice(0, limit) : scopedCases;
	const selectedCases = smoke ? limitedCases.slice(0, 3) : limitedCases;
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
				const modelFlags = qualityFlags(text);
				const breakdown = qualityScore(testCase, text, modelFlags);
				results.push({
					caseId: testCase.id,
					issue: testCase.issue,
					model,
					ok: true,
					timeMs: Date.now() - start,
					inputChars: userPrompt.length,
					outputChars: text.length,
					qwenFlags: qualityFlags(testCase.qwenFinal),
					modelFlags,
					qualityScore: breakdown.score,
					text,
				});
				logger.info({
					caseId: testCase.id,
					model,
					ok: true,
					timeMs: Date.now() - start,
					outputChars: text.length,
				});
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
				logger.error(
					{
						err: error,
						caseId: testCase.id,
						model,
						ok: false,
					},
					"Merge model evaluation failed",
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
			const meta = okRows.filter(
				(row) => row.modelFlags?.mentionsTranscriptMeta,
			).length;
			const cot = okRows.filter((row) => row.modelFlags?.cotLeak).length;
			const avgQualityNum = okRows.length
				? okRows.reduce((sum, row) => sum + (row.qualityScore ?? 0), 0) /
					okRows.length
				: 0;
			const avgQuality = avgQualityNum.toFixed(1);
			return `| ${model} | ${okRows.length}/${rows.length} | ${avgTime} | ${avgQuality} | ${artifacts} | ${outros} | ${mixed} | ${meta} | ${cot} |`;
		})
		.join("\n");

	const ranking = [...byModel.entries()]
		.map(([model, rows]) => {
			const okRows = rows.filter((row) => row.ok);
			const avgQuality =
				okRows.length > 0
					? okRows.reduce((sum, row) => sum + (row.qualityScore ?? 0), 0) /
						okRows.length
					: 0;
			const avgTime =
				okRows.length > 0
					? okRows.reduce((sum, row) => sum + row.timeMs, 0) / okRows.length
					: Number.POSITIVE_INFINITY;
			const successRate = rows.length > 0 ? okRows.length / rows.length : 0;
			return { model, avgQuality, avgTime, successRate };
		})
		.sort((a, b) => {
			if (b.avgQuality !== a.avgQuality) return b.avgQuality - a.avgQuality;
			if (b.successRate !== a.successRate) return b.successRate - a.successRate;
			return a.avgTime - b.avgTime;
		});

	const rankingRows = ranking
		.map(
			(item, idx) =>
				`| ${idx + 1} | ${item.model} | ${(item.avgQuality || 0).toFixed(1)} | ${(item.successRate * 100).toFixed(1)}% | ${Math.round(item.avgTime)} |`,
		)
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
					return `#### ${result.model}\n\nTime: ${result.timeMs}ms  \nQuality score: ${(result.qualityScore ?? 0).toFixed(1)} / 100  \nFlags: ${JSON.stringify(result.modelFlags)}\n\n${result.text}\n`;
				})
				.join("\n");

			return `### Case ${testCase.id}: ${testCase.issue}

Timestamp: ${testCase.timestamp}  
Duration: ${Math.round(testCase.durationMs / 1000)}s  
Input chars: Groq ${testCase.groq.length}, Qwen ${testCase.qwenFinal.length}, Deepgram ${testCase.deepgram.length}

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
**Method:** Replay with real production source pairs from the current monitoring window using logged Groq source transcript + Deepgram streaming chunks + saved final transcript.

## Summary

| Model | Successful calls | Avg time ms | Avg quality score | Preserve artifacts | Outro suffixes | Mixed script | Transcript meta | CoT leak |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${modelRows}

Successful calls: ${successful.length}/${results.length}

## Ranked Recommendation

| Rank | Model | Avg quality score | Success rate | Avg time ms |
|---:|---|---:|---:|---:|
${rankingRows}

## Notes

- Groq source text and Deepgram chunks are from real production sessions in this window.
- The saved final transcript is used as the baseline reference for comparison.
- The script intentionally uses minimal Groq parameters: model, messages, temperature, and max_tokens.
- Calls are throttled with sleep between requests to avoid rate limits.

## Case Results

${caseSections}
`;
}

run().catch((error) => {
	logger.error({ err: error }, "Merge model evaluation crashed");
	process.exit(1);
});
