import { describe, expect, it } from "vitest";
import { buildRecentRows } from "../src/stats/tui-recent";
import type { StatsSummary } from "../src/stats/summary";

const summary: StatsSummary = {
	generatedAt: "2026-05-25T10:00:00.000Z",
	counts: { today: 1, total: 10, history: 2 },
	latency: { medianMs: 1100, p95Ms: 4200, averageMs: 1800, lifetimeP95Ms: 4200 },
	duration: { averageSeconds: 12.4, shortCount: 2, mediumCount: 0, longCount: 0 },
	engines: { "groq+deepgram": 2 },
	recent: [
		{
			timestamp: "2026-05-25T09:00:00.000Z",
			text: "clean session",
			engine: "groq+deepgram",
			processingTime: 1000,
			duration: 4,
		},
		{
			timestamp: "2026-05-25T09:01:00.000Z",
			text: "quality issue session",
			engine: "groq+deepgram",
			processingTime: 3200,
			duration: 8,
			validationReasons: ["token_injection"],
		},
	],
	daemon: { running: true, status: "idle", pid: 42 },
	errors: { count: 10, latest: "global error", recent: [] },
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
		mergeStrategies24h: { llm: 2 },
		fallbacks24h: { none: 1, groq: 1, deepgram: 0 },
		validationRetries24h: 1,
		modelRank24h: { "llama-3.3-70b-versatile": 2 },
	},
	regression: {
		window1hCount: 2,
		window24hCount: 2,
		baseline7dCount: 10,
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
	trends: {
		processingMs: {
			window15m: [1000, 3200],
			window1h: [1000, 3200],
			window6h: [1000, 3200],
			window24h: [1000, 3200],
			window7d: [1000, 3200],
		},
	},
};

describe("stats tui recent rows", () => {
	it("scores rows from per-session telemetry instead of global totals", () => {
		const rows = buildRecentRows(
			summary,
			"newest",
			"all",
			new Date("2026-05-25T10:00:00.000Z").getTime(),
		);

		const cleanRow = rows.find((row) => row.item.text === "clean session");
		const qualityRow = rows.find(
			(row) => row.item.text === "quality issue session",
		);

		expect(cleanRow?.flags).toEqual([]);
		expect(cleanRow?.severity).toBe("good");
		expect(qualityRow?.flags).toEqual(["LAT", "QTY"]);
		expect(qualityRow?.severity).toBe("warn");
	});
});
