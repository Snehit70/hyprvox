import { createCliRenderer, TextRenderable } from "@opentui/core";
import type { StatsSummary } from "./summary";

function ms(value: number | null): string {
	return value === null ? "n/a" : `${Math.round(value)}ms`;
}

function seconds(value: number | null): string {
	return value === null ? "n/a" : `${value.toFixed(1)}s`;
}

function truncate(value: string, width: number): string {
	if (value.length <= width) return value.padEnd(width);
	if (width <= 1) return "…";
	return `${value.slice(0, width - 1)}…`;
}

function line(width: number): string {
	return "─".repeat(Math.max(1, width));
}

function panel(title: string, body: string[], width: number): string[] {
	const inner = Math.max(8, width - 2);
	const header = `╭─ ${title} ${line(Math.max(0, inner - title.length - 3))}╮`;
	const footer = `╰${line(inner)}╯`;
	const rows = body.map((row) => `│${truncate(row, inner)}│`);
	return [header, ...rows, footer];
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

function metricCards(summary: StatsSummary, width: number): string[] {
	const cardGap = 2;
	const cardWidth = Math.max(18, Math.floor((width - cardGap * 3) / 4));
	const cards = [
		panel(
			"Today",
			[`${summary.counts.today} transcriptions`, "current day"],
			cardWidth,
		),
		panel(
			"Total",
			[
				`${summary.counts.total} all time`,
				`${summary.counts.history} in history`,
			],
			cardWidth,
		),
		panel(
			"Latency",
			[
				`median ${ms(summary.latency.medianMs)}`,
				`p95 ${ms(summary.latency.p95Ms)}`,
			],
			cardWidth,
		),
		panel(
			"Duration",
			[
				`avg ${seconds(summary.duration.averageSeconds)}`,
				`S/M/L ${summary.duration.shortCount}/${summary.duration.mediumCount}/${summary.duration.longCount}`,
			],
			cardWidth,
		),
	];
	const height = Math.max(...cards.map((card) => card.length));
	const rows: string[] = [];
	for (let i = 0; i < height; i += 1) {
		rows.push(
			cards
				.map((card) => card[i] ?? " ".repeat(cardWidth))
				.join(" ".repeat(cardGap)),
		);
	}
	return rows;
}

function enginesPanel(summary: StatsSummary, width: number): string[] {
	const entries = Object.entries(summary.engines)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 6);
	if (entries.length === 0) return panel("Engines", ["No history yet."], width);
	const max = Math.max(...entries.map(([, count]) => count));
	const rows = entries.map(([engine, count]) => {
		const barWidth = Math.max(1, width - 28);
		const bar = "█".repeat(Math.max(1, Math.round((count / max) * barWidth)));
		return `${truncate(engine, 14)} ${String(count).padStart(4)} ${bar}`;
	});
	return panel("Engines", rows, width);
}

function runtimePanel(summary: StatsSummary, width: number): string[] {
	const rows = [
		`Daemon  ${summary.daemon.status}${summary.daemon.pid ? ` (${summary.daemon.pid})` : ""}`,
		`Errors  ${summary.errors.count}`,
		summary.errors.latest ? `Latest  ${summary.errors.latest}` : "Latest  none",
		`Config  ${summary.paths.config}`,
	];
	return panel("Runtime", rows, width);
}

function recentPanel(summary: StatsSummary, width: number): string[] {
	if (summary.recent.length === 0) {
		return panel("Recent Transcriptions", ["No recent transcriptions."], width);
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
	return panel("Recent Transcriptions", rows, width);
}

function dashboardText(summary: StatsSummary, terminalWidth: number): string {
	const width = Math.max(76, Math.min(terminalWidth - 4, 140));
	const sideWidth = Math.max(30, Math.floor(width * 0.32));
	const mainWidth = width - sideWidth - 2;
	const title = `hyprvox stats`.padEnd(width - 36);
	const generated = `updated ${new Date(summary.generatedAt).toLocaleTimeString()}`;
	const top = `${title}${generated}`;
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
		...lower,
		"",
		"q quit  r refresh  h health  l logs  e errors",
	].join("\n");
}

export async function runStatsTui(
	loadSummary: () => Promise<StatsSummary>,
): Promise<void> {
	const renderer = await createCliRenderer({
		exitOnCtrlC: true,
		clearOnShutdown: true,
		openConsoleOnError: false,
	});
	const text = new TextRenderable(renderer, {
		id: "hyprvox-stats",
		content: dashboardText(await loadSummary(), process.stdout.columns ?? 100),
		x: 2,
		y: 1,
		width: "100%",
		height: "100%",
		truncate: true,
	});

	renderer.root.add(text);
	renderer.start();

	const refresh = async () => {
		text.content = dashboardText(
			await loadSummary(),
			process.stdout.columns ?? 100,
		);
		renderer.requestLive();
	};

	const runAndExit = (args: string[]) => {
		renderer.destroy();
		Bun.spawn([process.argv[0], process.argv[1] ?? "index.ts", ...args], {
			stdio: ["inherit", "inherit", "inherit"],
		});
	};

	process.stdin.setRawMode?.(true);
	process.stdin.resume();
	process.stdin.on("data", async (chunk) => {
		const key = chunk.toString();
		if (key === "q" || key === "\u0003") {
			renderer.destroy();
			process.exit(0);
		}
		if (key === "r") await refresh();
		if (key === "h") runAndExit(["health"]);
		if (key === "l") runAndExit(["logs"]);
		if (key === "e") runAndExit(["errors"]);
	});
}
