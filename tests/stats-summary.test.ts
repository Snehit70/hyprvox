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
	test("computes latency, duration buckets, engines, and recent items", () => {
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
			now: new Date("2026-05-23T12:00:00.000Z"),
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
	});
});
