import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AudioDeviceService } from "../audio/device-service";
import { DEFAULT_CONFIG_FILE, loadConfig } from "../config/loader";
import type { DaemonState } from "../daemon/service";
import { detectEnvironment } from "../setup/environment";
import { type HistoryItem, loadHistory } from "../utils/history";
import { loadStats } from "../utils/stats";
import { loadStatsAggregateEntries } from "./aggregate";
import {
	type PerfEvent,
	parsePerfEvent,
	type QualityReason,
} from "./perf-event";

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
		lifetimeP95Ms: number | null;
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
		recent: Array<{ timestamp: string; message: string }>;
	};
	paths: {
		config: string;
		history: string | null;
		logs: string | null;
	};
	health: {
		checkedAt: string;
		overall: "PASS" | "WARN" | "FAIL";
		configLoaded: boolean;
		apiKeysConfigured: {
			groq: boolean;
			deepgram: boolean;
		};
		audio: {
			arecordAvailable: boolean;
			deviceCount: number | null;
		};
		capabilities: {
			clipboard: boolean;
			notifications: boolean;
			systemd: boolean;
		};
		session: {
			type: string;
			container: boolean;
		};
	};
	quality: {
		window24h: Record<QualityReason, number>;
		total24h: number;
		spike: boolean;
	};
	pipeline: {
		mergeStrategies24h: Record<string, number>;
		fallbacks24h: Record<"none" | "groq" | "deepgram", number>;
		validationRetries24h: number;
		modelRank24h: Record<string, number>;
	};
	regression: {
		window1hCount: number;
		window24hCount: number;
		baseline7dCount: number;
		flags: string[];
	};
	thresholds: {
		latencyP95WarnMs: number;
		latencyP95BadMs: number;
		errorWarnCount24h: number;
		errorBadCount24h: number;
		qualityWarnCount24h: number;
		qualityBadCount24h: number;
	};
	cache: {
		source: "aggregate" | "logs";
		lastRebuildAt: string;
		hitRate: number;
		eventLagMs: number;
	};
	trends: {
		processingMs: {
			window15m: number[];
			window1h: number[];
			window6h: number[];
			window24h: number[];
			window7d: number[];
		};
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
	health?: StatsSummary["health"];
	perfEvents?: PerfEvent[];
	thresholds?: StatsSummary["thresholds"];
	cacheMeta?: {
		source: "aggregate" | "logs";
		lastRebuildAt: string;
		hitRate: number;
	};
	now?: Date;
}

export interface BuildStatsSummaryOptions {
	forceRefresh?: boolean;
}

const DEFAULT_THRESHOLDS: StatsSummary["thresholds"] = {
	latencyP95WarnMs: 2500,
	latencyP95BadMs: 4000,
	errorWarnCount24h: 5,
	errorBadCount24h: 20,
	qualityWarnCount24h: 3,
	qualityBadCount24h: 10,
};

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

function readLogEntries(logDir: string | null): Array<Record<string, unknown>> {
	if (!logDir || !existsSync(logDir)) return [];
	const entries: Array<Record<string, unknown>> = [];
	for (const file of readdirSync(logDir)
		.filter((name) => name.startsWith("hyprvox-") && name.endsWith(".log"))
		.sort()) {
		const content = readFileSync(join(logDir, file), "utf-8");
		for (const line of content.split("\n")) {
			if (!line.trim()) continue;
			try {
				const parsed = JSON.parse(line) as Record<string, unknown>;
				entries.push(parsed);
			} catch {
				// Ignore malformed log lines.
			}
		}
	}
	return entries;
}

function readErrorSummary(
	logEntries: Array<Record<string, unknown>>,
): StatsSummary["errors"] {
	const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
	let count = 0;
	let latest: string | null = null;
	const recent: Array<{ timestamp: string; message: string }> = [];
	const seen = new Set<string>();

	for (const entry of logEntries) {
		if (entry.level !== 50) continue;
		const parsedTimestamp =
			typeof entry.time === "string" || typeof entry.time === "number"
				? new Date(entry.time).getTime()
				: Number.NaN;
		if (!Number.isFinite(parsedTimestamp) || parsedTimestamp < cutoffMs) continue;
		count += 1;
		const message =
			typeof entry.msg === "string"
				? entry.msg
				: typeof (entry.err as { message?: unknown } | undefined)?.message ===
						"string"
					? String((entry.err as { message?: unknown }).message)
					: "Unknown error";
		latest = message;
		const timestamp =
			typeof entry.time === "string"
				? entry.time
				: new Date(parsedTimestamp).toISOString();
		const key = `${timestamp}|${message}`;
		if (!seen.has(key)) {
			seen.add(key);
			recent.push({ timestamp, message });
			if (recent.length > 5) recent.shift();
		}
	}

	return { count, latest, recent };
}

function readPerfEvents(
	logEntries: Array<Record<string, unknown>>,
): PerfEvent[] {
	const events: PerfEvent[] = [];
	for (const entry of logEntries) {
		if (entry.type !== "perf") continue;
		const parsed = parsePerfEvent(entry);
		if (parsed) events.push(parsed);
	}
	return events;
}

async function loadPerfEventsHybrid(
	logEntries: Array<Record<string, unknown>>,
	cacheTtlMs: number,
	forceRefresh = false,
): Promise<{
	events: PerfEvent[];
	source: "aggregate" | "logs";
	lastRebuildAt: string;
	hitRate: number;
}> {
	const now = Date.now();
	if (!forceRefresh && perfEventCache && perfEventCache.expiresAt > now) {
		return {
			events: perfEventCache.events,
			source: perfEventCache.source,
			lastRebuildAt: perfEventCache.lastRebuildAt,
			hitRate: 1,
		};
	}

	const aggregateRows = await loadStatsAggregateEntries(8000);
	if (aggregateRows.length > 0) {
		const events: PerfEvent[] = aggregateRows;
		perfEventCache = {
			expiresAt: now + cacheTtlMs,
			events,
			source: "aggregate",
			lastRebuildAt: new Date().toISOString(),
		};
		return {
			events,
			source: "aggregate",
			lastRebuildAt: perfEventCache.lastRebuildAt,
			hitRate: 0.95,
		};
	}

	const events = readPerfEvents(logEntries);
	perfEventCache = {
		expiresAt: now + cacheTtlMs,
		events,
		source: "logs",
		lastRebuildAt: new Date().toISOString(),
	};
	return {
		events,
		source: "logs",
		lastRebuildAt: perfEventCache.lastRebuildAt,
		hitRate: 0.3,
	};
}

function pickThresholdsFromConfig(): StatsSummary["thresholds"] {
	try {
		return pickThresholdsFromRawConfig(loadConfig());
	} catch {
		return DEFAULT_THRESHOLDS;
	}
}

function pickThresholdsFromRawConfig(
	rawConfig: unknown,
): StatsSummary["thresholds"] {
	try {
		const parsed = rawConfig as {
			transcription?: {
				statsThresholds?: Partial<StatsSummary["thresholds"]>;
			};
		};
		const configured = parsed.transcription?.statsThresholds;
		if (!configured) return DEFAULT_THRESHOLDS;
		return {
			latencyP95WarnMs:
				typeof configured.latencyP95WarnMs === "number"
					? configured.latencyP95WarnMs
					: DEFAULT_THRESHOLDS.latencyP95WarnMs,
			latencyP95BadMs:
				typeof configured.latencyP95BadMs === "number"
					? configured.latencyP95BadMs
					: DEFAULT_THRESHOLDS.latencyP95BadMs,
			errorWarnCount24h:
				typeof configured.errorWarnCount24h === "number"
					? configured.errorWarnCount24h
					: DEFAULT_THRESHOLDS.errorWarnCount24h,
			errorBadCount24h:
				typeof configured.errorBadCount24h === "number"
					? configured.errorBadCount24h
					: DEFAULT_THRESHOLDS.errorBadCount24h,
			qualityWarnCount24h:
				typeof configured.qualityWarnCount24h === "number"
					? configured.qualityWarnCount24h
					: DEFAULT_THRESHOLDS.qualityWarnCount24h,
			qualityBadCount24h:
				typeof configured.qualityBadCount24h === "number"
					? configured.qualityBadCount24h
					: DEFAULT_THRESHOLDS.qualityBadCount24h,
		};
	} catch {
		return DEFAULT_THRESHOLDS;
	}
}

function pickStatsCacheTtlMsFromRawConfig(rawConfig: unknown): number {
	const parsed = rawConfig as { transcription?: { statsCacheTtlMs?: number } };
	const ttlMs = parsed.transcription?.statsCacheTtlMs;
	return typeof ttlMs === "number" && Number.isFinite(ttlMs) && ttlMs > 0
		? ttlMs
		: 10000;
}

function processingWindow(
	events: PerfEvent[],
	nowMs: number,
	windowMs: number,
): number[] {
	return eventsInWindow(events, nowMs, windowMs)
		.slice()
		.sort(
			(a, b) =>
				new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
		)
		.map((event) => event.processingMs)
		.filter((value) => Number.isFinite(value) && value >= 0);
}

function eventsInWindow(
	events: PerfEvent[],
	nowMs: number,
	windowMs: number,
): PerfEvent[] {
	const minTs = nowMs - windowMs;
	return events.filter((event) => {
		const ts = new Date(event.timestamp).getTime();
		return Number.isFinite(ts) && ts >= minTs && ts <= nowMs;
	});
}

function ratePerHour(
	events: PerfEvent[],
	nowMs: number,
	windowMs: number,
): number {
	const count = eventsInWindow(events, nowMs, windowMs).length;
	return count / (windowMs / 3_600_000);
}

export async function buildStatsSummary(): Promise<StatsSummary> {
	return buildStatsSummaryWithOptions();
}

export async function buildStatsSummaryWithOptions(
	options: BuildStatsSummaryOptions = {},
): Promise<StatsSummary> {
	const stats = loadStats();
	const history = await loadHistory();
	let historyPath: string | null = null;
	let logsPath: string | null = null;
	let configLoaded = false;
	let groqConfigured = false;
	let deepgramConfigured = false;
	let rawConfig: ReturnType<typeof loadConfig> | null = null;
	const envInfo = detectEnvironment();
	let audioDeviceCount: number | null = null;

	try {
		const config = loadConfig();
		rawConfig = config;
		configLoaded = true;
		historyPath = config.paths.history;
		logsPath = config.paths.logs;
		groqConfigured =
			typeof config.apiKeys.groq === "string" &&
			config.apiKeys.groq.startsWith("gsk_") &&
			config.apiKeys.groq.length > 6;
		deepgramConfigured =
			typeof config.apiKeys.deepgram === "string" &&
			config.apiKeys.deepgram.length >= 24;
	} catch {
		// Config may be incomplete during setup; stats can still be shown.
	}
	if (envInfo.commands.arecord?.path) {
		try {
			audioDeviceCount = (await new AudioDeviceService().listDevices()).length;
		} catch {
			audioDeviceCount = null;
		}
	}

	const apiReady = groqConfigured && deepgramConfigured;
	const hasMicPath = Boolean(envInfo.commands.arecord?.path);
	const clipboardReady = Boolean(
		envInfo.commands["wl-copy"]?.path ||
			envInfo.commands.xclip?.path ||
			envInfo.commands.xsel?.path,
	);
	const notifyReady = Boolean(envInfo.commands["notify-send"]?.path);
	const systemdReady = Boolean(envInfo.commands.systemctl?.path);
	const failCount =
		Number(!configLoaded) + Number(!apiReady) + Number(!hasMicPath);
	const warnCount =
		Number(hasMicPath && (audioDeviceCount ?? 0) === 0) +
		Number(!clipboardReady) +
		Number(!notifyReady) +
		Number(!systemdReady);
	const overall = failCount > 0 ? "FAIL" : warnCount > 0 ? "WARN" : "PASS";

	const logEntries = readLogEntries(logsPath);
	const ttlMs = pickStatsCacheTtlMsFromRawConfig(rawConfig);
	const perfBundle = await loadPerfEventsHybrid(
		logEntries,
		ttlMs,
		options.forceRefresh,
	);

	return buildStatsSummaryFromInput({
		stats,
		history,
		daemon: readDaemonState(),
		errors: readErrorSummary(logEntries),
		paths: {
			config: DEFAULT_CONFIG_FILE,
			history: historyPath,
			logs: logsPath,
		},
		health: {
			checkedAt: new Date().toISOString(),
			overall,
			configLoaded,
			apiKeysConfigured: {
				groq: groqConfigured,
				deepgram: deepgramConfigured,
			},
			audio: {
				arecordAvailable: Boolean(envInfo.commands.arecord?.path),
				deviceCount: audioDeviceCount,
			},
			capabilities: {
				clipboard: clipboardReady,
				notifications: notifyReady,
				systemd: systemdReady,
			},
			session: {
				type: envInfo.sessionType,
				container: envInfo.isContainer,
			},
		},
		perfEvents: perfBundle.events,
		thresholds: rawConfig
			? pickThresholdsFromRawConfig(rawConfig)
			: pickThresholdsFromConfig(),
		cacheMeta: {
			source: perfBundle.source,
			lastRebuildAt: perfBundle.lastRebuildAt,
			hitRate: perfBundle.hitRate,
		},
	});
}

export function buildStatsSummaryFromInput(
	input: StatsSummaryInput,
): StatsSummary {
	const now = input.now ?? new Date();
	const nowMs = now.getTime();
	const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;

	const lifetimeProcessingTimes = input.history
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

	const perfEvents = input.perfEvents ?? [];
	const sortedPerfEvents = perfEvents
		.slice()
		.sort(
			(a, b) =>
				new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
		);
	const events24h = eventsInWindow(sortedPerfEvents, nowMs, 24 * 3600_000);
	const events1h = eventsInWindow(sortedPerfEvents, nowMs, 3600_000);
	const baseline7d = eventsInWindow(sortedPerfEvents, nowMs, 7 * 24 * 3600_000);
	const previous23h = eventsInWindow(
		sortedPerfEvents,
		nowMs - 3600_000,
		23 * 3600_000,
	);

	const qualityWindow24h: Record<QualityReason, number> = {
		prompt_artifact: 0,
		cot_meta: 0,
		token_injection: 0,
		hallucination_suffix: 0,
		mixed_script: 0,
		garbage: 0,
	};
	for (const event of events24h) {
		for (const reason of event.validationReasons) {
			qualityWindow24h[reason] = (qualityWindow24h[reason] ?? 0) + 1;
		}
	}
	const qualityTotal24h = Object.values(qualityWindow24h).reduce(
		(sum, count) => sum + count,
		0,
	);

	const mergeStrategies24h: Record<string, number> = {};
	const fallbacks24h: Record<"none" | "groq" | "deepgram", number> = {
		none: 0,
		groq: 0,
		deepgram: 0,
	};
	let validationRetries24h = 0;
	const modelRank24h: Record<string, number> = {};
	for (const event of events24h) {
		mergeStrategies24h[event.mergeStrategy] =
			(mergeStrategies24h[event.mergeStrategy] ?? 0) + 1;
		fallbacks24h[event.validationFallbackSource] += 1;
		validationRetries24h += event.validationRetryCount;
		const modelKey =
			event.mergeModel ||
			event.groqSttModel ||
			event.deepgramModel ||
			"unknown-model";
		modelRank24h[modelKey] = (modelRank24h[modelKey] ?? 0) + 1;
	}

	const regressionFlags: string[] = [];
	const processingTimes24h = events24h
		.map((event) => event.processingMs)
		.filter((value) => Number.isFinite(value) && value >= 0);
	const p95 = percentile(processingTimes24h, 95);
	const baselineP95 = percentile(
		eventsInWindow(baseline7d, nowMs - 24 * 3600_000, 6 * 24 * 3600_000).map(
			(event) => event.processingMs,
		),
		95,
	);
	if (
		p95 !== null &&
		p95 > thresholds.latencyP95WarnMs &&
		baselineP95 !== null &&
		p95 > baselineP95 + 250
	) {
		regressionFlags.push("latency_p95_regressed");
	}
	if (input.errors.count >= thresholds.errorWarnCount24h) {
		regressionFlags.push("error_volume_high");
	}
	if (qualityTotal24h >= thresholds.qualityWarnCount24h) {
		regressionFlags.push("quality_failures_high");
	}
	const oneHourQualityRate = ratePerHour(
		events1h.filter((event) => event.validationReasons.length > 0),
		nowMs,
		3600_000,
	);
	const priorQualityRate =
		previous23h.filter((event) => event.validationReasons.length > 0).length /
		23;
	const spike = oneHourQualityRate >= Math.max(2, priorQualityRate * 2);
	if (spike) {
		regressionFlags.push("quality_spike_1h");
	}

	return {
		generatedAt: now.toISOString(),
		counts: {
			today: input.stats.today,
			total: input.stats.total,
			history: input.history.length,
		},
		latency: {
			medianMs: percentile(processingTimes24h, 50),
			p95Ms: p95,
			averageMs: average(processingTimes24h),
			lifetimeP95Ms: percentile(lifetimeProcessingTimes, 95),
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
		recent: input.history.slice(-12).reverse(),
		daemon: input.daemon,
		errors: input.errors,
		paths: input.paths,
		health: input.health ?? {
			checkedAt: now.toISOString(),
			overall: "FAIL",
			configLoaded: false,
			apiKeysConfigured: {
				groq: false,
				deepgram: false,
			},
			audio: {
				arecordAvailable: false,
				deviceCount: null,
			},
			capabilities: {
				clipboard: false,
				notifications: false,
				systemd: false,
			},
			session: {
				type: "unknown",
				container: false,
			},
		},
		quality: {
			window24h: qualityWindow24h,
			total24h: qualityTotal24h,
			spike,
		},
		pipeline: {
			mergeStrategies24h,
			fallbacks24h,
			validationRetries24h,
			modelRank24h,
		},
		regression: {
			window1hCount: events1h.length,
			window24hCount: events24h.length,
			baseline7dCount: baseline7d.length,
			flags: regressionFlags,
		},
		thresholds,
			cache: {
				source: input.cacheMeta?.source ?? "logs",
				lastRebuildAt: input.cacheMeta?.lastRebuildAt ?? now.toISOString(),
				hitRate: input.cacheMeta?.hitRate ?? 0,
				eventLagMs: Math.max(
					0,
					nowMs -
						(sortedPerfEvents.length > 0
							? new Date(sortedPerfEvents.at(-1)?.timestamp ?? now).getTime()
							: nowMs),
				),
			},
		trends: {
			processingMs: {
				window15m: processingWindow(sortedPerfEvents, nowMs, 15 * 60_000),
				window1h: processingWindow(sortedPerfEvents, nowMs, 60 * 60_000),
				window6h: processingWindow(sortedPerfEvents, nowMs, 6 * 60 * 60_000),
				window24h: processingWindow(sortedPerfEvents, nowMs, 24 * 60 * 60_000),
				window7d: processingWindow(
					sortedPerfEvents,
					nowMs,
					7 * 24 * 60 * 60_000,
				),
			},
		},
	};
}
let perfEventCache: {
	expiresAt: number;
	events: PerfEvent[];
	source: "aggregate" | "logs";
	lastRebuildAt: string;
} | null = null;
