import type { StatsSummary } from "./summary";

export type HealthState = "GOOD" | "WARN" | "BAD" | "UNKNOWN";

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

export function latencyState(p95: number | null): HealthState {
	if (p95 === null) return "UNKNOWN";
	if (p95 <= 2000) return "GOOD";
	if (p95 <= 3500) return "WARN";
	return "BAD";
}

export function errorState(count: number): Exclude<HealthState, "UNKNOWN"> {
	if (count === 0) return "GOOD";
	if (count <= 10) return "WARN";
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
	if (width <= 1) return "…";
	return `${text.slice(0, width - 1)}…`;
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

export function computePaneWidths(width: number): { left: number; right: number } {
	const right = Math.max(34, Math.floor(width * 0.34));
	const left = Math.max(50, width - right - 5);
	return { left, right };
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
