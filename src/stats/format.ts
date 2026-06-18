import * as colors from "yoctocolors";
import type { StatsSummary } from "./summary";

function formatMs(value: number | null): string {
	if (value === null) return "n/a";
	return `${Math.round(value)}ms`;
}

function formatSeconds(value: number | null): string {
	if (value === null) return "n/a";
	return `${value.toFixed(1)}s`;
}

export function formatStatsSummary(summary: StatsSummary): string {
	const engineRows = Object.entries(summary.engines)
		.sort((a, b) => b[1] - a[1])
		.map(([engine, count]) => `  - ${engine}: ${count}`)
		.join("\n");
	const recentRows = summary.recent
		.map((item) => {
			const time = new Date(item.timestamp).toLocaleString();
			const text =
				item.text.length > 80 ? `${item.text.slice(0, 77)}...` : item.text;
			return `  - ${time} | ${item.engine} | ${formatMs(item.processingTime)} | ${text}`;
		})
		.join("\n");
	const recentErrors = summary.errors.recent
		.map((item) => {
			const ts = new Date(item.timestamp).toLocaleTimeString();
			return `  - ${ts} | ${item.message}`;
		})
		.join("\n");

	return [
		colors.bold(colors.cyan("Hyprvox Stats")),
		colors.cyan("============="),
		"",
		`${colors.bold("Today")} ${summary.counts.today}  ${colors.bold("Total")} ${summary.counts.total}  ${colors.bold("History")} ${summary.counts.history}`,
		`${colors.bold("Latency")} 24h median ${formatMs(summary.latency.medianMs)}  24h p95 ${formatMs(summary.latency.p95Ms)}  24h avg ${formatMs(summary.latency.averageMs)}  lifetime p95 ${formatMs(summary.latency.lifetimeP95Ms)}`,
		`${colors.bold("Duration")} avg ${formatSeconds(summary.duration.averageSeconds)}  short ${summary.duration.shortCount}  medium ${summary.duration.mediumCount}  long ${summary.duration.longCount}`,
		`${colors.bold("Daemon")} ${summary.daemon.status}${summary.daemon.pid ? ` (${summary.daemon.pid})` : ""}`,
		`${colors.bold("Errors")} ${summary.errors.count}${summary.errors.latest ? `  latest: ${summary.errors.latest}` : ""}`,
		"",
		colors.bold("Engines"),
		engineRows || "  No history yet.",
		"",
		colors.bold("Recent"),
		recentRows || "  No recent transcriptions.",
		"",
		colors.bold("Recent Errors"),
		recentErrors || "  No recent errors.",
		"",
		colors.dim(`Config: ${summary.paths.config}`),
		summary.paths.history
			? colors.dim(`History: ${summary.paths.history}`)
			: "",
		summary.paths.logs ? colors.dim(`Logs: ${summary.paths.logs}`) : "",
	]
		.filter((line) => line !== "")
		.join("\n");
}
