import { existsSync } from "node:fs";
import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type PerfEvent, parsePerfEvent } from "./perf-event";

export type StatsAggregateEntry = PerfEvent;

export const AGGREGATE_FILE = join(
	homedir(),
	".config",
	"hypr",
	"vox",
	"stats-aggregate.jsonl",
);

export async function appendStatsAggregateEntry(
	entry: StatsAggregateEntry,
): Promise<void> {
	await mkdir(dirname(AGGREGATE_FILE), { recursive: true, mode: 0o700 });
	await appendFile(AGGREGATE_FILE, `${JSON.stringify(entry)}\n`, "utf-8");
	await chmod(AGGREGATE_FILE, 0o600);
}

export async function loadStatsAggregateEntries(
	limit = 5000,
): Promise<StatsAggregateEntry[]> {
	if (!existsSync(AGGREGATE_FILE)) return [];
	const content = await readFile(AGGREGATE_FILE, "utf-8");
	const lines = content.split("\n").filter(Boolean);
	const selected = lines.slice(-limit);
	const entries: StatsAggregateEntry[] = [];
	for (const line of selected) {
		try {
			const parsed = parsePerfEvent(JSON.parse(line));
			if (parsed) entries.push(parsed);
		} catch {
			// Ignore malformed lines.
		}
	}
	return entries;
}
