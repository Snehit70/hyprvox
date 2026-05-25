import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG_FILE, loadConfig } from "../config/loader";
import type { DaemonState } from "../daemon/service";
import { type HistoryItem, loadHistory } from "../utils/history";
import { loadStats } from "../utils/stats";

export interface StatsSummary {
	generatedAt: string;
	counts: {
		today: number;
		total: number;
		history: number;
	};
	latency: {
		medianMs: number | null;
		p95Ms: number | null;
		averageMs: number | null;
	};
	duration: {
		averageSeconds: number | null;
		shortCount: number;
		mediumCount: number;
		longCount: number;
	};
	engines: Record<string, number>;
	recent: HistoryItem[];
	daemon: {
		running: boolean;
		status: string;
		pid?: number;
		lastError?: string;
	};
	errors: {
		count: number;
		latest: string | null;
	};
	paths: {
		config: string;
		history: string | null;
		logs: string | null;
	};
}

export interface StatsSummaryInput {
	stats: {
		today: number;
		total: number;
	};
	history: HistoryItem[];
	daemon: StatsSummary["daemon"];
	errors: StatsSummary["errors"];
	paths: StatsSummary["paths"];
	now?: Date;
}

function percentile(values: number[], p: number): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.ceil((p / 100) * sorted.length) - 1;
	return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? null;
}

function average(values: number[]): number | null {
	if (values.length === 0) return null;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeDurationSeconds(value: number): number {
	// Older history entries stored milliseconds while the field name stayed generic.
	return value > 3600 ? value / 1000 : value;
}

function readDaemonState(): StatsSummary["daemon"] {
	const configDir = join(homedir(), ".config", "hypr", "vox");
	const pidFile = join(configDir, "daemon.pid");
	const stateFile = join(configDir, "daemon.state");

	if (!existsSync(pidFile)) {
		return { running: false, status: "stopped" };
	}

	const pid = Number.parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
	try {
		process.kill(pid, 0);
		const state = existsSync(stateFile)
			? (JSON.parse(readFileSync(stateFile, "utf-8")) as DaemonState)
			: null;
		return {
			running: true,
			status: state?.status ?? "running",
			pid,
			lastError: state?.lastError,
		};
	} catch {
		return { running: false, status: "stale-pid", pid };
	}
}

function readErrorSummary(logDir: string | null): StatsSummary["errors"] {
	if (!logDir || !existsSync(logDir)) return { count: 0, latest: null };

	let count = 0;
	let latest: string | null = null;
	for (const file of readdirSync(logDir)
		.filter((name) => name.startsWith("hyprvox-") && name.endsWith(".log"))
		.sort()) {
		const content = readFileSync(join(logDir, file), "utf-8");
		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line);
				if (entry.level === 50) {
					count += 1;
					latest = entry.msg ?? entry.err?.message ?? "Unknown error";
				}
			} catch {
				// Ignore malformed log lines.
			}
		}
	}

	return { count, latest };
}

export async function buildStatsSummary(): Promise<StatsSummary> {
	const stats = loadStats();
	const history = await loadHistory();
	let historyPath: string | null = null;
	let logsPath: string | null = null;

	try {
		const config = loadConfig();
		historyPath = config.paths.history;
		logsPath = config.paths.logs;
	} catch {
		// Config may be incomplete during setup; stats can still be shown.
	}

	return buildStatsSummaryFromInput({
		stats,
		history,
		daemon: readDaemonState(),
		errors: readErrorSummary(logsPath),
		paths: {
			config: DEFAULT_CONFIG_FILE,
			history: historyPath,
			logs: logsPath,
		},
	});
}

export function buildStatsSummaryFromInput(
	input: StatsSummaryInput,
): StatsSummary {
	const processingTimes = input.history
		.map((item) => item.processingTime)
		.filter((value) => Number.isFinite(value) && value >= 0);
	const durations = input.history
		.map((item) => item.duration)
		.filter((value) => Number.isFinite(value) && value >= 0);
	const durationSeconds = durations.map(normalizeDurationSeconds);
	const engines = input.history.reduce<Record<string, number>>((acc, item) => {
		acc[item.engine || "unknown"] = (acc[item.engine || "unknown"] ?? 0) + 1;
		return acc;
	}, {});

	return {
		generatedAt: (input.now ?? new Date()).toISOString(),
		counts: {
			today: input.stats.today,
			total: input.stats.total,
			history: input.history.length,
		},
		latency: {
			medianMs: percentile(processingTimes, 50),
			p95Ms: percentile(processingTimes, 95),
			averageMs: average(processingTimes),
		},
		duration: {
			averageSeconds: average(durationSeconds),
			shortCount: durationSeconds.filter((duration) => duration < 15).length,
			mediumCount: durationSeconds.filter(
				(duration) => duration >= 15 && duration < 60,
			).length,
			longCount: durationSeconds.filter((duration) => duration >= 60).length,
		},
		engines,
		recent: input.history.slice(-8).reverse(),
		daemon: input.daemon,
		errors: input.errors,
		paths: input.paths,
	};
}
