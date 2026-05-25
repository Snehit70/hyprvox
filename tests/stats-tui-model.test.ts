import { describe, expect, it } from "vitest";
import type { StatsSummary } from "../src/stats/summary";
import {
	age,
	computePaneWidths,
	daemonState,
	errorState,
	latencyState,
	ms,
	recentLatencySparkline,
	seconds,
	sparkline,
	truncate,
} from "../src/stats/tui-model";

const baseSummary: StatsSummary = {
	generatedAt: "2026-05-25T10:00:00.000Z",
	counts: { today: 1, total: 10, history: 4 },
	latency: { medianMs: 1100, p95Ms: 4200, averageMs: 1800 },
	duration: { averageSeconds: 12.4, shortCount: 3, mediumCount: 1, longCount: 0 },
	engines: { "groq+deepgram": 3, groq: 1 },
	recent: [
		{
			timestamp: "2026-05-25T09:00:00.000Z",
			text: "one",
			engine: "groq+deepgram",
			processingTime: 1000,
			duration: 4,
		},
		{
			timestamp: "2026-05-25T09:01:00.000Z",
			text: "two",
			engine: "groq+deepgram",
			processingTime: 2000,
			duration: 8,
		},
		{
			timestamp: "2026-05-25T09:02:00.000Z",
			text: "three",
			engine: "groq",
			processingTime: 3000,
			duration: 12,
		},
		{
			timestamp: "2026-05-25T09:03:00.000Z",
			text: "four",
			engine: "groq+deepgram",
			processingTime: 4000,
			duration: 16,
		},
	],
	daemon: { running: true, status: "idle", pid: 42 },
	errors: { count: 5, latest: "something failed" },
	paths: { config: "/tmp/cfg.json", history: "/tmp/h.json", logs: "/tmp/logs" },
};

describe("stats tui model helpers", () => {
	it("formats milliseconds and seconds consistently", () => {
		expect(ms(1200.4)).toBe("1200ms");
		expect(ms(null)).toBe("n/a");
		expect(seconds(12.345)).toBe("12.3s");
		expect(seconds(null)).toBe("n/a");
	});

	it("computes age strings for seconds and minutes", () => {
		expect(age(1500)).toBe("1s");
		expect(age(61000)).toBe("1m 1s");
		expect(age(-500)).toBe("0s");
	});

	it("assigns latency health thresholds", () => {
		expect(latencyState(null)).toBe("UNKNOWN");
		expect(latencyState(1999)).toBe("GOOD");
		expect(latencyState(2500)).toBe("WARN");
		expect(latencyState(4200)).toBe("BAD");
	});

	it("assigns error and daemon health thresholds", () => {
		expect(errorState(0)).toBe("GOOD");
		expect(errorState(4)).toBe("WARN");
		expect(errorState(11)).toBe("BAD");

		expect(daemonState("idle")).toBe("GOOD");
		expect(daemonState("processing")).toBe("GOOD");
		expect(daemonState("stale-pid")).toBe("WARN");
		expect(daemonState("stopped")).toBe("BAD");
	});

	it("truncates safely for narrow widths", () => {
		expect(truncate("abcdef", 4)).toBe("abc…");
		expect(truncate("abcdef", 1)).toBe("…");
		expect(truncate("abc", 4)).toBe("abc");
	});

	it("renders sparkline output and respects width", () => {
		expect(sparkline([], 10)).toBe("");
		expect(sparkline([1, 2, 3, 4], 0)).toBe("");

		const line = sparkline([1, 2, 3, 4], 3);
		expect(line.length).toBe(3);
		expect(line).toMatch(/^[▁▂▃▄▅▆▇█]+$/u);
	});

	it("builds recent latency sparkline from reversed recent list", () => {
		const line = recentLatencySparkline(baseSummary, 4);
		expect(line.length).toBe(4);
		expect(line).toMatch(/^[▁▂▃▄▅▆▇█]+$/u);
	});

	it("computes sane pane widths across terminal sizes", () => {
		expect(computePaneWidths(80)).toEqual({ left: 50, right: 34 });
		const wide = computePaneWidths(180);
		expect(wide.left).toBeGreaterThanOrEqual(50);
		expect(wide.right).toBeGreaterThanOrEqual(34);
		expect(wide.left + wide.right).toBeLessThanOrEqual(180);
	});
});
