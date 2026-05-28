import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { TextAttributes, createCliRenderer } from "@opentui/core";
import { createRoot, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StatsSummary } from "./summary";
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
	type StatsFilter,
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

async function exportSnapshot(
	summary: StatsSummary,
	format: "json" | "md",
): Promise<string> {
	const exportDir = join(homedir(), ".config", "hypr", "vox", "exports");
	await mkdir(exportDir, { recursive: true, mode: 0o700 });
	const stamp = new Date().toISOString().replace(/[.:]/g, "-");
	const path = join(exportDir, `stats-${stamp}.${format}`);
	if (format === "json") {
		await writeFile(path, JSON.stringify(summary, null, 2), { mode: 0o600 });
	} else {
		const md = [
			"# Hyprvox Stats Snapshot",
			`Generated: ${summary.generatedAt}`,
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
	const [filter, setFilter] = useState<StatsFilter>("all");
	const [statusMessage, setStatusMessage] = useState("ready");
	const [pendingExport, setPendingExport] = useState<null | "json" | "md">(null);
	const [filterPrompt, setFilterPrompt] = useState(false);
	const [recentOffset, setRecentOffset] = useState(0);
	const watchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const refresh = () => {
		void loadSummary()
			.then((data) => {
				setSummary(data);
				setLastRefreshAt(Date.now());
				if (ttfpMs === null) setTtfpMs(Date.now() - startedAtMs);
			})
			.catch((error) => {
				setStatusMessage(`refresh failed: ${(error as Error).message}`);
			});
	};

	useEffect(() => {
		refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

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
		const watchPaths = [
			summary.paths.history,
			summary.paths.logs,
			join(homedir(), ".config", "hypr", "vox", "daemon.state"),
		].filter((p): p is string => Boolean(p));

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
		const onKey = (chunk: Buffer) => {
			const key = chunk.toString();
			if (pendingExport) {
				if (key.toLowerCase() === "y" && summary) {
					void exportSnapshot(summary, pendingExport)
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
				if (key === "1") setFilter("all");
				if (key === "2") setFilter("quality");
				if (key === "3") setFilter("latency");
				if (key === "4") setFilter("errors");
				if (key === "5") setFilter("fallbacks");
				setFilterPrompt(false);
				setStatusMessage(`filter: ${filter}`);
				return;
			}

			if (key === "q" || key === "\u0003") onQuit();
			if (key === "r") refresh();
			if (key === "a") setAutoRefresh((current) => !current);
			if (key === "f") setFilter((current) => nextFilter(current));
			if (key === "/") setFilterPrompt(true);
			if (key === "e") {
				setPendingExport("json");
				setStatusMessage("Export JSON snapshot? y/N");
			}
			if (key === "E") {
				setPendingExport("md");
				setStatusMessage("Export markdown snapshot? y/N");
			}
			if (key === "j") setRecentOffset((current) => current + 1);
			if (key === "k") setRecentOffset((current) => Math.max(0, current - 1));
			if (key === "g") setRecentOffset(0);
			if (key === "G" && summary) {
				setRecentOffset(Math.max(0, summary.recent.length - 1));
			}
		};

		process.stdin.setRawMode?.(true);
		process.stdin.resume();
		process.stdin.on("data", onKey);
		return () => {
			process.stdin.off("data", onKey);
		};
	}, [filter, filterPrompt, onQuit, pendingExport, summary]);

	const p0 = summary ? overallP0(summary) : "UNKNOWN";
	const recentLatencySpark = useMemo(() => {
		if (!summary) return "";
		return recentLatencySparkline(summary, 24);
	}, [summary]);

	if (!summary) {
		return (
			<box width={width} height={height} backgroundColor={colors.bg} paddingLeft={2} paddingTop={1}>
				<text fg={colors.muted}>loading stats...</text>
			</box>
		);
	}

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
		.slice(0, 4);

	return (
		<box width={width} height={height} backgroundColor={colors.bg} flexDirection="column">
			<box
				height={2}
				borderBottom
				borderColor={colors.border}
				paddingLeft={1}
				paddingRight={1}
				justifyContent="space-between"
			>
				<text fg={colors.text} attributes={TextAttributes.BOLD}>
					hyprvox stats | p0 {p0} | filter {filter}
				</text>
				<text fg={colors.muted}>
					updated {new Date(summary.generatedAt).toLocaleTimeString()} | {autoRefresh ? "auto:on" : "auto:off"} | ttfp {ttfpMs ?? 0}ms
				</text>
			</box>

			<box height={3} paddingLeft={1} paddingRight={1} alignItems="center" gap={2}>
				<text fg={stateColor(daemonHealth)}>daemon {summary.daemon.status}</text>
				<text fg={stateColor(latencyHealth)}>p95 {ms(summary.latency.p95Ms)}</text>
				<text fg={stateColor(errorHealth)}>errors {summary.errors.count}</text>
				<text fg={stateColor(qualityHealth)}>quality24h {summary.quality.total24h}</text>
				<text fg={summary.quality.spike ? colors.bad : colors.muted}>
					{summary.quality.spike ? "quality spike" : "stable"}
				</text>
			</box>

			<box flexDirection="row" paddingLeft={1} paddingRight={1} gap={1} flexGrow={1}>
				<box width={Math.max(58, Math.floor(width * 0.58))} flexDirection="column" gap={1}>
					<Section title="Runtime Overview" height={8}>
						<text fg={colors.text}>
							Today {summary.counts.today} | Total {summary.counts.total} | History {summary.counts.history}
						</text>
						<text fg={colors.text}>
							Latency median {ms(summary.latency.medianMs)} | p95 {ms(summary.latency.p95Ms)} | avg {ms(summary.latency.averageMs)}
						</text>
						<text fg={colors.text}>
							Duration avg {seconds(summary.duration.averageSeconds)} | S/M/L {summary.duration.shortCount}/{summary.duration.mediumCount}/{summary.duration.longCount}
						</text>
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
						{textIfEmpty(recentPage.length === 0, "No matching sessions for current filter.")}
					</Section>
				</box>

				<box flexDirection="column" flexGrow={1} gap={1}>
					<Section title="Quality / Pipeline" height={10}>
						<text fg={colors.text}>prompt_artifact {summary.quality.window24h.prompt_artifact}</text>
						<text fg={colors.text}>token_injection {summary.quality.window24h.token_injection}</text>
						<text fg={colors.text}>cot_meta {summary.quality.window24h.cot_meta}</text>
						<text fg={colors.text}>fallback none/groq/deepgram {summary.pipeline.fallbacks24h.none}/{summary.pipeline.fallbacks24h.groq}/{summary.pipeline.fallbacks24h.deepgram}</text>
						<text fg={colors.text}>validation retries 24h {summary.pipeline.validationRetries24h}</text>
					</Section>

					<Section title="Merge Strategy (24h)" height={8}>
						{topStrategies.map(([name, count]) => (
							<text key={name} fg={colors.text}>{truncate(name, 24).padEnd(24)} {String(count).padStart(5)}</text>
						))}
						{textIfEmpty(topStrategies.length === 0, "No perf strategy data in logs.")}
					</Section>

					<Section title="Regression Detector" height={8}>
						<text fg={colors.text}>1h sessions {summary.regression.window1hCount}</text>
						<text fg={colors.text}>24h sessions {summary.regression.window24hCount}</text>
						<text fg={colors.text}>7d baseline sessions {summary.regression.baseline7dCount}</text>
						<text fg={summary.regression.flags.length > 0 ? colors.warn : colors.ok}>
							flags: {summary.regression.flags.join(", ") || "none"}
						</text>
					</Section>
				</box>
			</box>

			<box height={3} borderTop borderColor={colors.border} paddingLeft={1} paddingRight={1}>
				<text fg={colors.muted}>
					hotkeys: q quit | r refresh | a auto | / filter prompt | f next filter | j/k scroll | g/G jump | e export json | E export md
				</text>
			</box>
			<box height={1} paddingLeft={1}>
				<text fg={pendingExport ? colors.warn : filterPrompt ? colors.info : colors.muted}>
					{filterPrompt
						? "filter: 1 all, 2 quality, 3 latency, 4 errors, 5 fallbacks"
						: pendingExport
							? "confirm export: y/N"
							: statusMessage}
				</text>
			</box>
		</box>
	);
}

function textIfEmpty(condition: boolean, message: string): React.ReactNode {
	if (!condition) return null;
	return <text fg={colors.muted}>{message}</text>;
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
