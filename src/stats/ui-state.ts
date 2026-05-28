import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type StatsTab = "overview" | "quality" | "pipeline" | "trends" | "exports";
export type StatsWindowPreset = "15m" | "1h" | "6h" | "24h" | "7d";

export interface StatsUiState {
	activeTab: StatsTab;
	windowPreset: StatsWindowPreset;
	filter: string;
}

const UI_STATE_FILE = join(homedir(), ".config", "hypr", "vox", "stats-ui-state.json");

const DEFAULT_UI_STATE: StatsUiState = {
	activeTab: "overview",
	windowPreset: "1h",
	filter: "all",
};

export async function loadStatsUiState(): Promise<StatsUiState> {
	if (!existsSync(UI_STATE_FILE)) return DEFAULT_UI_STATE;
	try {
		const raw = JSON.parse(await readFile(UI_STATE_FILE, "utf-8")) as Partial<StatsUiState>;
		return {
			activeTab:
				raw.activeTab === "quality" ||
				raw.activeTab === "pipeline" ||
				raw.activeTab === "trends" ||
				raw.activeTab === "exports" ||
				raw.activeTab === "overview"
					? raw.activeTab
					: DEFAULT_UI_STATE.activeTab,
			windowPreset:
				raw.windowPreset === "15m" ||
				raw.windowPreset === "1h" ||
				raw.windowPreset === "6h" ||
				raw.windowPreset === "24h" ||
				raw.windowPreset === "7d"
					? raw.windowPreset
					: DEFAULT_UI_STATE.windowPreset,
			filter: typeof raw.filter === "string" ? raw.filter : DEFAULT_UI_STATE.filter,
		};
	} catch {
		return DEFAULT_UI_STATE;
	}
}

export async function saveStatsUiState(state: StatsUiState): Promise<void> {
	await mkdir(dirname(UI_STATE_FILE), { recursive: true, mode: 0o700 });
	await writeFile(UI_STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
	await chmod(UI_STATE_FILE, 0o600);
}

export { DEFAULT_UI_STATE };
