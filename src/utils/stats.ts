import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { atomicWriteFile } from "./file-ops";
import { logger } from "./logger";

export interface TranscriptionStats {
	today: number;
	total: number;
	lastDate: string;
}

const STATS_FILE = join(homedir(), ".config", "hypr", "vox", "stats.json");

export function loadStats(): TranscriptionStats {
	const todayDate =
		new Date().toISOString().split("T")[0] ||
		new Date().toLocaleDateString("en-CA");

	if (!existsSync(STATS_FILE)) {
		return {
			today: 0,
			total: 0,
			lastDate: todayDate,
		};
	}

	try {
		const data = JSON.parse(
			readFileSync(STATS_FILE, "utf-8"),
		) as Partial<TranscriptionStats>;
		const total = typeof data.total === "number" ? data.total : 0;
		const today = typeof data.today === "number" ? data.today : 0;
		const lastDate =
			typeof data.lastDate === "string" ? data.lastDate : todayDate;

		if (lastDate !== todayDate) {
			return {
				today: 0,
				total,
				lastDate: todayDate,
			};
		}

		return {
			today,
			total,
			lastDate,
		};
	} catch {
		return {
			today: 0,
			total: 0,
			lastDate: todayDate,
		};
	}
}

export async function saveStats(stats: TranscriptionStats): Promise<void> {
	const dir = dirname(STATS_FILE);
	if (!existsSync(dir)) {
		await mkdir(dir, { recursive: true });
	}

	try {
		await atomicWriteFile(STATS_FILE, JSON.stringify(stats, null, 2), {
			mode: 0o600,
		});
	} catch (e) {
		logger.warn({ err: e, path: STATS_FILE }, "Failed to save stats file");
	}
}

export async function incrementTranscriptionCount(): Promise<TranscriptionStats> {
	const stats = loadStats();
	stats.today += 1;
	stats.total += 1;
	await saveStats(stats);
	return stats;
}
