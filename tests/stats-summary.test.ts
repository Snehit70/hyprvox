import { describe, expect, test } from "vitest";
import { buildStatsSummaryFromInput } from "../src/stats/summary";
import type { HistoryItem } from "../src/utils/history";

const history: HistoryItem[] = [
	{
		timestamp: "2026-05-23T10:00:00.000Z",
		text: "short",
		duration: 8,
		engine: "groq",
		processingTime: 1000,
	},
	{
		timestamp: "2026-05-23T10:01:00.000Z",
		text: "medium",
		duration: 30_000,
		engine: "groq+deepgram",
		processingTime: 2000,
	},
	{
		timestamp: "2026-05-23T10:02:00.000Z",
		text: "long",
		duration: 120_000,
		engine: "groq+deepgram",
		processingTime: 5000,
	},
];

describe("stats summary", () => {
	test("computes latency, duration buckets, engines, recent items, and new quality/pipeline blocks", () => {
		const summary = buildStatsSummaryFromInput({
			stats: { today: 2, total: 10 },
			history,
			daemon: { running: true, status: "idle", pid: 123 },
			errors: { count: 1, latest: "example", recent: [] },
			paths: {
				config: "/config.json",
				history: "/history.json",
				logs: "/logs",
			},
			health: {
				checkedAt: "2026-05-23T12:00:00.000Z",
				overall: "PASS",
				configLoaded: true,
				apiKeysConfigured: { groq: true, deepgram: true },
				audio: { arecordAvailable: true, deviceCount: 1 },
				capabilities: {
					clipboard: true,
					notifications: true,
					systemd: true,
				},
				session: { type: "wayland", container: false },
			},
			now: new Date("2026-05-23T12:00:00.000Z"),
			perfEvents: [
				{
					timestamp: "2026-05-23T11:30:00.000Z",
					processingMs: 1800,
					mergeStrategy: "llm",
					mergeReason: "llm_succeeded",
					validationReasons: ["token_injection"],
					validationRetryCount: 1,
					validationFallbackSource: "none",
					mergeModel: "llama-3.3-70b-versatile",
				},
			],
		});

		expect(summary.counts).toEqual({ today: 2, total: 10, history: 3 });
		expect(summary.latency.medianMs).toBe(2000);
		expect(summary.latency.p95Ms).toBe(5000);
		expect(summary.duration.averageSeconds).toBeCloseTo(52.67, 2);
		expect(summary.duration.shortCount).toBe(1);
		expect(summary.duration.mediumCount).toBe(1);
		expect(summary.duration.longCount).toBe(1);
		expect(summary.engines).toEqual({ groq: 1, "groq+deepgram": 2 });
		expect(summary.recent[0]?.text).toBe("long");
		expect(summary.errors.recent).toEqual([]);
		expect(summary.health.overall).toBe("PASS");
		expect(summary.quality.total24h).toBe(1);
		expect(summary.quality.window24h.token_injection).toBe(1);
		expect(summary.pipeline.mergeStrategies24h.llm).toBe(1);
		expect(summary.pipeline.modelRank24h["llama-3.3-70b-versatile"]).toBe(1);
		expect(summary.pipeline.validationRetries24h).toBe(1);
		expect(summary.regression.window24hCount).toBe(1);
		expect(summary.cache.source).toBe("logs");
	});
});
