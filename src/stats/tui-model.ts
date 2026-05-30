import type { StatsSummary } from "./summary";

export type HealthState = "GOOD" | "WARN" | "BAD" | "UNKNOWN";
export type StatsFilter = "all" | "quality" | "latency" | "errors" | "fallbacks";
export type StatsTab = "overview" | "quality" | "pipeline" | "trends" | "exports";
export type StatsWindowPreset = "15m" | "1h" | "6h" | "24h" | "7d";
export type Anomaly = {
	key: string;
	severity: "warn" | "bad";
	message: string;
};

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

export function detectAnomalies(summary: StatsSummary): Anomaly[] {
	const anomalies: Anomaly[] = [];
	const p95 = summary.latency.p95Ms ?? 0;
	if (p95 >= summary.thresholds.latencyP95BadMs) {
		anomalies.push({
			key: "latency_bad",
			severity: "bad",
			message: `Latency p95 ${ms(p95)} above bad threshold`,
		});
	} else if (p95 >= summary.thresholds.latencyP95WarnMs) {
		anomalies.push({
			key: "latency_warn",
			severity: "warn",
			message: `Latency p95 ${ms(p95)} above warn threshold`,
		});
	}

	if (summary.errors.count >= summary.thresholds.errorBadCount24h) {
		anomalies.push({
			key: "errors_bad",
			severity: "bad",
			message: `Error volume ${summary.errors.count} exceeds bad threshold`,
		});
	} else if (summary.errors.count >= summary.thresholds.errorWarnCount24h) {
		anomalies.push({
			key: "errors_warn",
			severity: "warn",
			message: `Error volume ${summary.errors.count} exceeds warn threshold`,
		});
	}

	if (summary.quality.total24h >= summary.thresholds.qualityBadCount24h) {
		anomalies.push({
			key: "quality_bad",
			severity: "bad",
			message: `Quality failures ${summary.quality.total24h} exceed bad threshold`,
		});
	} else if (summary.quality.total24h >= summary.thresholds.qualityWarnCount24h) {
		anomalies.push({
			key: "quality_warn",
			severity: "warn",
			message: `Quality failures ${summary.quality.total24h} exceed warn threshold`,
		});
	}

	if (summary.quality.spike) {
		anomalies.push({
			key: "quality_spike",
			severity: "warn",
			message: "Quality spike detected in 1h window",
		});
	}

	if (summary.cache.eventLagMs > 120000) {
		anomalies.push({
			key: "cache_lag",
			severity: "warn",
			message: `Cache event lag high (${ms(summary.cache.eventLagMs)})`,
		});
	}

	return anomalies;
}

export function percentile(values: number[], p: number): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.ceil((p / 100) * sorted.length) - 1;
	return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? null;
}

export function trendArrow(current: number | null, baseline: number | null): string {
	if (current === null || baseline === null || baseline === 0) return "~";
	const delta = (current - baseline) / baseline;
	if (delta > 0.1) return "↑";
	if (delta < -0.1) return "↓";
	return "~";
}

export function deltaPercent(current: number | null, baseline: number | null): string {
	if (current === null || baseline === null || baseline === 0) return "n/a";
	const delta = ((current - baseline) / baseline) * 100;
	const sign = delta >= 0 ? "+" : "";
	return `${sign}${delta.toFixed(0)}%`;
}

export function confidenceFromSample(sampleSize: number, minSampleSize: number): "high" | "low" {
	return sampleSize >= minSampleSize ? "high" : "low";
}

export function runtimeActionHint(summary: StatsSummary, anomalies: Anomaly[]): string {
	if (summary.cache.eventLagMs > 120000) return "check cache health and log watcher";
	if (anomalies.some((a) => a.key === "errors_bad" || a.key === "errors_warn")) {
		return "open pipeline tab and inspect fallback/retries";
	}
	if (anomalies.some((a) => a.key === "latency_bad" || a.key === "latency_warn")) {
		return "watch trends tab and compare 1h vs 24h latency";
	}
	if (anomalies.some((a) => a.key === "quality_bad" || a.key === "quality_warn")) {
		return "open quality tab and inspect top failure reasons";
	}
	return "stable now; keep monitoring auto-refresh";
}
