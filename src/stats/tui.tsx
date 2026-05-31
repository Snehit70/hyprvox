import { watch } from "node:fs";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useTerminalDimensions } from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StatsSummary } from "./summary";
import { exportSnapshot, readStatsUiConfig, resolveWatchPaths } from "./tui-io";
import {
	nextFilter,
	nextTab,
	prevTab,
	type StatsFilter,
	type StatsTab,
	type StatsWindowPreset,
} from "./tui-model";
import {
	buildRecentRows,
	type RecentLocalFilter,
	type RecentSortMode,
} from "./tui-recent";
import { StatsDashboardView, StatsLoadingView, tabLabel } from "./tui-view";
import {
	DEFAULT_UI_STATE,
	loadStatsUiState,
	saveStatsUiState,
} from "./ui-state";

const AUTO_REFRESH_MS = 5000;
const WATCH_DEBOUNCE_MS = 300;

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
	const [filter, setFilter] = useState<StatsFilter>(
		DEFAULT_UI_STATE.filter as StatsFilter,
	);
	const [statusMessage, setStatusMessage] = useState("ready");
	const [pendingExport, setPendingExport] = useState<null | "json" | "md">(
		null,
	);
	const [pendingExportScope, setPendingExportScope] = useState<
		"tab" | "global"
	>("tab");
	const [filterPrompt, setFilterPrompt] = useState(false);
	const [recentOffset, setRecentOffset] = useState(0);
	const [recentSelectedIndex, setRecentSelectedIndex] = useState(0);
	const [recentSelectedKey, setRecentSelectedKey] = useState<string | null>(
		null,
	);
	const [recentSortMode, setRecentSortMode] =
		useState<RecentSortMode>("severity");
	const [recentLocalFilter, setRecentLocalFilter] =
		useState<RecentLocalFilter>("all");
	const [recentFilterPrompt, setRecentFilterPrompt] = useState(false);
	const [activeTab, setActiveTab] = useState<StatsTab>(
		DEFAULT_UI_STATE.activeTab,
	);
	const [windowPreset, setWindowPreset] = useState<StatsWindowPreset>(
		DEFAULT_UI_STATE.windowPreset,
	);
	const [loadedTabs, setLoadedTabs] = useState<Set<StatsTab>>(
		new Set(["overview"]),
	);
	const [degradedMode, setDegradedMode] = useState(false);
	const statsUiConfig = useMemo(() => readStatsUiConfig(), []);
	const watchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const minSampleSize = statsUiConfig.minSampleSize;

	const refresh = useCallback(() => {
		void loadSummary()
			.then((data) => {
				const renderBeganAt = Date.now();
				setSummary(data);
				setLastRefreshAt(Date.now());
				setTtfpMs((current) => current ?? Date.now() - startedAtMs);
				setDegradedMode(
					Date.now() - renderBeganAt > statsUiConfig.renderBudgetMs,
				);
			})
			.catch((error) => {
				setStatusMessage(`refresh failed: ${(error as Error).message}`);
			});
	}, [loadSummary, startedAtMs, statsUiConfig.renderBudgetMs]);

	useEffect(() => {
		void loadStatsUiState().then((state) => {
			setActiveTab(state.activeTab);
			setWindowPreset(state.windowPreset);
			setFilter((state.filter as StatsFilter) ?? "all");
			setLoadedTabs(new Set(["overview", state.activeTab]));
		});
		refresh();
	}, [refresh]);

	useEffect(() => {
		void saveStatsUiState({ activeTab, windowPreset, filter });
	}, [activeTab, filter, windowPreset]);

	useEffect(() => {
		const timer = globalThis.setInterval(() => {
			if (!autoRefresh) return;
			refresh();
		}, AUTO_REFRESH_MS);
		return () => globalThis.clearInterval(timer);
	}, [autoRefresh, refresh]);

	const watchPaths = useMemo(
		() => (summary ? resolveWatchPaths(summary) : []),
		[summary],
	);

	useEffect(() => {
		if (watchPaths.length === 0) return;
		const watchers: Array<{ close: () => void }> = [];

		for (const path of watchPaths) {
			try {
				const watcher = watch(path, () => {
					if (watchTimer.current) clearTimeout(watchTimer.current);
					watchTimer.current = setTimeout(() => {
						setStatusMessage("event update");
						refresh();
					}, WATCH_DEBOUNCE_MS);
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
	}, [watchPaths, refresh]);

	useEffect(() => {
		if (!loadedTabs.has(activeTab)) {
			setLoadedTabs((prev) => new Set([...prev, activeTab]));
			setStatusMessage(`loaded ${tabLabel(activeTab)}`);
			void loadSummary().then((data) => setSummary(data));
		}
	}, [activeTab, loadedTabs, loadSummary]);

	const rowsPerPage = Math.max(8, Math.min(12, height - 24));
	const recentRows = useMemo(() => {
		return summary
			? buildRecentRows(summary, recentSortMode, recentLocalFilter)
			: [];
	}, [summary, recentSortMode, recentLocalFilter]);

	useEffect(() => {
		if (recentRows.length === 0) {
			setRecentSelectedIndex(0);
			setRecentSelectedKey(null);
			setRecentOffset(0);
			return;
		}
		if (recentSelectedKey) {
			const idx = recentRows.findIndex((row) => row.key === recentSelectedKey);
			if (idx >= 0) {
				setRecentSelectedIndex(idx);
				if (idx < recentOffset) setRecentOffset(idx);
				if (idx >= recentOffset + rowsPerPage)
					setRecentOffset(Math.max(0, idx - rowsPerPage + 1));
				return;
			}
		}
		const nextIdx = Math.min(recentSelectedIndex, recentRows.length - 1);
		setRecentSelectedIndex(nextIdx);
		setRecentSelectedKey(recentRows[nextIdx]?.key ?? null);
		if (nextIdx < recentOffset) setRecentOffset(nextIdx);
		if (nextIdx >= recentOffset + rowsPerPage)
			setRecentOffset(Math.max(0, nextIdx - rowsPerPage + 1));
	}, [
		recentRows,
		recentSelectedKey,
		recentSelectedIndex,
		recentOffset,
		rowsPerPage,
	]);

	useEffect(() => {
		const onKey = (chunk: Buffer) => {
			const key = chunk.toString();
			if (pendingExport) {
				if (key.toLowerCase() === "y" && summary) {
					void exportSnapshot(
						summary,
						pendingExport,
						pendingExportScope,
						activeTab,
					)
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
			if (recentFilterPrompt) {
				let next: RecentLocalFilter | null = null;
				if (key === "1") next = "all";
				if (key === "2") next = "bad";
				if (key === "3") next = "warn";
				if (key === "4") next = "good";
				if (next) {
					setRecentLocalFilter(next);
					setStatusMessage(`recent filter: ${next}`);
				}
				setRecentFilterPrompt(false);
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
			if (key === "j") {
				setRecentSelectedIndex((current) => {
					const next = Math.min(
						current + 1,
						Math.max(0, recentRows.length - 1),
					);
					setRecentSelectedKey(recentRows[next]?.key ?? null);
					if (next >= recentOffset + rowsPerPage)
						setRecentOffset(next - rowsPerPage + 1);
					return next;
				});
			}
			if (key === "k") {
				setRecentSelectedIndex((current) => {
					const next = Math.max(0, current - 1);
					setRecentSelectedKey(recentRows[next]?.key ?? null);
					if (next < recentOffset) setRecentOffset(next);
					return next;
				});
			}
			if (key === "u")
				setRecentOffset((current) => Math.max(0, current - rowsPerPage));
			if (key === "d") {
				setRecentOffset((current) =>
					Math.min(
						Math.max(0, recentRows.length - rowsPerPage),
						current + rowsPerPage,
					),
				);
			}
			if (key === "g") setRecentOffset(0);
			if (key === "G") {
				setRecentOffset(Math.max(0, recentRows.length - rowsPerPage));
			}
			if (key === "n")
				setRecentSortMode((current) =>
					current === "severity" ? "newest" : "severity",
				);
			if (key === "v") setRecentFilterPrompt(true);
			if (key === "x") {
				const selected = recentRows[recentSelectedIndex];
				if (selected && summary) {
					void exportSnapshot(
						{
							...summary,
							recent: [selected.item],
						},
						"json",
						"tab",
						"overview",
					)
						.then((path) => setStatusMessage(`row exported: ${path}`))
						.catch((error) =>
							setStatusMessage(
								`row export failed: ${(error as Error).message}`,
							),
						);
				}
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
		filterPrompt,
		onQuit,
		pendingExport,
		pendingExportScope,
		recentFilterPrompt,
		recentOffset,
		recentRows,
		recentSelectedIndex,
		rowsPerPage,
		summary,
		windowPreset,
		refresh,
	]);

	if (!summary) {
		return <StatsLoadingView width={width} height={height} />;
	}

	return (
		<StatsDashboardView
			width={width}
			height={height}
			summary={summary}
			activeTab={activeTab}
			filter={filter}
			autoRefresh={autoRefresh}
			ttfpMs={ttfpMs}
			windowPreset={windowPreset}
			recentSortMode={recentSortMode}
			recentLocalFilter={recentLocalFilter}
			recentRows={recentRows}
			recentOffset={recentOffset}
			rowsPerPage={rowsPerPage}
			recentSelectedIndex={recentSelectedIndex}
			minSampleSize={minSampleSize}
			lastRefreshAt={lastRefreshAt}
			degradedMode={degradedMode}
			pendingExport={pendingExport}
			filterPrompt={filterPrompt}
			recentFilterPrompt={recentFilterPrompt}
			statusMessage={statusMessage}
		/>
	);
}

export async function runStatsTui(
	loadSummary: () => Promise<StatsSummary>,
): Promise<void> {
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
