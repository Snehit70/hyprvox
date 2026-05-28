import type { StatsSummary } from "./summary";

export type HealthState = "GOOD" | "WARN" | "BAD" | "UNKNOWN";
export type StatsFilter = "all" | "quality" | "latency" | "errors" | "fallbacks";
export type StatsTab = "overview" | "quality" | "pipeline" | "trends" | "exports";
export type StatsWindowPreset = "15m" | "1h" | "6h" | "24h" | "7d";

export function ms(value: number | null): string {
	return value === null ? "n/a" : `${Math.round(value)}ms`;
}

export function seconds(value: number | null): string {
	return value === null ? "n/a" : `${value.toFixed(1)}s`;
}

export function age(msAgo: number): string {
	const sec = Math.max(0, Math.floor(msAgo / 1000));
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	const rem = sec % 60;
	return `${min}m ${rem}s`;
}

export function latencyState(
	p95: number | null,
	warnMs: number,
	badMs: number,
): HealthState {
	if (p95 === null) return "UNKNOWN";
	if (p95 <= warnMs) return "GOOD";
	if (p95 <= badMs) return "WARN";
	return "BAD";
}

export function errorState(
	count: number,
	warnCount: number,
	badCount: number,
): Exclude<HealthState, "UNKNOWN"> {
	if (count < warnCount) return "GOOD";
	if (count < badCount) return "WARN";
	return "BAD";
}

export function qualityState(
	count: number,
	warnCount: number,
	badCount: number,
): Exclude<HealthState, "UNKNOWN"> {
	if (count < warnCount) return "GOOD";
	if (count < badCount) return "WARN";
	return "BAD";
}

export function daemonState(status: string): Exclude<HealthState, "UNKNOWN"> {
	if (status === "idle" || status === "recording" || status === "processing") {
		return "GOOD";
	}
	if (status === "running" || status === "stale-pid") return "WARN";
	return "BAD";
}

export function truncate(text: string, width: number): string {
	if (text.length <= width) return text;
	if (width <= 1) return "...";
	return `${text.slice(0, width - 3)}...`;
}

export function sparkline(values: number[], width: number): string {
	if (values.length === 0 || width <= 0) return "";
	const bars = "▁▂▃▄▅▆▇█";
	const min = Math.min(...values);
	const max = Math.max(...values);
	const range = Math.max(1, max - min);
	return values
		.slice(-width)
		.map((v) => {
			const index = Math.floor(((v - min) / range) * (bars.length - 1));
			return bars[Math.max(0, Math.min(index, bars.length - 1))] ?? "▁";
		})
		.join("");
}

export function recentLatencySparkline(summary: StatsSummary, width: number): string {
	return sparkline(
		summary.recent
			.slice()
			.reverse()
			.map((item) => item.processingTime)
			.filter((v) => Number.isFinite(v) && v >= 0),
		width,
	);
}

export function overallP0(summary: StatsSummary): HealthState {
	const latency = latencyState(
		summary.latency.p95Ms,
		summary.thresholds.latencyP95WarnMs,
		summary.thresholds.latencyP95BadMs,
	);
	const errors = errorState(
		summary.errors.count,
		summary.thresholds.errorWarnCount24h,
		summary.thresholds.errorBadCount24h,
	);
	const quality = qualityState(
		summary.quality.total24h,
		summary.thresholds.qualityWarnCount24h,
		summary.thresholds.qualityBadCount24h,
	);
	const daemon = daemonState(summary.daemon.status);
	const hasBad = [latency, errors, quality, daemon].includes("BAD");
	if (hasBad) return "BAD";
	const hasWarn = [latency, errors, quality, daemon].includes("WARN");
	if (hasWarn) return "WARN";
	return "GOOD";
}

export function nextFilter(current: StatsFilter): StatsFilter {
	const order: StatsFilter[] = ["all", "quality", "latency", "errors", "fallbacks"];
	const idx = order.indexOf(current);
	return order[(idx + 1) % order.length] ?? "all";
}

export function nextTab(current: StatsTab): StatsTab {
	const order: StatsTab[] = ["overview", "quality", "pipeline", "trends", "exports"];
	const idx = order.indexOf(current);
	return order[(idx + 1) % order.length] ?? "overview";
}

export function prevTab(current: StatsTab): StatsTab {
	const order: StatsTab[] = ["overview", "quality", "pipeline", "trends", "exports"];
	const idx = order.indexOf(current);
	return order[(idx - 1 + order.length) % order.length] ?? "overview";
}

export function confidenceLabel(count: number, minSampleSize: number): string {
	return count >= minSampleSize ? "high" : "low";
}
