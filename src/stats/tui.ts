import { createCliRenderer, TextRenderable } from "@opentui/core";
import type { StatsSummary } from "./summary";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const SPINNER_INTERVAL_MS = 1000 / 12;
const AUTO_REFRESH_MS = 5000;

function ms(value: number | null): string {
	return value === null ? "n/a" : `${Math.round(value)}ms`;
}

function seconds(value: number | null): string {
	return value === null ? "n/a" : `${value.toFixed(1)}s`;
}

function age(msAgo: number): string {
	const sec = Math.max(0, Math.floor(msAgo / 1000));
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	const remSec = sec % 60;
	return `${min}m ${remSec}s`;
}

function truncate(value: string, width: number): string {
	if (value.length <= width) return value.padEnd(width);
	if (width <= 1) return "…";
	return `${value.slice(0, width - 1)}…`;
}

function line(width: number, char = "─"): string {
	return char.repeat(Math.max(1, width));
}

function sparkline(values: number[], width: number): string {
	if (values.length === 0 || width <= 0) return "";
	const bars = "▁▂▃▄▅▆▇█";
	const max = Math.max(...values);
	const min = Math.min(...values);
	const range = Math.max(1, max - min);
	const sampled = values.slice(-width);
	return sampled
		.map((value) => {
			const idx = Math.max(
				0,
				Math.min(
					bars.length - 1,
					Math.floor(((value - min) / range) * (bars.length - 1)),
				),
			);
			return bars[idx] ?? "▁";
		})
		.join("");
}

function section(title: string, body: string[], width: number): string[] {
	const header = `${title}`;
	const divider = line(Math.min(width, Math.max(12, title.length + 4)), "·");
	return [header, divider, ...body.map((row) => truncate(row, width))];
}

function columns(left: string[], right: string[], gap = 2): string[] {
	const leftWidth = Math.max(...left.map((row) => row.length), 0);
	const height = Math.max(left.length, right.length);
	const rows: string[] = [];
	for (let i = 0; i < height; i += 1) {
		rows.push(
			`${(left[i] ?? "").padEnd(leftWidth)}${" ".repeat(gap)}${right[i] ?? ""}`,
		);
	}
	return rows;
}

function latencyState(p95: number | null): string {
	if (p95 === null) return "UNKNOWN";
	if (p95 <= 2000) return "GOOD";
	if (p95 <= 3500) return "WARN";
	return "BAD";
}

function errorState(count: number): string {
	if (count === 0) return "GOOD";
	if (count <= 10) return "WARN";
	return "BAD";
}

function daemonState(status: string): string {
	if (status === "idle" || status === "recording" || status === "processing") {
		return "GOOD";
	}
	if (status === "running" || status === "stale-pid") return "WARN";
	return "BAD";
}

function summaryRows(
	summary: StatsSummary,
	historySparkline: string,
	refreshAge: string,
): string[] {
	return [
		`Today ${summary.counts.today}   Total ${summary.counts.total}   History ${summary.counts.history}`,
		`Latency median ${ms(summary.latency.medianMs)}   p95 ${ms(summary.latency.p95Ms)}   avg ${ms(summary.latency.averageMs)}   [${latencyState(summary.latency.p95Ms)}]`,
		`Duration avg ${seconds(summary.duration.averageSeconds)}   S/M/L ${summary.duration.shortCount}/${summary.duration.mediumCount}/${summary.duration.longCount}`,
		`Pulse ${historySparkline || "n/a"}   refreshed ${refreshAge} ago`,
	];
}

function metricCards(summary: StatsSummary, width: number): string[] {
	const gap = width >= 120 ? 4 : 3;
	const cardWidth = Math.max(20, Math.floor((width - gap) / 2));
	const cards = [
		section(
			"Counts",
			[
				`Today: ${summary.counts.today}`,
				`Total: ${summary.counts.total}`,
				`History: ${summary.counts.history}`,
			],
			cardWidth,
		),
		section(
			"Health",
			[
				`Daemon: ${summary.daemon.status} [${daemonState(summary.daemon.status)}]`,
				`Errors: ${summary.errors.count} [${errorState(summary.errors.count)}]`,
				`Latency p95: ${ms(summary.latency.p95Ms)} [${latencyState(summary.latency.p95Ms)}]`,
			],
			cardWidth,
		),
	];
	const height = Math.max(...cards.map((card) => card.length));
	const rows: string[] = [];
	for (let i = 0; i < height; i += 1) {
		rows.push(
			cards.map((card) => card[i] ?? " ".repeat(cardWidth)).join(" ".repeat(gap)),
		);
	}
	return rows;
}

function enginesPanel(summary: StatsSummary, width: number): string[] {
	const entries = Object.entries(summary.engines)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 6);
	if (entries.length === 0) return section("Engines", ["No history yet."], width);
	const max = Math.max(...entries.map(([, count]) => count));
	const rows = entries.map(([engine, count]) => {
		const barWidth = Math.max(1, width - 28);
		const bar = "█".repeat(Math.max(1, Math.round((count / max) * barWidth)));
		return `${truncate(engine, 14)} ${String(count).padStart(4)} ${bar}`;
	});
	return section("Engines", rows, width);
}

function runtimePanel(summary: StatsSummary, width: number): string[] {
	const rows = [
		`Daemon: ${summary.daemon.status}${summary.daemon.pid ? ` (${summary.daemon.pid})` : ""}`,
		`Errors: ${summary.errors.count}`,
		summary.errors.latest ? `Latest: ${summary.errors.latest}` : "Latest: none",
		`Config: ${summary.paths.config}`,
	];
	return section("Runtime", rows, width);
}

function keysPanel(width: number): string[] {
	return section(
		"Controls",
		[
			"q quit   r refresh   a auto-refresh",
			"h health l logs      e errors",
			"? help overlay",
		],
		width,
	);
}

function recentPanel(summary: StatsSummary, width: number): string[] {
	if (summary.recent.length === 0) {
		return section("Recent Transcriptions", ["No recent transcriptions."], width);
	}
	const textWidth = Math.max(12, width - 42);
	const rows = [
		`${"Time".padEnd(10)} ${"Engine".padEnd(11)} ${"Latency".padEnd(8)} Text`,
		line(Math.max(10, width - 2)),
		...summary.recent.slice(0, 8).map((item) => {
			const time = new Date(item.timestamp).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
			});
			return `${time.padEnd(10)} ${truncate(item.engine, 11)} ${ms(item.processingTime).padEnd(8)} ${truncate(item.text, textWidth)}`;
		}),
	];
	return section("Recent Transcriptions", rows, width);
}

function helpOverlay(width: number): string[] {
	const w = Math.min(72, Math.max(40, width - 8));
	return section(
		"Help",
		[
			"This view is live and keyboard-driven.",
			"",
			"q: quit",
			"r: manual refresh now",
			"a: toggle auto-refresh (5s)",
			"h: jump to health",
			"l: jump to logs",
			"e: jump to errors",
			"?: close this help",
		],
		w,
	);
}

function dashboardText(
	summary: StatsSummary,
	terminalWidth: number,
	frame: number,
	autoRefresh: boolean,
	lastRefreshAt: number,
	showHelp: boolean,
): string {
	const width = Math.max(64, Math.min(terminalWidth - 4, 140));
	const title = `hyprvox stats`.padEnd(Math.max(20, width - 30));
	const spin = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? "•";
	const autoLabel = autoRefresh ? "auto:on" : "auto:off";
	const generated = `${spin} ${autoLabel}  updated ${new Date(summary.generatedAt).toLocaleTimeString()}`;
	const top = `${title}${truncate(generated, 28)}`;
	const narrow = width < 110;
	const refreshAge = age(Date.now() - lastRefreshAt);
	const historySparkline = sparkline(
		summary.recent
			.slice()
			.reverse()
			.map((item) => item.processingTime ?? 0)
			.filter((value) => Number.isFinite(value) && value >= 0),
		22,
	);
	if (showHelp) {
		return [top, line(width), "", ...helpOverlay(width), "", "press ? to close"]
			.map((row) => truncate(row, width))
			.join("\n");
	}

	if (narrow) {
		return [
			top,
			line(width),
			"",
			...summaryRows(summary, historySparkline, refreshAge),
			"",
			...recentPanel(summary, width),
			"",
			...enginesPanel(summary, width),
			"",
			...runtimePanel(summary, width),
			"",
			...keysPanel(width),
			"",
		].join("\n");
	}

	const sideWidth = Math.max(30, Math.floor(width * 0.34));
	const mainWidth = width - sideWidth - 2;
	const lower = columns(recentPanel(summary, mainWidth), [
		...enginesPanel(summary, sideWidth),
		"",
		...runtimePanel(summary, sideWidth),
	]);

	return [
		top,
		line(width),
		"",
		...metricCards(summary, width),
		"",
		...summaryRows(summary, historySparkline, refreshAge),
		"",
		...lower,
		"",
		...keysPanel(width),
	].join("\n");
}

export async function runStatsTui(
	loadSummary: () => Promise<StatsSummary>,
): Promise<void> {
	let summary = await loadSummary();
	let frame = 0;
	let autoRefresh = true;
	let showHelp = false;
	let lastRefreshAt = Date.now();

	const renderer = await createCliRenderer({
		exitOnCtrlC: true,
		clearOnShutdown: true,
		openConsoleOnError: false,
	});
	const text = new TextRenderable(renderer, {
		id: "hyprvox-stats",
		content: dashboardText(
			summary,
			process.stdout.columns ?? 100,
			frame,
			autoRefresh,
			lastRefreshAt,
			showHelp,
		),
		x: 2,
		y: 1,
		width: "100%",
		height: "100%",
		truncate: true,
	});

	renderer.root.add(text);
	renderer.start();

	const redraw = () => {
		text.content = dashboardText(
			summary,
			process.stdout.columns ?? 100,
			frame,
			autoRefresh,
			lastRefreshAt,
			showHelp,
		);
		renderer.requestLive();
	};

	const refresh = async () => {
		summary = await loadSummary();
		lastRefreshAt = Date.now();
		redraw();
	};

	const runAndExit = (args: string[]) => {
		clearInterval(spinnerTimer);
		clearInterval(autoRefreshTimer);
		process.stdin.off("data", onKey);
		renderer.destroy();
		Bun.spawn([process.argv[0], process.argv[1] ?? "index.ts", ...args], {
			stdio: ["inherit", "inherit", "inherit"],
		});
	};

	const spinnerTimer = setInterval(() => {
		frame += 1;
		redraw();
	}, SPINNER_INTERVAL_MS);

	const autoRefreshTimer = setInterval(async () => {
		if (autoRefresh) {
			await refresh();
		} else {
			redraw();
		}
	}, AUTO_REFRESH_MS);

	const onKey = async (chunk: Buffer) => {
		const key = chunk.toString();
		if (key === "q" || key === "\u0003") {
			clearInterval(spinnerTimer);
			clearInterval(autoRefreshTimer);
			process.stdin.off("data", onKey);
			renderer.destroy();
			process.exit(0);
		}
		if (key === "r") await refresh();
		if (key === "a") {
			autoRefresh = !autoRefresh;
			redraw();
		}
		if (key === "?") {
			showHelp = !showHelp;
			redraw();
		}
		if (key === "h") runAndExit(["health"]);
		if (key === "l") runAndExit(["logs"]);
		if (key === "e") runAndExit(["errors"]);
	};

	process.stdin.setRawMode?.(true);
	process.stdin.resume();
	process.stdin.on("data", onKey);
}
