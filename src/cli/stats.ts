import { Command } from "commander";
import * as colors from "yoctocolors";
import { formatStatsSummary } from "../stats/format";
import { buildStatsSummary } from "../stats/summary";
import { runStatsTui } from "../stats/tui";

interface StatsOptions {
	json?: boolean;
	summary?: boolean;
}

export const statsCommand = new Command("stats")
	.description("Show transcription stats")
	.option("--json", "Print stats as JSON")
	.option("--summary", "Print plain stats summary")
	.action(async (options: StatsOptions) => {
		const summary = await buildStatsSummary();

		if (options.json) {
			console.log(JSON.stringify(summary, null, 2));
			return;
		}

		if (options.summary || !process.stdout.isTTY) {
			console.log(formatStatsSummary(summary));
			return;
		}

		try {
			await runStatsTui(buildStatsSummary);
		} catch (error) {
			console.error(
				colors.yellow("Stats TUI could not start; showing plain summary."),
			);
			console.error(colors.dim((error as Error).message));
			console.log(formatStatsSummary(summary));
		}
	});
