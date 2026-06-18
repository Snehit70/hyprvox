import { readdirSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config/loader";
import type { StatsSummary } from "./summary";
import {
	ms,
	overallHealth,
	type StatsTab,
	type StatsWindowPreset,
} from "./tui-model";

export async function exportSnapshot(
	summary: StatsSummary,
	format: "json" | "md",
	scope: "tab" | "global",
	tab: StatsTab,
): Promise<string> {
	const exportDir = join(homedir(), ".config", "hypr", "vox", "exports");
	await mkdir(exportDir, { recursive: true, mode: 0o700 });
	const stamp = new Date().toISOString().replace(/[.:]/g, "-");
	const suffix = scope === "tab" ? `-${tab}` : "-global";
	const path = join(exportDir, `stats-${stamp}${suffix}.${format}`);
	const payload =
		scope === "global"
			? summary
			: { tab, generatedAt: summary.generatedAt, summary };
	if (format === "json") {
		await writeFile(path, JSON.stringify(payload, null, 2), { mode: 0o600 });
	} else {
		const md = [
			"# Hyprvox Stats Snapshot",
			`Generated: ${summary.generatedAt}`,
			`Scope: ${scope} (${tab})`,
			`Health: ${overallHealth(summary)}`,
			`Latency 24h p95: ${ms(summary.latency.p95Ms)}`,
			`Latency lifetime p95: ${ms(summary.latency.lifetimeP95Ms)}`,
			`Errors: ${summary.errors.count}`,
			`Quality failures 24h: ${summary.quality.total24h}`,
			`Regression flags: ${summary.regression.flags.join(", ") || "none"}`,
		].join("\n");
		await writeFile(path, md, { mode: 0o600 });
	}
	return path;
}

export function filterByWindow(
	summary: StatsSummary,
	preset: StatsWindowPreset,
): number[] {
	if (preset === "15m") return summary.trends.processingMs.window15m;
	if (preset === "1h") return summary.trends.processingMs.window1h;
	if (preset === "6h") return summary.trends.processingMs.window6h;
	if (preset === "24h") return summary.trends.processingMs.window24h;
	return summary.trends.processingMs.window7d;
}

export function readStatsUiConfig(): {
	renderBudgetMs: number;
	minSampleSize: number;
} {
	try {
		const cfg = loadConfig() as {
			transcription?: {
				statsRenderBudgetMs?: number;
				statsMinSampleSize?: number;
			};
		};
		const renderBudgetMs = cfg.transcription?.statsRenderBudgetMs;
		const minSampleSize = cfg.transcription?.statsMinSampleSize;
		return {
			renderBudgetMs:
				typeof renderBudgetMs === "number" && Number.isFinite(renderBudgetMs)
					? renderBudgetMs
					: 50,
			minSampleSize:
				typeof minSampleSize === "number" && Number.isFinite(minSampleSize)
					? minSampleSize
					: 10,
		};
	} catch {
		return { renderBudgetMs: 50, minSampleSize: 10 };
	}
}

export function resolveWatchPaths(summary: StatsSummary): string[] {
	const base = [
		summary.paths.history,
		summary.paths.logs,
		join(homedir(), ".config", "hypr", "vox", "daemon.state"),
	].filter((p): p is string => Boolean(p));
	const expanded = new Set<string>(base);
	for (const path of base) {
		try {
			if (!statSync(path).isDirectory()) continue;
			for (const file of readdirSync(path)) {
				if (!file.endsWith(".log")) continue;
				expanded.add(join(path, file));
			}
		} catch {
			// Ignore paths that cannot be expanded.
		}
	}
	return [...expanded];
}
