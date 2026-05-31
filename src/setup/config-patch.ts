import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_CONFIG_FILE } from "../config/loader";
import type { ConfigFile } from "../config/schema";

export type ConfigPatch = Omit<
	Partial<ConfigFile>,
	"apiKeys" | "behavior" | "transcription"
> & {
	apiKeys?: Partial<NonNullable<ConfigFile["apiKeys"]>>;
	behavior?: Partial<Omit<NonNullable<ConfigFile["behavior"]>, "clipboard">> & {
		clipboard?: Partial<
			NonNullable<NonNullable<ConfigFile["behavior"]>["clipboard"]>
		>;
	};
	transcription?: Partial<
		Omit<
			NonNullable<ConfigFile["transcription"]>,
			"groqChunking" | "statsThresholds"
		>
	> & {
		groqChunking?: Partial<
			NonNullable<NonNullable<ConfigFile["transcription"]>["groqChunking"]>
		>;
		statsThresholds?: Partial<
			NonNullable<NonNullable<ConfigFile["transcription"]>["statsThresholds"]>
		>;
	};
};

export function mergeConfig(
	base: ConfigFile,
	updates: ConfigPatch,
): ConfigFile {
	const next: ConfigFile = {
		...base,
		...updates,
	};

	if (base.apiKeys !== undefined || updates.apiKeys !== undefined) {
		const apiKeys = Object.fromEntries(
			Object.entries({
				...(base.apiKeys ?? {}),
				...(updates.apiKeys ?? {}),
			}).filter(([, value]) => value !== undefined),
		) as ConfigFile["apiKeys"];
		if (apiKeys && Object.keys(apiKeys).length > 0) {
			next.apiKeys = apiKeys;
		} else {
			delete next.apiKeys;
		}
	}

	if (base.behavior !== undefined || updates.behavior !== undefined) {
		next.behavior = {
			...(base.behavior ?? {}),
			...(updates.behavior ?? {}),
		};
		if (
			base.behavior?.clipboard !== undefined ||
			updates.behavior?.clipboard !== undefined
		) {
			next.behavior.clipboard = {
				...(base.behavior?.clipboard ?? {}),
				...(updates.behavior?.clipboard ?? {}),
			};
		}
	}

	if (base.transcription !== undefined || updates.transcription !== undefined) {
		next.transcription = {
			...(base.transcription ?? {}),
			...(updates.transcription ?? {}),
		};
		if (
			base.transcription?.groqChunking !== undefined ||
			updates.transcription?.groqChunking !== undefined
		) {
			next.transcription.groqChunking = {
				...(base.transcription?.groqChunking ?? {}),
				...(updates.transcription?.groqChunking ?? {}),
			};
		}
		if (
			base.transcription?.statsThresholds !== undefined ||
			updates.transcription?.statsThresholds !== undefined
		) {
			next.transcription.statsThresholds = {
				...(base.transcription?.statsThresholds ?? {}),
				...(updates.transcription?.statsThresholds ?? {}),
			};
		}
	}

	return next;
}

export function loadPartialConfig(path = DEFAULT_CONFIG_FILE): ConfigFile {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as ConfigFile;
	} catch {
		return {};
	}
}

export function rollbackProfileDerivedFields(
	current: ConfigFile,
	baseline: ConfigFile,
): ConfigFile {
	return mergeConfig(current, {
		transcription: {
			streaming: baseline.transcription?.streaming,
			deepgramBoosting: baseline.transcription?.deepgramBoosting,
			mergeModel: baseline.transcription?.mergeModel,
			statsMinSampleSize: baseline.transcription?.statsMinSampleSize,
			statsThresholds: baseline.transcription?.statsThresholds,
		},
		behavior: {
			notifications: baseline.behavior?.notifications,
			hotkey: baseline.behavior?.hotkey,
		},
	});
}
