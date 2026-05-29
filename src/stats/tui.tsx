import { mkdir, writeFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { TextAttributes, createCliRenderer } from "@opentui/core";
import { createRoot, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadConfig } from "../config/loader";
import { DEFAULT_UI_STATE, loadStatsUiState, saveStatsUiState } from "./ui-state";
import type { StatsSummary } from "./summary";
import {
	age,
	confidenceLabel,
	detectAnomalies,
	daemonState,
	errorState,
	latencyState,
	ms,
	nextFilter,
	nextTab,
	overallP0,
	prevTab,
	qualityState,
	recentLatencySparkline,
	seconds,
	sparkline,
	type StatsFilter,
	type StatsTab,
	type StatsWindowPreset,
	truncate,
} from "./tui-model";

const AUTO_REFRESH_MS = 5000;
const WATCH_DEBOUNCE_MS = 300;
const colors = {
	bg: "#101218",
	panel: "#171a22",
	border: "#2b3140",
	text: "#d7dce7",
	muted: "#8b94a8",
	accent: "#e8b15f",
	ok: "#7dd488",
	warn: "#f1c27a",
	bad: "#f28b82",
	info: "#8ab4f8",
};

function stateColor(state: "GOOD" | "WARN" | "BAD" | "UNKNOWN"): string {
	if (state === "GOOD") return colors.ok;
	if (state === "WARN") return colors.warn;
	if (state === "BAD") return colors.bad;
	return colors.muted;
}

function Section({
	title,
	children,
	height,
}: {
	title: string;
	children: React.ReactNode;
	height?: number;
}) {
	return (
		<box
			border
			borderColor={colors.border}
			backgroundColor={colors.panel}
			flexDirection="column"
			paddingLeft={1}
			paddingRight={1}
			{...(height ? { height } : {})}
		>
			<text fg={colors.accent} attributes={TextAttributes.BOLD}>
				{title}
			</text>
			{children}
		</box>
	);
}

function tabLabel(tab: StatsTab): string {
	if (tab === "overview") return "Overview";
	if (tab === "quality") return "Quality";
	if (tab === "pipeline") return "Pipeline";
	if (tab === "trends") return "Trends";
	return "Exports";
}

async function exportSnapshot(
	summary: StatsSummary,
	format: "json" | "md",
	scope: "tab" | "global",
	tab: StatsTab,
): Promise<string> {
	const exportDir = join(homedir(), ".config", "hypr", "vox", "exports");
	await mkdir(exportDir, { recursive: true, mode: 0o700 });
	const stamp = new Date().toISOString().replace(/[.:]/g, "-");
	const suffix = scope === "tab" ? `-${tab}` : "-global";
	const path = join(exportDir, `stats-${stamp}${suffix}.${format}`);
	const payload = scope === "global" ? summary : { tab, generatedAt: summary.generatedAt, summary };
	if (format === "json") {
		await writeFile(path, JSON.stringify(payload, null, 2), { mode: 0o600 });
	} else {
		const md = [
			"# Hyprvox Stats Snapshot",
			`Generated: ${summary.generatedAt}`,
			`Scope: ${scope} (${tab})`,
			`P0: ${overallP0(summary)}`,
			`Latency p95: ${ms(summary.latency.p95Ms)}`,
			`Errors: ${summary.errors.count}`,
			`Quality failures 24h: ${summary.quality.total24h}`,
			`Regression flags: ${summary.regression.flags.join(", ") || "none"}`,
		].join("\n");
		await writeFile(path, md, { mode: 0o600 });
	}
	return path;
}

function filterByWindow(summary: StatsSummary, preset: StatsWindowPreset): number[] {
	if (preset === "15m") return summary.trends.processingMs.window15m;
	if (preset === "1h") return summary.trends.processingMs.window1h;
	if (preset === "6h") return summary.trends.processingMs.window6h;
	if (preset === "24h") return summary.trends.processingMs.window24h;
	return summary.trends.processingMs.window7d;
}

function readStatsUiConfig(): { renderBudgetMs: number; minSampleSize: number } {
	try {
		const cfg = loadConfig() as {
			transcription?: {
				statsRenderBudgetMs?: number;
				statsMinSampleSize?: number;
			};
		};
		const renderBudgetMs = cfg.transcription?.statsRenderBudgetMs;
		const minSampleSize = cfg.transcription?.statsMinSampleSize;
		return {
			renderBudgetMs:
				typeof renderBudgetMs === "number" && Number.isFinite(renderBudgetMs)
					? renderBudgetMs
					: 50,
			minSampleSize:
				typeof minSampleSize === "number" && Number.isFinite(minSampleSize)
					? minSampleSize
					: 10,
		};
	} catch {
		return { renderBudgetMs: 50, minSampleSize: 10 };
	}
}

function resolveWatchPaths(summary: StatsSummary): string[] {
	const base = [
		summary.paths.history,
		summary.paths.logs,
		join(homedir(), ".config", "hypr", "vox", "daemon.state"),
	].filter((p): p is string => Boolean(p));
	const expanded = new Set<string>(base);
	for (const path of base) {
		try {
			if (!statSync(path).isDirectory()) continue;
			for (const file of readdirSync(path)) {
				if (!file.endsWith(".log")) continue;
				expanded.add(join(path, file));
			}
		} catch {
			// Ignore paths that cannot be expanded.
		}
	}
	return [...expanded];
}

function StatApp({
	loadSummary,
	onQuit,
	startedAtMs,
}: {
	loadSummary: () => Promise<StatsSummary>;
	onQuit: () => void;
	startedAtMs: number;
}) {
	const { width, height } = useTerminalDimensions();
	const [summary, setSummary] = useState<StatsSummary | null>(null);
	const [autoRefresh, setAutoRefresh] = useState(true);
	const [lastRefreshAt, setLastRefreshAt] = useState(Date.now());
	const [ttfpMs, setTtfpMs] = useState<number | null>(null);
	const [filter, setFilter] = useState<StatsFilter>(DEFAULT_UI_STATE.filter as StatsFilter);
	const [statusMessage, setStatusMessage] = useState("ready");
	const [pendingExport, setPendingExport] = useState<null | "json" | "md">(null);
	const [pendingExportScope, setPendingExportScope] = useState<"tab" | "global">("tab");
	const [filterPrompt, setFilterPrompt] = useState(false);
	const [recentOffset, setRecentOffset] = useState(0);
	const [activeTab, setActiveTab] = useState<StatsTab>(DEFAULT_UI_STATE.activeTab);
	const [windowPreset, setWindowPreset] = useState<StatsWindowPreset>(DEFAULT_UI_STATE.windowPreset);
	const [loadedTabs, setLoadedTabs] = useState<Set<StatsTab>>(new Set(["overview"]));
	const [degradedMode, setDegradedMode] = useState(false);
	const statsUiConfig = useMemo(() => readStatsUiConfig(), []);
	const watchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const minSampleSize = statsUiConfig.minSampleSize;

	const refresh = () => {
		void loadSummary()
			.then((data) => {
				const renderBeganAt = Date.now();
				setSummary(data);
				setLastRefreshAt(Date.now());
				if (ttfpMs === null) setTtfpMs(Date.now() - startedAtMs);
				setDegradedMode(Date.now() - renderBeganAt > statsUiConfig.renderBudgetMs);
			})
			.catch((error) => {
				setStatusMessage(`refresh failed: ${(error as Error).message}`);
			});
	};

	useEffect(() => {
		void loadStatsUiState().then((state) => {
			setActiveTab(state.activeTab);
			setWindowPreset(state.windowPreset);
			setFilter((state.filter as StatsFilter) ?? "all");
			setLoadedTabs(new Set(["overview", state.activeTab]));
		});
		refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		void saveStatsUiState({ activeTab, windowPreset, filter });
	}, [activeTab, filter, windowPreset]);

	useEffect(() => {
		const timer = globalThis.setInterval(() => {
			if (!autoRefresh) return;
			refresh();
		}, AUTO_REFRESH_MS);
		return () => globalThis.clearInterval(timer);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [autoRefresh]);

	useEffect(() => {
		if (!summary) return;
		const watchers: Array<{ close: () => void }> = [];
		const watchPaths = resolveWatchPaths(summary);

		for (const path of watchPaths) {
			try {
				const watcher = Bun.watch({
					path,
					onChange() {
						if (watchTimer.current) clearTimeout(watchTimer.current);
						watchTimer.current = setTimeout(() => {
							setStatusMessage("event update");
							refresh();
						}, WATCH_DEBOUNCE_MS);
					},
				});
				watchers.push(watcher);
			} catch {
				// Ignore unsupported watch path.
			}
		}

		return () => {
			for (const watcher of watchers) watcher.close();
			if (watchTimer.current) {
				clearTimeout(watchTimer.current);
				watchTimer.current = null;
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [summary?.paths.history, summary?.paths.logs]);

	useEffect(() => {
		if (!loadedTabs.has(activeTab)) {
			setLoadedTabs((prev) => new Set([...prev, activeTab]));
			setStatusMessage(`loaded ${tabLabel(activeTab)}`);
			void loadSummary().then((data) => setSummary(data));
		}
	}, [activeTab, loadedTabs, loadSummary]);

	useEffect(() => {
		const onKey = (chunk: Buffer) => {
			const key = chunk.toString();
			if (pendingExport) {
				if (key.toLowerCase() === "y" && summary) {
					void exportSnapshot(summary, pendingExport, pendingExportScope, activeTab)
						.then((path) => setStatusMessage(`exported: ${path}`))
						.catch((error) =>
							setStatusMessage(`export failed: ${(error as Error).message}`),
						);
					setPendingExport(null);
					return;
				}
				setPendingExport(null);
				setStatusMessage("export cancelled");
				return;
			}
			if (filterPrompt) {
				let next: StatsFilter | null = null;
				if (key === "1") next = "all";
				if (key === "2") next = "quality";
				if (key === "3") next = "latency";
				if (key === "4") next = "errors";
				if (key === "5") next = "fallbacks";
				if (next) {
					setFilter(next);
					setStatusMessage(`filter: ${next}`);
				}
				setFilterPrompt(false);
				return;
			}

			if (key === "q" || key === "\u0003") onQuit();
			if (key === "r") refresh();
			if (key === "a") setAutoRefresh((current) => !current);
			if (key === "f") setFilter((current) => nextFilter(current));
			if (key === "/") setFilterPrompt(true);
			if (key === "e") {
				setPendingExport("json");
				setPendingExportScope("tab");
				setStatusMessage("Export TAB JSON snapshot? y/N");
			}
			if (key === "E") {
				setPendingExport("md");
				setPendingExportScope("global");
				setStatusMessage("Export GLOBAL markdown snapshot? y/N");
			}
			if (key === "j") setRecentOffset((current) => current + 1);
			if (key === "k") setRecentOffset((current) => Math.max(0, current - 1));
			if (key === "g") setRecentOffset(0);
			if (key === "G" && summary) {
				setRecentOffset(Math.max(0, summary.recent.length - 1));
			}
			if (key === "h") setActiveTab((current) => prevTab(current));
			if (key === "l") setActiveTab((current) => nextTab(current));
			if (key === "1") setActiveTab("overview");
			if (key === "2") setActiveTab("quality");
			if (key === "3") setActiveTab("pipeline");
			if (key === "4") setActiveTab("trends");
			if (key === "5") setActiveTab("exports");
			if (key === "t") {
				const order: StatsWindowPreset[] = ["15m", "1h", "6h", "24h", "7d"];
				const idx = order.indexOf(windowPreset);
				setWindowPreset(order[(idx + 1) % order.length] ?? "1h");
			}
		};

		process.stdin.setRawMode?.(true);
		process.stdin.resume();
		process.stdin.on("data", onKey);
		return () => {
			process.stdin.off("data", onKey);
		};
	}, [
		activeTab,
		filter,
		filterPrompt,
		onQuit,
		pendingExport,
		pendingExportScope,
		summary,
		windowPreset,
	]);

	const p0 = summary ? overallP0(summary) : "UNKNOWN";

	if (!summary) {
		return (
			<box width={width} height={height} backgroundColor={colors.bg} paddingLeft={2} paddingTop={1}>
				<text fg={colors.muted}>loading stats...</text>
			</box>
		);
	}

	const anomalies = detectAnomalies(summary);

	const latencyHealth = latencyState(
		summary.latency.p95Ms,
		summary.thresholds.latencyP95WarnMs,
		summary.thresholds.latencyP95BadMs,
	);
	const errorHealth = errorState(
		summary.errors.count,
		summary.thresholds.errorWarnCount24h,
		summary.thresholds.errorBadCount24h,
	);
	const qualityHealth = qualityState(
		summary.quality.total24h,
		summary.thresholds.qualityWarnCount24h,
		summary.thresholds.qualityBadCount24h,
	);
	const daemonHealth = daemonState(summary.daemon.status);

	let filteredRecent = summary.recent;
	if (filter === "latency") {
		filteredRecent = summary.recent.filter(
			(item) => item.processingTime >= summary.thresholds.latencyP95WarnMs,
		);
	}
	if (filter === "errors") {
		filteredRecent = summary.recent.filter(() => summary.errors.count > 0);
	}
	const recentPage = filteredRecent.slice(recentOffset, recentOffset + 8);

	const topStrategies = Object.entries(summary.pipeline.mergeStrategies24h)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5);
	const topModels = Object.entries(summary.pipeline.modelRank24h)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5);

	const windowValues = filterByWindow(summary, windowPreset);
	const windowSpark = sparkline(windowValues, 36);
	const recentLatencySpark = recentLatencySparkline(summary, 24);

	return (
		<box width={width} height={height} backgroundColor={colors.bg} flexDirection="column">
			<box
				height={1}
				borderBottom
				borderColor={colors.border}
				paddingLeft={1}
				paddingRight={1}
				justifyContent="space-between"
			>
				<text fg={colors.text} attributes={TextAttributes.BOLD}>
					hyprvox stats | p0 {p0} | {tabLabel(activeTab)} | filter {filter}
				</text>
				<text fg={colors.muted}>
					{autoRefresh ? "auto:on" : "auto:off"} | ttfp {ttfpMs ?? 0}ms | upd {new Date(summary.generatedAt).toLocaleTimeString()}
				</text>
			</box>

			<box height={2} paddingLeft={1} gap={2}>
				<text fg={stateColor(daemonHealth)}>daemon {summary.daemon.status}</text>
				<text fg={stateColor(latencyHealth)}>p95 {ms(summary.latency.p95Ms)}</text>
				<text fg={stateColor(errorHealth)}>errors {summary.errors.count}</text>
				<text fg={stateColor(qualityHealth)}>quality24h {summary.quality.total24h}</text>
				<text fg={summary.quality.spike ? colors.bad : colors.muted}>
					{summary.quality.spike ? "quality spike" : "stable"}
				</text>
			</box>

			<box height={2} paddingLeft={1} gap={1}>
				{(["overview", "quality", "pipeline", "trends", "exports"] as StatsTab[]).map((tab, idx) => (
					<text
						key={tab}
						fg={activeTab === tab ? colors.bg : colors.text}
						bg={activeTab === tab ? colors.accent : undefined}
					>
						 {idx + 1}:{tabLabel(tab)} 
					</text>
				))}
			</box>

			<box flexDirection="row" paddingLeft={1} paddingRight={1} gap={1} flexGrow={1}>
				{activeTab === "overview" ? (
					<>
						<box width={Math.max(58, Math.floor(width * 0.62))} flexDirection="column" gap={1}>
							<Section title="Runtime Overview" height={8}>
								<text fg={colors.text}>Today {summary.counts.today} | Total {summary.counts.total} | History {summary.counts.history}</text>
								<text fg={colors.text}>Latency median {ms(summary.latency.medianMs)} | p95 {ms(summary.latency.p95Ms)} | avg {ms(summary.latency.averageMs)}</text>
								<text fg={colors.text}>Duration avg {seconds(summary.duration.averageSeconds)} | S/M/L {summary.duration.shortCount}/{summary.duration.mediumCount}/{summary.duration.longCount}</text>
								<text fg={colors.muted}>Pulse {recentLatencySpark || "n/a"} | refreshed {age(Date.now() - lastRefreshAt)} ago</text>
							</Section>
							<Section title="Recent Sessions" height={height - 18}>
								<text fg={colors.muted}>time   engine           latency   text</text>
								{recentPage.map((item, index) => (
									<text key={`${item.timestamp}-${index}`} fg={colors.text}>
										{truncate(
											`${new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).padEnd(6)} ${truncate(item.engine, 14).padEnd(14)} ${ms(item.processingTime).padEnd(8)} ${item.text}`,
											Math.max(24, Math.floor(width * 0.56)),
										)}
									</text>
								))}
							</Section>
						</box>
						<box flexDirection="column" flexGrow={1} gap={1}>
							<Section title="Anomaly Cards" height={degradedMode ? 7 : 10}>
								{anomalies.length === 0 ? (
									<text fg={colors.ok}>No anomalies detected.</text>
								) : (
									anomalies
										.slice(0, degradedMode ? 2 : 5)
										.map((item) => (
											<text key={item.key} fg={item.severity === "bad" ? colors.bad : colors.warn}>
												{truncate(item.message, Math.max(32, Math.floor(width * 0.34)))}
											</text>
										))
								)}
							</Section>
							{degradedMode ? null : (
							<Section title="Cache Health" height={8}>
								<text fg={colors.text}>source {summary.cache.source}</text>
								<text fg={colors.text}>hit-rate {(summary.cache.hitRate * 100).toFixed(0)}%</text>
								<text fg={colors.text}>event lag {ms(summary.cache.eventLagMs)}</text>
								<text fg={colors.text}>last rebuild {new Date(summary.cache.lastRebuildAt).toLocaleTimeString()}</text>
							</Section>
							)}
							{degradedMode ? null : (
							<Section title="Regression" height={8}>
								<text fg={colors.text}>1h sessions {summary.regression.window1hCount}</text>
								<text fg={colors.text}>24h sessions {summary.regression.window24hCount}</text>
								<text fg={colors.text}>7d baseline {summary.regression.baseline7dCount}</text>
								<text fg={summary.regression.flags.length > 0 ? colors.warn : colors.ok}>flags: {summary.regression.flags.join(", ") || "none"}</text>
							</Section>
							)}
						</box>
					</>
				) : null}

				{activeTab === "quality" ? (
					<box flexDirection="column" flexGrow={1} gap={1}>
					<Section title="Quality Rankings (24h)" height={degradedMode ? height - 14 : Math.max(12, Math.floor((height - 10) * 0.65))}>
						{Object.entries(summary.quality.window24h)
							.sort((a, b) => b[1] - a[1])
							.map(([name, count]) => (
								<text key={name} fg={colors.text}>
									{truncate(name, 24).padEnd(24)} {String(count).padStart(5)} [{confidenceLabel(count, minSampleSize)}]
								</text>
							))}
					</Section>
					{degradedMode ? null : (
						<Section title="Quality Drilldown" height={Math.max(8, Math.floor((height - 10) * 0.35))}>
							<text fg={colors.text}>Top issue: {Object.entries(summary.quality.window24h).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none"}</text>
							<text fg={colors.text}>Top issue count: {Object.entries(summary.quality.window24h).sort((a, b) => b[1] - a[1])[0]?.[1] ?? 0}</text>
							<text fg={colors.text}>Total quality failures: {summary.quality.total24h}</text>
							<text fg={summary.quality.spike ? colors.warn : colors.ok}>1h spike: {summary.quality.spike ? "yes" : "no"}</text>
						</Section>
					)}
					</box>
				) : null}

				{activeTab === "pipeline" ? (
					<box flexDirection="column" flexGrow={1} gap={1}>
						<Section title="Merge Strategy Ranking" height={10}>
							{topStrategies.map(([name, count]) => (
								<text key={name} fg={colors.text}>
									{truncate(name, 28).padEnd(28)} {String(count).padStart(5)} [{confidenceLabel(count, minSampleSize)}]
								</text>
							))}
						</Section>
						<Section title="Model Ranking (24h)" height={10}>
							{topModels.map(([name, count]) => (
								<text key={name} fg={colors.text}>
									{truncate(name, 28).padEnd(28)} {String(count).padStart(5)} [{confidenceLabel(count, minSampleSize)}]
								</text>
							))}
						</Section>
						<Section title="Fallbacks" height={degradedMode ? 6 : 8}>
							<text fg={colors.text}>none {summary.pipeline.fallbacks24h.none}</text>
							<text fg={colors.text}>groq {summary.pipeline.fallbacks24h.groq}</text>
							<text fg={colors.text}>deepgram {summary.pipeline.fallbacks24h.deepgram}</text>
							<text fg={colors.text}>validation retries {summary.pipeline.validationRetries24h}</text>
						</Section>
						{degradedMode ? null : (
							<Section title="Pipeline Drilldown" height={8}>
								<text fg={colors.text}>Top merge strategy: {topStrategies[0]?.[0] ?? "none"}</text>
								<text fg={colors.text}>Top model: {topModels[0]?.[0] ?? "unknown"}</text>
								<text fg={colors.text}>Model diversity (24h): {Object.keys(summary.pipeline.modelRank24h).length}</text>
							</Section>
						)}
					</box>
				) : null}

				{activeTab === "trends" ? (
					<box flexDirection="column" flexGrow={1} gap={1}>
						<Section title={`Trend Window ${windowPreset}`} height={10}>
							<text fg={colors.text}>Latency trend {windowSpark || "n/a"}</text>
							<text fg={colors.text}>samples {windowValues.length} [{confidenceLabel(windowValues.length, minSampleSize)}]</text>
							<text fg={colors.text}>window switch: t</text>
						</Section>
						<Section title="Anomaly Trend" height={degradedMode ? 6 : 8}>
							<text fg={colors.text}>anomaly count {anomalies.length}</text>
							<text fg={colors.text}>severity mix bad/warn {anomalies.filter((a) => a.severity === "bad").length}/{anomalies.filter((a) => a.severity === "warn").length}</text>
							<text fg={colors.muted}>high anomalies likely imply degraded reliability</text>
						</Section>
						<Section title="Thresholds" height={10}>
							<text fg={colors.text}>latency warn/bad {summary.thresholds.latencyP95WarnMs}/{summary.thresholds.latencyP95BadMs} ms</text>
							<text fg={colors.text}>error warn/bad {summary.thresholds.errorWarnCount24h}/{summary.thresholds.errorBadCount24h}</text>
							<text fg={colors.text}>quality warn/bad {summary.thresholds.qualityWarnCount24h}/{summary.thresholds.qualityBadCount24h}</text>
						</Section>
					</box>
				) : null}

				{activeTab === "exports" ? (
					<Section title="Export Controls" height={height - 9}>
						<text fg={colors.text}>e: export tab JSON (confirm y/N)</text>
						<text fg={colors.text}>E: export global markdown (confirm y/N)</text>
						<text fg={colors.text}>default path ~/.config/hypr/vox/exports/</text>
						<text fg={colors.muted}>Current tab: {tabLabel(activeTab)}</text>
					</Section>
				) : null}
			</box>

			<box height={3} borderTop borderColor={colors.border} paddingLeft={1} paddingRight={1}>
				<text fg={colors.muted}>
					hotkeys: q quit | 1-5 tabs | h/l nav | r refresh | a auto | / filter | j/k scroll | t window | e/E export
				</text>
			</box>
			<box height={1} paddingLeft={1}>
				<text fg={pendingExport ? colors.warn : filterPrompt ? colors.info : colors.muted}>
					{filterPrompt
						? "filter: 1 all, 2 quality, 3 latency, 4 errors, 5 fallbacks"
						: pendingExport
							? "confirm export: y/N"
							: `${statusMessage}${degradedMode ? " | degraded mode" : ""}`}
				</text>
			</box>
		</box>
	);
}

export async function runStatsTui(loadSummary: () => Promise<StatsSummary>): Promise<void> {
	const startedAtMs = Date.now();
	const renderer = await createCliRenderer({
		exitOnCtrlC: true,
		clearOnShutdown: true,
		screenMode: "alternate-screen",
		openConsoleOnError: true,
	});

	const quit = () => {
		renderer.destroy();
		process.exit(0);
	};

	renderer.start();
	createRoot(renderer).render(
		<StatApp
			loadSummary={loadSummary}
			onQuit={quit}
			startedAtMs={startedAtMs}
		/>,
	);
}
