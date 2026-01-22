import { Command } from "commander";
import { loadHistory, clearHistory, type HistoryItem } from "../utils/history";
import * as colors from "yoctocolors";
import { createInterface } from "node:readline/promises";

function displayItems(items: HistoryItem[]): void {
  items.forEach((item) => {
    console.log(colors.dim("------------------------------------------------"));
    console.log(`${colors.bold("Time:")}    ${new Date(item.timestamp).toLocaleString()}`);
    console.log(`${colors.bold("Engine:")}  ${item.engine} (${item.processingTime}ms)`);
    console.log(`${colors.bold("Length:")}  ${item.duration.toFixed(1)}s`);
    console.log(`${colors.bold("Text:")}    ${colors.green(item.text)}`);
  });
}

async function paginateHistory(history: HistoryItem[], initialCount: number): Promise<void> {
  let displayedCount = 0;
  const total = history.length;
  const reversedHistory = [...history].reverse();

  const showNextBatch = async () => {
    const remaining = total - displayedCount;
    const toShow = Math.min(remaining, displayedCount === 0 ? initialCount : 20);
    
    if (toShow <= 0) return;

    const batch = reversedHistory.slice(displayedCount, displayedCount + toShow);
    displayItems(batch);
    displayedCount += toShow;

    if (displayedCount < total) {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout
      });

      try {
        const answer = await rl.question(colors.cyan(`\nShowing ${displayedCount}/${total}. Show more? (y/N): `));
        rl.close();
        if (answer.toLowerCase() === "y") {
          await showNextBatch();
        }
      } catch (err) {
        rl.close();
      }
    } else {
      console.log(colors.dim("------------------------------------------------"));
      console.log(colors.blue("End of history."));
    }
  };

  await showNextBatch();
}

export const historyCommand = new Command("history")
  .description("Display transcription history")
  .action(async () => {
    const history = loadHistory();
    if (history.length === 0) {
      console.log(colors.yellow("No transcription history found."));
      return;
    }

    await paginateHistory(history, 20);
  });

historyCommand
  .command("list")
  .description("List recent transcriptions")
  .option("-n, --number <count>", "Number of items to show", "20")
  .action(async (options) => {
    const history = loadHistory();
    if (history.length === 0) {
      console.log(colors.yellow("No transcription history found."));
      return;
    }

    const count = parseInt(options.number, 10);
    const recent = history.slice(-count).reverse();

    console.log(colors.bold(colors.cyan(`Last ${recent.length} transcription(s):`)));
    displayItems(recent);
    console.log(colors.dim("------------------------------------------------"));
  });

historyCommand
  .command("clear")
  .description("Clear all transcription history")
  .action(() => {
    clearHistory();
    console.log(colors.green("✅ Transcription history cleared."));
  });
