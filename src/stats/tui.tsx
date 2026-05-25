import { TextAttributes, createCliRenderer } from "@opentui/core";
import { createRoot, useTerminalDimensions } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import type { StatsSummary } from "./summary";
import {
	age,
	computePaneWidths,
	daemonState,
	errorState,
	latencyState,
	ms,
	recentLatencySparkline,
	seconds,
	truncate,
} from "./tui-model";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const SPINNER_INTERVAL_MS = 1000 / 10;
const AUTO_REFRESH_MS = 5000;

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
};

function stateColor(state: "GOOD" | "WARN" | "BAD" | "UNKNOWN"): string {
	if (state === "GOOD") return colors.ok;
	if (state === "WARN") return colors.warn;
	if (state === "BAD") return colors.bad;
	return colors.muted;
}

function StatusBadge({ label, state }: { label: string; state: "GOOD" | "WARN" | "BAD" | "UNKNOWN" }) {
	return (
		<text fg={stateColor(state)}>
			{label} [{state}]
		</text>
	);
}

function Section({
	title,
	children,
	height,
}: {
	title: string;
	children: React.ReactNode;
	height?: number | string;
}) {
	return (
		<box
			border
			borderColor={colors.border}
			backgroundColor={colors.panel}
			flexDirection="column"
			paddingLeft={1}
			paddingRight={1}
			paddingTop={0}
			paddingBottom={0}
			{...(height ? { height } : {})}
		>
			<box height={1}>
				<text fg={colors.accent} attributes={TextAttributes.BOLD}>
					{title}
				</text>
			</box>
			{children}
		</box>
	);
}

function StatApp({
	loadSummary,
	onCommand,
	onQuit,
	startedAtMs,
}: {
	loadSummary: () => Promise<StatsSummary>;
	onCommand: (cmd: "health" | "logs" | "errors") => void;
	onQuit: () => void;
	startedAtMs: number;
}) {
	const { width, height } = useTerminalDimensions();
	const [summary, setSummary] = useState<StatsSummary | null>(null);
	const [frame, setFrame] = useState(0);
	const [autoRefresh, setAutoRefresh] = useState(true);
	const [showHelp, setShowHelp] = useState(false);
	const [lastRefreshAt, setLastRefreshAt] = useState(Date.now());
	const [ttfpMs, setTtfpMs] = useState<number | null>(null);

	useEffect(() => {
		void loadSummary().then((data) => {
			setSummary(data);
			setLastRefreshAt(Date.now());
		});
	}, [loadSummary]);

	useEffect(() => {
		const timer = globalThis.setInterval(
			() => setFrame((current) => current + 1),
			SPINNER_INTERVAL_MS,
		);
		return () => globalThis.clearInterval(timer);
	}, []);

	useEffect(() => {
		const timer = globalThis.setInterval(() => {
			if (!autoRefresh) return;
			void loadSummary().then((data) => {
				setSummary(data);
				setLastRefreshAt(Date.now());
			});
		}, AUTO_REFRESH_MS);
		return () => globalThis.clearInterval(timer);
	}, [autoRefresh, loadSummary]);

	useEffect(() => {
		const onKey = (chunk: Buffer) => {
			const key = chunk.toString();
			if (key === "q" || key === "\u0003") onQuit();
			if (key === "a") setAutoRefresh((current) => !current);
			if (key === "?") setShowHelp((current) => !current);
			if (key === "r") {
				void loadSummary().then((data) => {
					setSummary(data);
					setLastRefreshAt(Date.now());
				});
			}
			if (key === "h") onCommand("health");
			if (key === "l") onCommand("logs");
			if (key === "e") onCommand("errors");
		};
		process.stdin.setRawMode?.(true);
		process.stdin.resume();
		process.stdin.on("data", onKey);
		return () => {
			process.stdin.off("data", onKey);
		};
	}, [loadSummary, onCommand, onQuit]);

	const spin = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? "•";
	const latencyHealth = latencyState(summary?.latency.p95Ms ?? null);
	const errorHealth = errorState(summary?.errors.count ?? 0);
	const daemonHealth = daemonState(summary?.daemon.status ?? "stopped");

	const recentLatencySpark = useMemo(() => {
		if (!summary) return "";
		return recentLatencySparkline(summary, 24);
	}, [summary]);

	useEffect(() => {
		if (!summary || ttfpMs !== null) return;
		setTtfpMs(Date.now() - startedAtMs);
	}, [summary, ttfpMs, startedAtMs]);

	if (!summary) {
		return (
			<box width={width} height={height} backgroundColor={colors.bg} paddingLeft={2} paddingTop={1}>
				<text fg={colors.muted}>
					{spin} loading stats...
				</text>
			</box>
		);
	}

	const { left: computedLeft, right: computedRight } = computePaneWidths(width);
	const isNarrow = width < 110;
	const leftWidth = isNarrow ? Math.max(40, width - 4) : computedLeft;
	const rightWidth = isNarrow ? Math.max(40, width - 4) : computedRight;

	return (
		<box width={width} height={height} backgroundColor={colors.bg} flexDirection="column">
			<box
				height={3}
				borderBottom
				borderColor={colors.border}
				paddingLeft={1}
				paddingRight={1}
				alignItems="center"
				justifyContent="space-between"
			>
				<text fg={colors.text} attributes={TextAttributes.BOLD}>
					hyprvox stats
				</text>
				<text fg={colors.muted}>
					{spin} {autoRefresh ? "auto:on" : "auto:off"} updated{" "}
					{new Date(summary.generatedAt).toLocaleTimeString()}{" "}
					{ttfpMs !== null ? `ttfp ${ttfpMs}ms` : ""}
				</text>
			</box>

			<box
				flexDirection={isNarrow ? "column" : "row"}
				flexGrow={1}
				paddingLeft={1}
				paddingRight={1}
				paddingTop={1}
				paddingBottom={1}
				gap={1}
			>
				<box width={leftWidth} flexDirection="column" gap={1}>
					<Section title="Overview" height={8}>
						<text fg={colors.text}>
							Today {summary.counts.today}   Total {summary.counts.total}   History {summary.counts.history}
						</text>
						<text fg={colors.text}>
							Latency median {ms(summary.latency.medianMs)}   p95 {ms(summary.latency.p95Ms)}   avg {ms(summary.latency.averageMs)}
						</text>
						<text fg={colors.text}>
							Duration avg {seconds(summary.duration.averageSeconds)}   S/M/L {summary.duration.shortCount}/{summary.duration.mediumCount}/{summary.duration.longCount}
						</text>
						<text fg={colors.muted}>
							Pulse {recentLatencySpark || "n/a"}   refreshed {age(Date.now() - lastRefreshAt)} ago
						</text>
					</Section>

					<Section title="Recent Transcriptions" height={isNarrow ? 11 : height - 16}>
						<text fg={colors.muted}>Time      Engine        Latency  Text</text>
						{summary.recent.slice(0, 8).map((item, index) => {
							const time = new Date(item.timestamp).toLocaleTimeString([], {
								hour: "2-digit",
								minute: "2-digit",
							});
							return (
								<text key={`${item.timestamp}-${index}`} fg={colors.text}>
									{truncate(
										`${time.padEnd(8)}  ${truncate(item.engine, 12).padEnd(12)}  ${ms(item.processingTime).padEnd(7)}  ${item.text}`,
										Math.max(24, leftWidth - 6),
									)}
								</text>
							);
						})}
					</Section>
				</box>

				<box width={rightWidth} flexDirection="column" gap={1}>
					<Section title="Health" height={8}>
						<StatusBadge label={`Daemon: ${summary.daemon.status}`} state={daemonHealth} />
						<StatusBadge label={`Errors: ${summary.errors.count}`} state={errorHealth} />
						<StatusBadge label={`Latency p95: ${ms(summary.latency.p95Ms)}`} state={latencyHealth} />
					</Section>

					<Section title="Engines" height={8}>
						{Object.entries(summary.engines)
							.sort((a, b) => b[1] - a[1])
							.slice(0, 4)
							.map(([engine, count]) => {
								const max = Math.max(
									1,
									...Object.values(summary.engines).map((value) => value),
								);
								const barW = Math.max(4, Math.floor(((rightWidth - 20) * count) / max));
								return (
									<text key={engine} fg={colors.text}>
										{truncate(engine, 12).padEnd(12)} {String(count).padStart(4)} {"█".repeat(barW)}
									</text>
								);
							})}
					</Section>

					<Section title="Runtime" height={10}>
						<text fg={colors.text}>
							Daemon: {summary.daemon.status}
							{summary.daemon.pid ? ` (${summary.daemon.pid})` : ""}
						</text>
						<text fg={colors.text}>Errors: {summary.errors.count}</text>
						<text fg={colors.muted}>
							Latest: {truncate(summary.errors.latest ?? "none", Math.max(16, rightWidth - 12))}
						</text>
						{summary.errors.recent.length > 0 ? (
							<text fg={colors.muted}>Recent:</text>
						) : null}
						{summary.errors.recent.map((item, index) => (
							<text key={`${item.timestamp}-${index}`} fg={colors.muted}>
								{truncate(
									`${new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ${item.message}`,
									Math.max(16, rightWidth - 12),
								)}
							</text>
						))}
						<text fg={colors.muted}>
							Config: {truncate(summary.paths.config, Math.max(16, rightWidth - 12))}
						</text>
					</Section>

					<Section title="Controls" height={showHelp ? 9 : 5}>
						<text fg={colors.muted}>q quit   r refresh   a auto-refresh</text>
						<text fg={colors.muted}>h health l logs      e errors</text>
						<text fg={colors.muted}>? help</text>
						{showHelp ? (
							<text fg={colors.text}>Live view with auto-refresh and command jumps.</text>
						) : null}
					</Section>
				</box>
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

	const runAndExit = (cmd: "health" | "logs" | "errors") => {
		renderer.destroy();
		Bun.spawn([process.argv[0], process.argv[1] ?? "index.ts", cmd], {
			stdio: ["inherit", "inherit", "inherit"],
		});
	};

	const quit = () => {
		renderer.destroy();
		process.exit(0);
	};

	renderer.start();
	createRoot(renderer).render(
		<StatApp
			loadSummary={loadSummary}
			onCommand={runAndExit}
			onQuit={quit}
			startedAtMs={startedAtMs}
		/>,
	);
}
