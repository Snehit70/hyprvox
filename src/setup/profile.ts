import { cpus, totalmem } from "node:os";
import type { ConfigFile } from "../config/schema";
import type { EnvironmentInfo } from "./environment";

export type SetupProfileId =
	| "desktop-balanced"
	| "laptop-lowpower"
	| "container-headless";

export interface DeviceSignals {
	environment: EnvironmentInfo;
	audioDeviceCount: number;
	cpuCount: number;
	ramGiB: number;
	hasClipboard: boolean;
	hasNotifications: boolean;
}

export interface ProfileRecommendation {
	profile: SetupProfileId;
	confidence: "low" | "medium" | "high";
	reasons: string[];
}

export interface ProfileBundle {
	id: SetupProfileId;
	label: string;
	description: string;
	apply(config: ConfigFile): ConfigFile;
}

const profileBundles: Record<SetupProfileId, ProfileBundle> = {
	"container-headless": {
		id: "container-headless",
		label: "Container Headless",
		description: "Safe defaults for container/headless runs",
		apply(config) {
			return {
				...config,
				transcription: {
					...config.transcription,
					streaming: false,
					deepgramBoosting: false,
					mergeModel: "llama-3.1-8b-instant",
					statsMinSampleSize: 5,
				},
				behavior: {
					...config.behavior,
					notifications: false,
					hotkey: "disabled",
				},
			};
		},
	},
	"laptop-lowpower": {
		id: "laptop-lowpower",
		label: "Laptop Low Power",
		description: "Lower-cost defaults with reduced compute pressure",
		apply(config) {
			return {
				...config,
				transcription: {
					...config.transcription,
					streaming: true,
					deepgramBoosting: false,
					mergeModel: "llama-3.1-8b-instant",
					statsThresholds: {
						...config.transcription?.statsThresholds,
						latencyP95WarnMs: 7000,
						latencyP95BadMs: 9000,
					},
					statsMinSampleSize: 12,
				},
				behavior: {
					...config.behavior,
					notifications: true,
				},
			};
		},
	},
	"desktop-balanced": {
		id: "desktop-balanced",
		label: "Desktop Balanced",
		description: "Balanced quality and speed for desktop usage",
		apply(config) {
			return {
				...config,
				transcription: {
					...config.transcription,
					streaming: true,
					deepgramBoosting: true,
					mergeModel: "llama-3.3-70b-versatile",
					statsThresholds: {
						...config.transcription?.statsThresholds,
						latencyP95WarnMs: 6700,
						latencyP95BadMs: 8500,
						errorWarnCount24h: 10,
						errorBadCount24h: 26,
						qualityWarnCount24h: 1,
						qualityBadCount24h: 2,
					},
					statsMinSampleSize: 12,
				},
				behavior: {
					...config.behavior,
					notifications: true,
				},
			};
		},
	},
};

export function getProfileBundle(profileId: SetupProfileId): ProfileBundle {
	return profileBundles[profileId];
}

export function collectDeviceSignals(
	environment: EnvironmentInfo,
	audioDeviceCount: number,
): DeviceSignals {
	const cpuCount = cpus().length;
	const ramGiB = Math.max(1, Math.round(totalmem() / 1024 / 1024 / 1024));
	const hasClipboard = Boolean(
		environment.commands["wl-copy"]?.path ||
			environment.commands.xclip?.path ||
			environment.commands.xsel?.path,
	);
	const hasNotifications = Boolean(environment.commands["notify-send"]?.path);
	return {
		environment,
		audioDeviceCount,
		cpuCount,
		ramGiB,
		hasClipboard,
		hasNotifications,
	};
}

export function recommendProfile(
	signals: DeviceSignals,
): ProfileRecommendation {
	const reasons: string[] = [];
	if (
		signals.environment.isContainer ||
		signals.environment.sessionType === "headless"
	) {
		reasons.push("container/headless session detected");
		return { profile: "container-headless", confidence: "high", reasons };
	}

	let scoreDesktop = 0;
	let scoreLaptop = 0;

	if (signals.cpuCount >= 8) {
		scoreDesktop += 2;
		reasons.push(`cpu cores ${signals.cpuCount} favor desktop-balanced`);
	} else {
		scoreLaptop += 2;
		reasons.push(`cpu cores ${signals.cpuCount} favor laptop-lowpower`);
	}
	if (signals.ramGiB >= 16) {
		scoreDesktop += 2;
		reasons.push(`ram ${signals.ramGiB}GiB favors desktop-balanced`);
	} else {
		scoreLaptop += 2;
		reasons.push(`ram ${signals.ramGiB}GiB favors laptop-lowpower`);
	}
	if (signals.audioDeviceCount <= 1) {
		scoreLaptop += 1;
		reasons.push("single audio device detected");
	} else {
		scoreDesktop += 1;
		reasons.push("multiple audio devices detected");
	}
	if (!signals.hasNotifications) {
		scoreLaptop += 1;
		reasons.push("notifications missing; conservative profile preferred");
	}

	const profile: SetupProfileId =
		scoreDesktop >= scoreLaptop ? "desktop-balanced" : "laptop-lowpower";
	const delta = Math.abs(scoreDesktop - scoreLaptop);
	const confidence = delta >= 3 ? "high" : delta === 2 ? "medium" : "low";
	return { profile, confidence, reasons };
}

type ConfigDiffPath = readonly [
	keyof ConfigFile,
	...(string | number | symbol)[],
];

function pickConfigValue(obj: ConfigFile, path: ConfigDiffPath): unknown {
	return path.reduce<unknown>((acc, key) => {
		if (typeof acc !== "object" || acc === null) return undefined;
		return (acc as Record<string | number | symbol, unknown>)[key];
	}, obj);
}

export function diffConfig(before: ConfigFile, after: ConfigFile): string[] {
	const lines: string[] = [];
	const trackedPaths: ConfigDiffPath[] = [
		["transcription", "streaming"],
		["transcription", "deepgramBoosting"],
		["transcription", "mergeModel"],
		["transcription", "statsMinSampleSize"],
		["transcription", "statsThresholds", "latencyP95WarnMs"],
		["transcription", "statsThresholds", "latencyP95BadMs"],
		["transcription", "statsThresholds", "errorWarnCount24h"],
		["transcription", "statsThresholds", "errorBadCount24h"],
		["transcription", "statsThresholds", "qualityWarnCount24h"],
		["transcription", "statsThresholds", "qualityBadCount24h"],
		["behavior", "notifications"],
		["behavior", "hotkey"],
	];

	for (const path of trackedPaths) {
		const oldV = pickConfigValue(before, path);
		const newV = pickConfigValue(after, path);
		if (JSON.stringify(oldV) !== JSON.stringify(newV)) {
			lines.push(
				`${path.join(".")}: ${JSON.stringify(oldV)} -> ${JSON.stringify(newV)}`,
			);
		}
	}
	return lines;
}
