import type { StatsSummary } from "./summary";
import { age } from "./tui-model";

export type RecentSortMode = "severity" | "newest";
export type RecentLocalFilter = "all" | "bad" | "warn" | "good";
export type RecentSessionRow = {
	key: string;
	item: StatsSummary["recent"][number];
	ageLabel: string;
	flags: string[];
	severity: "bad" | "warn" | "good";
	severityScore: number;
};

function scoreSeverity(
	item: StatsSummary["recent"][number],
	summary: StatsSummary,
): { severity: "bad" | "warn" | "good"; score: number; flags: string[] } {
	const flags: string[] = [];
	let score = 0;
	if (item.processingTime >= summary.thresholds.latencyP95BadMs) {
		score += 3;
		flags.push("LAT");
	} else if (item.processingTime >= summary.thresholds.latencyP95WarnMs) {
		score += 2;
		flags.push("LAT");
	}
	if (summary.errors.count > 0) {
		score += 1;
		flags.push("ERR");
	}
	if (summary.quality.total24h >= summary.thresholds.qualityBadCount24h) {
		score += 2;
		flags.push("QTY");
	} else if (
		summary.quality.total24h >= summary.thresholds.qualityWarnCount24h
	) {
		score += 1;
		flags.push("QTY");
	}
	if (
		summary.pipeline.fallbacks24h.groq +
			summary.pipeline.fallbacks24h.deepgram >
		0
	) {
		score += 1;
		flags.push("FB");
	}
	if (score >= 4) return { severity: "bad", score, flags };
	if (score >= 2) return { severity: "warn", score, flags };
	return { severity: "good", score, flags };
}

function sortRecentRows(
	rows: RecentSessionRow[],
	mode: RecentSortMode,
): RecentSessionRow[] {
	if (mode === "newest") {
		return rows
			.slice()
			.sort(
				(a, b) =>
					new Date(b.item.timestamp).getTime() -
					new Date(a.item.timestamp).getTime(),
			);
	}
	return rows.slice().sort((a, b) => {
		if (b.severityScore !== a.severityScore) {
			return b.severityScore - a.severityScore;
		}
		return (
			new Date(b.item.timestamp).getTime() -
			new Date(a.item.timestamp).getTime()
		);
	});
}

function rowMatchesFilter(
	row: RecentSessionRow,
	filter: RecentLocalFilter,
): boolean {
	if (filter === "all") return true;
	return row.severity === filter;
}

export function buildRecentRows(
	summary: StatsSummary,
	mode: RecentSortMode,
	filter: RecentLocalFilter,
	nowMs = Date.now(),
): RecentSessionRow[] {
	const rows = summary.recent.map((item) => {
		const scored = scoreSeverity(item, summary);
		return {
			key: `${item.timestamp}-${item.engine}-${item.processingTime}-${item.text.slice(0, 20)}`,
			item,
			ageLabel: age(nowMs - new Date(item.timestamp).getTime()),
			flags: scored.flags,
			severity: scored.severity,
			severityScore: scored.score,
		} satisfies RecentSessionRow;
	});

	return sortRecentRows(rows, mode).filter((row) =>
		rowMatchesFilter(row, filter),
	);
}

export function chunkText(
	text: string,
	width: number,
	maxLines: number,
): string[] {
	if (maxLines <= 0) return [];
	const clean = text.trim();
	if (!clean) return [""];
	const lines: string[] = [];
	let cursor = 0;
	while (cursor < clean.length && lines.length < maxLines) {
		lines.push(clean.slice(cursor, cursor + width));
		cursor += width;
	}
	if (cursor < clean.length && lines.length > 0) {
		const last = lines.length - 1;
		lines[last] = `${lines[last]?.slice(0, Math.max(0, width - 3)) ?? ""}...`;
	}
	return lines;
}
