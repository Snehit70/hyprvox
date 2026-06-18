import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import type { StatsSummary } from "./summary";
import { filterByWindow } from "./tui-io";
import {
	age,
	confidenceFromSample,
	confidenceLabel,
	daemonState,
	deltaPercent,
	detectAnomalies,
	errorState,
	latencyState,
	ms,
	overallHealth,
	percentile,
	qualityState,
	recentLatencySparkline,
	runtimeActionHint,
	type StatsFilter,
	type StatsTab,
	type StatsWindowPreset,
	sparkline,
	trendArrow,
	truncate,
} from "./tui-model";
import {
	chunkText,
	type RecentLocalFilter,
	type RecentSessionRow,
	type RecentSortMode,
} from "./tui-recent";

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
	children: ReactNode;
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

export function tabLabel(tab: StatsTab): string {
	if (tab === "overview") return "Overview";
	if (tab === "quality") return "Quality";
	if (tab === "pipeline") return "Pipeline";
	if (tab === "trends") return "Trends";
	return "Exports";
}

function rowColor(severity: RecentSessionRow["severity"]): string {
	if (severity === "bad") return colors.bad;
	if (severity === "warn") return colors.warn;
	return colors.muted;
}

export function StatsLoadingView({
	width,
	height,
}: {
	width: number;
	height: number;
}) {
	return (
		<box
			width={width}
			height={height}
			backgroundColor={colors.bg}
			paddingLeft={2}
			paddingTop={1}
		>
			<text fg={colors.muted}>loading stats...</text>
		</box>
	);
}

export interface StatsDashboardViewProps {
	width: number;
	height: number;
	summary: StatsSummary;
	activeTab: StatsTab;
	filter: StatsFilter;
	autoRefresh: boolean;
	ttfpMs: number | null;
	windowPreset: StatsWindowPreset;
	recentSortMode: RecentSortMode;
	recentLocalFilter: RecentLocalFilter;
	recentRows: RecentSessionRow[];
	recentOffset: number;
	rowsPerPage: number;
	recentSelectedIndex: number;
	minSampleSize: number;
	lastRefreshAt: number;
	degradedMode: boolean;
	pendingExport: null | "json" | "md";
	filterPrompt: boolean;
	recentFilterPrompt: boolean;
	statusMessage: string;
}

export function StatsDashboardView({
	width,
	height,
	summary,
	activeTab,
	filter,
	autoRefresh,
	ttfpMs,
	windowPreset,
	recentSortMode,
	recentLocalFilter,
	recentRows,
	recentOffset,
	rowsPerPage,
	recentSelectedIndex,
	minSampleSize,
	lastRefreshAt,
	degradedMode,
	pendingExport,
	filterPrompt,
	recentFilterPrompt,
	statusMessage,
}: StatsDashboardViewProps) {
	const health = overallHealth(summary);
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
	const selectedRecentRow =
		recentRows[
			Math.min(recentSelectedIndex, Math.max(0, recentRows.length - 1))
		] ?? null;
	const detailWidth = Math.max(24, Math.floor(width * 0.56) - 8);
	const detailLines = selectedRecentRow
		? chunkText(selectedRecentRow.item.text, detailWidth, 4)
		: [];
	const topStrategies = Object.entries(summary.pipeline.mergeStrategies24h)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5);
	const topModels = Object.entries(summary.pipeline.modelRank24h)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5);
	const windowValues = filterByWindow(summary, windowPreset);
	const windowSpark = sparkline(windowValues, 36);
	const recentLatencySpark = recentLatencySparkline(summary, 24);
	const latency24h = percentile(summary.trends.processingMs.window24h, 95);
	const latency7d = percentile(summary.trends.processingMs.window7d, 95);
	const latencyTrend = trendArrow(latency24h, latency7d);
	const latencyDelta = deltaPercent(latency24h, latency7d);
	const error24h = summary.errors.count;
	const baselineErrors24h = Math.max(
		1,
		Math.round((summary.regression.baseline7dCount / 7) * 0.03),
	);
	const errorTrend = trendArrow(error24h, baselineErrors24h);
	const errorDelta = deltaPercent(error24h, baselineErrors24h);
	const quality24h = summary.quality.total24h;
	const baselineQuality24h = Math.max(
		1,
		Math.round((summary.regression.baseline7dCount / 7) * 0.01),
	);
	const qualityTrend = trendArrow(quality24h, baselineQuality24h);
	const qualityDelta = deltaPercent(quality24h, baselineQuality24h);
	const throughputPerHour = summary.regression.window1hCount;
	const throughputBaselinePerHour = Math.max(
		1,
		Math.round(summary.regression.baseline7dCount / (7 * 24)),
	);
	const throughputTrend = trendArrow(
		throughputPerHour,
		throughputBaselinePerHour,
	);
	const freshness = summary.cache.eventLagMs > 120000 ? "stale" : "fresh";
	const freshnessColor =
		summary.cache.eventLagMs > 120000 ? colors.warn : colors.ok;
	const topModel = topModels[0]?.[0] ?? "unknown";
	const fallbackRate =
		summary.regression.window24hCount > 0
			? ((summary.pipeline.fallbacks24h.groq +
					summary.pipeline.fallbacks24h.deepgram) /
					summary.regression.window24hCount) *
				100
			: 0;
	const actionHint = runtimeActionHint(summary, anomalies);
	const topAnomaly = anomalies[0]?.message ?? "none";
	const kpiRows = [
		{
			label: "latency 24h p95",
			value: ms(latency24h),
			delta: `${latencyTrend} ${latencyDelta}`,
			confidence: confidenceFromSample(
				summary.trends.processingMs.window24h.length,
				minSampleSize,
			),
			severityScore:
				latencyHealth === "BAD" ? 3 : latencyHealth === "WARN" ? 2 : 1,
			color: stateColor(latencyHealth),
		},
		{
			label: "errors 24h",
			value: String(error24h),
			delta: `${errorTrend} ${errorDelta}`,
			confidence: confidenceFromSample(
				summary.regression.window24hCount,
				minSampleSize,
			),
			severityScore: errorHealth === "BAD" ? 3 : errorHealth === "WARN" ? 2 : 1,
			color: stateColor(errorHealth),
		},
		{
			label: "quality 24h",
			value: String(quality24h),
			delta: `${qualityTrend} ${qualityDelta}`,
			confidence: confidenceFromSample(
				summary.regression.window24hCount,
				minSampleSize,
			),
			severityScore:
				qualityHealth === "BAD" ? 3 : qualityHealth === "WARN" ? 2 : 1,
			color: stateColor(qualityHealth),
		},
	].sort((a, b) => b.severityScore - a.severityScore);

	return (
		<box
			width={width}
			height={height}
			backgroundColor={colors.bg}
			flexDirection="column"
		>
			<box
				height={1}
				border={["bottom"]}
				borderColor={colors.border}
				paddingLeft={1}
				paddingRight={1}
				justifyContent="space-between"
			>
				<text fg={colors.text} attributes={TextAttributes.BOLD}>
					hyprvox stats | Health {health} | {tabLabel(activeTab)} | filter{" "}
					{filter}
				</text>
				<text fg={colors.muted}>
					{autoRefresh ? "auto:on" : "auto:off"} | ttfp {ttfpMs ?? 0}ms | upd{" "}
					{new Date(summary.generatedAt).toLocaleTimeString()}
				</text>
			</box>

			<box height={2} paddingLeft={1} gap={2}>
				<text fg={stateColor(daemonHealth)}>
					daemon {summary.daemon.status}
				</text>
				<text fg={stateColor(latencyHealth)}>
					24h p95 {ms(summary.latency.p95Ms)}
				</text>
				<text fg={stateColor(errorHealth)}>errors {summary.errors.count}</text>
				<text fg={stateColor(qualityHealth)}>
					quality24h {summary.quality.total24h}
				</text>
				<text fg={summary.quality.spike ? colors.bad : colors.muted}>
					{summary.quality.spike ? "quality spike" : "stable"}
				</text>
			</box>

			<box height={2} paddingLeft={1} gap={1}>
				{(
					["overview", "quality", "pipeline", "trends", "exports"] as StatsTab[]
				).map((tab, idx) => (
					<text
						key={tab}
						fg={activeTab === tab ? colors.bg : colors.text}
						bg={activeTab === tab ? colors.accent : undefined}
					>
						{idx + 1}:{tabLabel(tab)}
					</text>
				))}
			</box>

			<box
				flexDirection="row"
				paddingLeft={1}
				paddingRight={1}
				gap={1}
				flexGrow={1}
			>
				{activeTab === "overview" ? (
					<>
						<box
							width={Math.max(58, Math.floor(width * 0.62))}
							flexDirection="column"
							gap={1}
						>
							<Section title="Runtime Overview" height={11}>
								<text fg={colors.text}>
									Today {summary.counts.today} | Total {summary.counts.total} |
									History {summary.counts.history} | Win {windowPreset}
								</text>
								{kpiRows.map((kpi) => (
									<text key={kpi.label} fg={kpi.color}>
										{kpi.label.padEnd(12)} {kpi.value.padEnd(8)}{" "}
										{kpi.delta.padEnd(8)} n={summary.regression.window24hCount}{" "}
										[{kpi.confidence}]
									</text>
								))}
								<text fg={colors.text}>
									throughput {throughputPerHour}/h ({throughputTrend} vs{" "}
									{throughputBaselinePerHour}/h) | pulse{" "}
									{recentLatencySpark || "n/a"}
								</text>
								<text fg={freshnessColor}>
									freshness {freshness} | lag {ms(summary.cache.eventLagMs)} |
									rebuild{" "}
									{new Date(summary.cache.lastRebuildAt).toLocaleTimeString()}
								</text>
								<text fg={colors.text}>
									routing top {truncate(topModel, 20)} | fallback{" "}
									{fallbackRate.toFixed(1)}%
								</text>
								<text fg={anomalies.length > 0 ? colors.warn : colors.ok}>
									anomalies {anomalies.length} | top {truncate(topAnomaly, 48)}
								</text>
								<text fg={colors.info}>
									next: {truncate(actionHint, 64)} | refreshed{" "}
									{age(Date.now() - lastRefreshAt)} ago
								</text>
							</Section>
							<Section
								title={`Recent Sessions [${recentSortMode}/${recentLocalFilter}]`}
								height={height - 18}
							>
								<text fg={colors.muted}>age time engine lat flags text</text>
								{recentRows.length === 0 ? (
									<text fg={colors.muted}>
										no rows for filter {recentLocalFilter}; press v then 1 for
										all
									</text>
								) : (
									recentRows
										.slice(recentOffset, recentOffset + rowsPerPage)
										.map((row) => {
											const absoluteIndex = recentRows.findIndex(
												(item) => item.key === row.key,
											);
											const isActive = absoluteIndex === recentSelectedIndex;
											return (
												<text
													key={row.key}
													fg={isActive ? colors.bg : rowColor(row.severity)}
													bg={isActive ? colors.accent : undefined}
												>
													{truncate(
														`${isActive ? ">" : " "}${row.ageLabel.padEnd(4)} ${new Date(row.item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).padEnd(5)} ${truncate(row.item.engine, 14).padEnd(14)} ${ms(row.item.processingTime).padEnd(6)} ${(row.flags.join(",") || "-").padEnd(6)} ${truncate(row.item.text, 60)}`,
														Math.max(24, Math.floor(width * 0.56)),
													)}
												</text>
											);
										})
								)}
								<text fg={colors.muted}>
									rows:{recentRows.length} | nav j/k row u/d page | n sort | v
									filter
								</text>
								{selectedRecentRow ? (
									<>
										<text fg={rowColor(selectedRecentRow.severity)}>
											detail: sev {selectedRecentRow.severity} | lat{" "}
											{ms(selectedRecentRow.item.processingTime)} | flags{" "}
											{selectedRecentRow.flags.join(",") || "-"}
										</text>
										<text fg={colors.text}>
											time{" "}
											{new Date(
												selectedRecentRow.item.timestamp,
											).toLocaleString()}{" "}
											| age {selectedRecentRow.ageLabel} | engine{" "}
											{selectedRecentRow.item.engine}
										</text>
										{detailLines.map((line, index) => (
											<text
												key={`${selectedRecentRow.key}-detail-${index}`}
												fg={colors.text}
											>
												text: {line}
											</text>
										))}
									</>
								) : null}
							</Section>
						</box>
						<box flexDirection="column" flexGrow={1} gap={1}>
							<Section title="Anomaly Cards" height={degradedMode ? 7 : 10}>
								{anomalies.length === 0 ? (
									<text fg={colors.ok}>No anomalies detected.</text>
								) : (
									anomalies.slice(0, degradedMode ? 2 : 5).map((item) => (
										<text
											key={item.key}
											fg={item.severity === "bad" ? colors.bad : colors.warn}
										>
											{truncate(
												item.message,
												Math.max(32, Math.floor(width * 0.34)),
											)}
										</text>
									))
								)}
							</Section>
							{degradedMode ? null : (
								<Section title="Cache Health" height={8}>
									<text fg={colors.text}>source {summary.cache.source}</text>
									<text fg={colors.text}>
										hit-rate {(summary.cache.hitRate * 100).toFixed(0)}%
									</text>
									<text fg={colors.text}>
										event lag {ms(summary.cache.eventLagMs)}
									</text>
									<text fg={colors.text}>
										last rebuild{" "}
										{new Date(summary.cache.lastRebuildAt).toLocaleTimeString()}
									</text>
								</Section>
							)}
							{degradedMode ? null : (
								<Section title="Regression" height={8}>
									<text fg={colors.text}>
										1h sessions {summary.regression.window1hCount}
									</text>
									<text fg={colors.text}>
										24h sessions {summary.regression.window24hCount}
									</text>
									<text fg={colors.text}>
										7d baseline {summary.regression.baseline7dCount}
									</text>
									<text
										fg={
											summary.regression.flags.length > 0
												? colors.warn
												: colors.ok
										}
									>
										flags: {summary.regression.flags.join(", ") || "none"}
									</text>
								</Section>
							)}
						</box>
					</>
				) : null}

				{activeTab === "quality" ? (
					<box flexDirection="column" flexGrow={1} gap={1}>
						<Section
							title="Quality Rankings (24h)"
							height={
								degradedMode
									? height - 14
									: Math.max(12, Math.floor((height - 10) * 0.65))
							}
						>
							{Object.entries(summary.quality.window24h)
								.sort((a, b) => b[1] - a[1])
								.map(([name, count]) => (
									<text key={name} fg={colors.text}>
										{truncate(name, 24).padEnd(24)} {String(count).padStart(5)}{" "}
										[{confidenceLabel(count, minSampleSize)}]
									</text>
								))}
						</Section>
						{degradedMode ? null : (
							<Section
								title="Quality Drilldown"
								height={Math.max(8, Math.floor((height - 10) * 0.35))}
							>
								<text fg={colors.text}>
									Top issue:{" "}
									{Object.entries(summary.quality.window24h).sort(
										(a, b) => b[1] - a[1],
									)[0]?.[0] ?? "none"}
								</text>
								<text fg={colors.text}>
									Top issue count:{" "}
									{Object.entries(summary.quality.window24h).sort(
										(a, b) => b[1] - a[1],
									)[0]?.[1] ?? 0}
								</text>
								<text fg={colors.text}>
									Total quality failures: {summary.quality.total24h}
								</text>
								<text fg={summary.quality.spike ? colors.warn : colors.ok}>
									1h spike: {summary.quality.spike ? "yes" : "no"}
								</text>
							</Section>
						)}
					</box>
				) : null}

				{activeTab === "pipeline" ? (
					<box flexDirection="column" flexGrow={1} gap={1}>
						<Section title="Merge Strategy Ranking" height={10}>
							{topStrategies.map(([name, count]) => (
								<text key={name} fg={colors.text}>
									{truncate(name, 28).padEnd(28)} {String(count).padStart(5)} [
									{confidenceLabel(count, minSampleSize)}]
								</text>
							))}
						</Section>
						<Section title="Model Ranking (24h)" height={10}>
							{topModels.map(([name, count]) => (
								<text key={name} fg={colors.text}>
									{truncate(name, 28).padEnd(28)} {String(count).padStart(5)} [
									{confidenceLabel(count, minSampleSize)}]
								</text>
							))}
						</Section>
						<Section title="Fallbacks" height={degradedMode ? 6 : 8}>
							<text fg={colors.text}>
								none {summary.pipeline.fallbacks24h.none}
							</text>
							<text fg={colors.text}>
								groq {summary.pipeline.fallbacks24h.groq}
							</text>
							<text fg={colors.text}>
								deepgram {summary.pipeline.fallbacks24h.deepgram}
							</text>
							<text fg={colors.text}>
								validation retries {summary.pipeline.validationRetries24h}
							</text>
						</Section>
						{degradedMode ? null : (
							<Section title="Pipeline Drilldown" height={8}>
								<text fg={colors.text}>
									Top merge strategy: {topStrategies[0]?.[0] ?? "none"}
								</text>
								<text fg={colors.text}>
									Top model: {topModels[0]?.[0] ?? "unknown"}
								</text>
								<text fg={colors.text}>
									Model diversity (24h):{" "}
									{Object.keys(summary.pipeline.modelRank24h).length}
								</text>
							</Section>
						)}
					</box>
				) : null}

				{activeTab === "trends" ? (
					<box flexDirection="column" flexGrow={1} gap={1}>
						<Section title={`Trend Window ${windowPreset}`} height={10}>
							<text fg={colors.text}>Latency trend {windowSpark || "n/a"}</text>
							<text fg={colors.text}>
								samples {windowValues.length} [
								{confidenceLabel(windowValues.length, minSampleSize)}]
							</text>
							<text fg={colors.text}>window switch: t</text>
						</Section>
						<Section title="Anomaly Trend" height={degradedMode ? 6 : 8}>
							<text fg={colors.text}>anomaly count {anomalies.length}</text>
							<text fg={colors.text}>
								severity mix bad/warn{" "}
								{anomalies.filter((a) => a.severity === "bad").length}/
								{anomalies.filter((a) => a.severity === "warn").length}
							</text>
							<text fg={colors.muted}>
								high anomalies likely imply degraded reliability
							</text>
						</Section>
						<Section title="Thresholds" height={10}>
							<text fg={colors.text}>
								latency warn/bad {summary.thresholds.latencyP95WarnMs}/
								{summary.thresholds.latencyP95BadMs} ms
							</text>
							<text fg={colors.text}>
								error warn/bad {summary.thresholds.errorWarnCount24h}/
								{summary.thresholds.errorBadCount24h}
							</text>
							<text fg={colors.text}>
								quality warn/bad {summary.thresholds.qualityWarnCount24h}/
								{summary.thresholds.qualityBadCount24h}
							</text>
						</Section>
					</box>
				) : null}

				{activeTab === "exports" ? (
					<Section title="Export Controls" height={height - 9}>
						<text fg={colors.text}>e: export tab JSON (confirm y/N)</text>
						<text fg={colors.text}>
							E: export global markdown (confirm y/N)
						</text>
						<text fg={colors.text}>
							default path ~/.config/hypr/vox/exports/
						</text>
						<text fg={colors.muted}>Current tab: {tabLabel(activeTab)}</text>
					</Section>
				) : null}
			</box>

			<box
				height={3}
				border={["top"]}
				borderColor={colors.border}
				paddingLeft={1}
				paddingRight={1}
			>
				<text fg={colors.muted}>
					hotkeys: q quit | 1-5 tabs | h/l nav | r refresh | a auto | / global |
					v recent | j/k row | u/d page | n sort | x row export | t window
				</text>
			</box>
			<box height={1} paddingLeft={1}>
				<text
					fg={
						pendingExport
							? colors.warn
							: filterPrompt
								? colors.info
								: colors.muted
					}
				>
					{filterPrompt
						? "filter: 1 all, 2 quality, 3 latency, 4 errors, 5 fallbacks"
						: recentFilterPrompt
							? "recent filter: 1 all, 2 bad, 3 warn, 4 good"
							: pendingExport
								? "confirm export: y/N"
								: `${statusMessage}${degradedMode ? " | degraded mode" : ""}`}
				</text>
			</box>
		</box>
	);
}
