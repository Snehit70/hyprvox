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
import { resolveSetupHotkey } from "../src/setup/hotkey";
import { verifyProviderAuth } from "../src/setup/verification";

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

	test("resolves hotkey from one setup decision without silent override", () => {
		const config = { behavior: { hotkey: "Ctrl+Space" } };

		expect(resolveSetupHotkey(config, "built-in")).toBe("Ctrl+Space");
		expect(resolveSetupHotkey(config, "compositor")).toBe("disabled");
		expect(resolveSetupHotkey({}, "built-in")).toBe("Right Control");
	});
});

describe("setup provider verification", () => {
	const config = {
		apiKeys: {
			groq: "gsk_configured",
			deepgram: "4b5c1234-5678-90ab-cdef-1234567890ab",
		},
	};

	test("passes when both injected provider checks succeed", async () => {
		const report = await verifyProviderAuth(config, {
			groq: async () => {},
			deepgram: async () => {},
		});

		expect(report.hasBlockingFailure).toBe(false);
		expect(report.offline).toBe(false);
		expect(report.results).toEqual([
			expect.objectContaining({ provider: "groq", status: "pass" }),
			expect.objectContaining({ provider: "deepgram", status: "pass" }),
		]);
	});

	test("marks invalid authentication as a blocking failure", async () => {
		const report = await verifyProviderAuth(config, {
			groq: async () => {
				throw Object.assign(new Error("401 unauthorized"), { status: 401 });
			},
			deepgram: async () => {},
		});

		expect(report.hasBlockingFailure).toBe(true);
		expect(report.results).toContainEqual(
			expect.objectContaining({
				provider: "groq",
				status: "fail",
				blocking: true,
			}),
		);
	});

	test("warns and continues on offline/network failures", async () => {
		const report = await verifyProviderAuth(config, {
			groq: async () => {},
			deepgram: async () => {
				throw Object.assign(new Error("fetch failed"), { code: "ENOTFOUND" });
			},
		});

		expect(report.hasBlockingFailure).toBe(false);
		expect(report.offline).toBe(true);
		expect(report.results).toContainEqual(
			expect.objectContaining({
				provider: "deepgram",
				status: "warn",
				blocking: false,
			}),
		);
	});

	test("skips missing keys without calling provider transport", async () => {
		let called = false;
		const report = await verifyProviderAuth(
			{},
			{
				groq: async () => {
					called = true;
				},
				deepgram: async () => {
					called = true;
				},
			},
		);

		expect(called).toBe(false);
		expect(report.hasBlockingFailure).toBe(false);
		expect(report.results).toEqual([
			expect.objectContaining({ provider: "groq", status: "skip" }),
			expect.objectContaining({ provider: "deepgram", status: "skip" }),
		]);
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
