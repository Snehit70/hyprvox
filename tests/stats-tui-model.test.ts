import { describe, expect, it } from "vitest";
import type { StatsSummary } from "../src/stats/summary";
import {
	age,
	daemonState,
	errorState,
	latencyState,
	ms,
	nextFilter,
	overallP0,
	qualityState,
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
	errors: { count: 5, latest: "something failed", recent: [] },
	paths: { config: "/tmp/cfg.json", history: "/tmp/h.json", logs: "/tmp/logs" },
	health: {
		checkedAt: "2026-05-25T10:00:00.000Z",
		overall: "PASS",
		configLoaded: true,
		apiKeysConfigured: { groq: true, deepgram: true },
		audio: { arecordAvailable: true, deviceCount: 2 },
		capabilities: { clipboard: true, notifications: true, systemd: true },
		session: { type: "wayland", container: false },
	},
	quality: {
		window24h: {
			prompt_artifact: 0,
			cot_meta: 0,
			token_injection: 1,
			hallucination_suffix: 0,
			mixed_script: 0,
			garbage: 0,
		},
		total24h: 1,
		spike: false,
	},
	pipeline: {
		mergeStrategies24h: { llm: 3, single_source: 1 },
		fallbacks24h: { none: 3, groq: 1, deepgram: 0 },
		validationRetries24h: 1,
		modelRank24h: { "llama-3.3-70b-versatile": 4 },
	},
	regression: {
		window1hCount: 2,
		window24hCount: 4,
		baseline7dCount: 20,
		flags: [],
	},
	thresholds: {
		latencyP95WarnMs: 2500,
		latencyP95BadMs: 4000,
		errorWarnCount24h: 5,
		errorBadCount24h: 20,
		qualityWarnCount24h: 3,
		qualityBadCount24h: 10,
	},
	cache: {
		source: "aggregate",
		lastRebuildAt: "2026-05-25T10:00:00.000Z",
		hitRate: 0.95,
		eventLagMs: 1200,
	},
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
		expect(latencyState(null, 2500, 4000)).toBe("UNKNOWN");
		expect(latencyState(1999, 2500, 4000)).toBe("GOOD");
		expect(latencyState(2500, 2500, 4000)).toBe("GOOD");
		expect(latencyState(3200, 2500, 4000)).toBe("WARN");
		expect(latencyState(4200, 2500, 4000)).toBe("BAD");
	});

	it("assigns error/quality and daemon states", () => {
		expect(errorState(0, 5, 20)).toBe("GOOD");
		expect(errorState(8, 5, 20)).toBe("WARN");
		expect(errorState(20, 5, 20)).toBe("BAD");

		expect(qualityState(0, 3, 10)).toBe("GOOD");
		expect(qualityState(4, 3, 10)).toBe("WARN");
		expect(qualityState(10, 3, 10)).toBe("BAD");

		expect(daemonState("idle")).toBe("GOOD");
		expect(daemonState("processing")).toBe("GOOD");
		expect(daemonState("stale-pid")).toBe("WARN");
		expect(daemonState("stopped")).toBe("BAD");
	});

	it("computes P0 state from summary", () => {
		expect(overallP0(baseSummary)).toBe("BAD");
	});

	it("cycles filter order", () => {
		expect(nextFilter("all")).toBe("quality");
		expect(nextFilter("quality")).toBe("latency");
		expect(nextFilter("latency")).toBe("errors");
		expect(nextFilter("errors")).toBe("fallbacks");
		expect(nextFilter("fallbacks")).toBe("all");
	});

	it("truncates safely for narrow widths", () => {
		expect(truncate("abcdef", 6)).toBe("abcdef");
		expect(truncate("abcdef", 4)).toBe("a...");
		expect(truncate("abcdef", 1)).toBe("...");
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
});
