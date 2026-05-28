import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "../config/loader";
import type { Config } from "../config/schema";
import { atomicWriteFile, ensureDir, readJsonFile } from "./file-ops";
import { logger } from "./logger";

export interface HistoryItem {
	timestamp: string;
	text: string;
	duration: number;
	engine: string;
	processingTime: number;
	groqSttModel?: string;
	deepgramModel?: string;
	mergeModel?: string;
	mergeStrategy?: string;
	validationReasons?: string[];
}

export interface SearchOptions {
	keyword?: string;
	date?: string;
	from?: string;
	to?: string;
}

export async function searchHistory(
	options: SearchOptions,
): Promise<HistoryItem[]> {
	const history = await loadHistory();
	return history.filter((item) => {
		if (
			options.keyword &&
			!item.text.toLowerCase().includes(options.keyword.toLowerCase())
		) {
			return false;
		}

		const itemDate = new Date(item.timestamp);

		if (options.date) {
			const searchDate = new Date(options.date);
			if (
				Number.isNaN(searchDate.getTime()) ||
				itemDate.toDateString() !== searchDate.toDateString()
			) {
				return false;
			}
		}

		if (options.from) {
			const fromDate = new Date(options.from);
			if (Number.isNaN(fromDate.getTime()) || itemDate < fromDate) {
				return false;
			}
		}

		if (options.to) {
			const toDate = new Date(options.to);
			if (Number.isNaN(toDate.getTime())) {
				return false;
			}
			toDate.setHours(23, 59, 59, 999);
			if (itemDate > toDate) {
				return false;
			}
		}

		return true;
	});
}

export async function appendHistory(item: HistoryItem): Promise<void> {
	let config: Config;
	try {
		config = loadConfig();
	} catch {
		logger.error("Failed to load config for history append");
		return;
	}

	const historyFile = config.paths.history;

	try {
		await ensureDir(dirname(historyFile));

		let history: HistoryItem[] = [];
		if (existsSync(historyFile)) {
			const loaded = await readJsonFile<HistoryItem[]>(historyFile);
			if (Array.isArray(loaded)) {
				history = loaded;
			} else if (loaded !== null) {
				logger.warn("History file format invalid, resetting to empty array");
			}
		}

		history.push(item);

		if (history.length > 1000) {
			history = history.slice(-1000);
		}

		await atomicWriteFile(historyFile, JSON.stringify(history, null, 2), {
			mode: 0o600,
		});
	} catch (error) {
		logger.error({ error, historyFile }, "Failed to append to history");
	}
}

export async function loadHistory(): Promise<HistoryItem[]> {
	let config: Config;
	try {
		config = loadConfig();
	} catch {
		return [];
	}

	const historyFile = config.paths.history;
	if (!existsSync(historyFile)) {
		return [];
	}

	try {
		const history = await readJsonFile<HistoryItem[]>(historyFile);
		return Array.isArray(history) ? history : [];
	} catch (error) {
		logger.error({ error, historyFile }, "Failed to load history");
		return [];
	}
}

export async function clearHistory(): Promise<void> {
	let config: Config;
	try {
		config = loadConfig();
	} catch {
		return;
	}

	const historyFile = config.paths.history;
	try {
		if (existsSync(historyFile)) {
			await atomicWriteFile(historyFile, JSON.stringify([], null, 2), {
				mode: 0o600,
			});
		}
	} catch (error) {
		logger.error({ error, historyFile }, "Failed to clear history");
	}
}
