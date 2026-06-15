import { describe, expect, test } from "vitest";
import type { loadConfig } from "../src/config/loader";
import { ConfigFileSchema } from "../src/config/schema";
import { runSetupChecks } from "../src/setup/checks";
import { mergeConfig } from "../src/setup/config-patch";
import {
	detectEnvironment,
	type EnvironmentInfo,
	getInstallCommand,
} from "../src/setup/environment";

function makeEnv(overrides: Partial<EnvironmentInfo> = {}): EnvironmentInfo {
	return {
		platform: "linux",
		isLinux: true,
		isContainer: false,
		distro: "fedora",
		sessionType: "wayland",
		isHyprland: true,
		commands: {
			bun: { name: "bun", path: "/usr/bin/bun" },
			ffmpeg: { name: "ffmpeg", path: "/usr/bin/ffmpeg" },
			arecord: { name: "arecord", path: "/usr/bin/arecord" },
			"wl-copy": { name: "wl-copy", path: "/usr/bin/wl-copy" },
			xclip: { name: "xclip", path: null },
			xsel: { name: "xsel", path: null },
			"notify-send": { name: "notify-send", path: "/usr/bin/notify-send" },
			systemctl: { name: "systemctl", path: "/usr/bin/systemctl" },
			hyprctl: { name: "hyprctl", path: "/usr/bin/hyprctl" },
		},
		...overrides,
	};
}

describe("setup environment detection", () => {
	test("detects Fedora Wayland Hyprland environment", () => {
		const env = detectEnvironment({
			env: {
				WAYLAND_DISPLAY: "wayland-1",
				HYPRLAND_INSTANCE_SIGNATURE: "abc",
			},
			exists: (path) => path === "/etc/os-release",
			readFile: () => 'ID=fedora\nNAME="Fedora Linux"',
			which: (command) => (command === "hyprctl" ? "/usr/bin/hyprctl" : null),
			platform: "linux",
		});

		expect(env.distro).toBe("fedora");
		expect(env.sessionType).toBe("wayland");
		expect(env.isHyprland).toBe(true);
		expect(env.isLinux).toBe(true);
	});

	test("detects Docker-style headless container", () => {
		const env = detectEnvironment({
			env: { container: "docker" },
			exists: (path) => path === "/.dockerenv",
			readFile: () => "",
			which: () => null,
			platform: "linux",
		});

		expect(env.isContainer).toBe(true);
		expect(env.sessionType).toBe("headless");
	});

	test("returns distro-specific install commands", () => {
		expect(getInstallCommand("fedora", "wayland")).toContain("dnf install");
		expect(getInstallCommand("arch", "wayland")).toContain("pacman");
		expect(getInstallCommand("ubuntu", "x11")).toContain("xclip");
		expect(getInstallCommand("unknown", "wayland")).toBeNull();
	});
});

describe("setup config patches", () => {
	test("does not create empty apiKeys when patching unrelated sections", () => {
		const nextConfig = mergeConfig({}, { behavior: { notifications: false } });

		expect(nextConfig.apiKeys).toBeUndefined();
		expect(ConfigFileSchema.safeParse(nextConfig).success).toBe(true);
	});

	test("preserves partial API keys during setup", () => {
		const nextConfig = mergeConfig(
			{ apiKeys: { groq: "gsk_existing" } },
			{ transcription: { streaming: true } },
		);

		expect(nextConfig.apiKeys).toEqual({ groq: "gsk_existing" });
		expect(ConfigFileSchema.safeParse(nextConfig).success).toBe(true);
	});
});

describe("setup checks", () => {
	test("marks missing config as a setup blocker", () => {
		const report = runSetupChecks({
			envInfo: makeEnv(),
			configPath: "/tmp/missing-hyprvox-config.json",
			exists: () => false,
			readFile: () => "",
			statMode: () => 0o600,
			loadConfigFn: (() => {
				throw new Error("should not load missing config");
			}) as unknown as typeof loadConfig,
		});

		expect(report.ready).toBe(false);
		expect(report.checks).toContainEqual(
			expect.objectContaining({
				id: "config.exists",
				status: "fail",
			}),
		);
		expect(report.nextSteps).toContain(
			"Run hyprvox setup or hyprvox config init.",
		);
	});

	test("downgrades host-only checks in containers", () => {
		const env = makeEnv({
			isContainer: true,
			sessionType: "headless",
			commands: {
				...makeEnv().commands,
				arecord: { name: "arecord", path: null },
				"wl-copy": { name: "wl-copy", path: null },
				systemctl: { name: "systemctl", path: null },
			},
		});

		const report = runSetupChecks({
			envInfo: env,
			configPath: "/tmp/config.json",
			exists: (path) => path === "/tmp/config.json",
			readFile: () => "",
			statMode: () => 0o600,
			loadConfigFn: (() => ({
				apiKeys: {
					groq: "gsk_1234567890",
					deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
				},
			})) as unknown as typeof loadConfig,
		});

		expect(report.checks).toContainEqual(
			expect.objectContaining({ id: "command.arecord", status: "warn" }),
		);
		expect(report.checks).toContainEqual(
			expect.objectContaining({ id: "command.clipboard", status: "warn" }),
		);
		expect(report.checks).toContainEqual(
			expect.objectContaining({ id: "command.systemctl", status: "warn" }),
		);
	});
});
