import {
	chmodSync,
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "../src/config/schema";
import {
	findWaylandDisplay,
	OverlayProcessManager,
} from "../src/daemon/overlay-process";

describe("findWaylandDisplay", () => {
	const runtimeDir = join(tmpdir(), `hyprvox-wayland-${process.pid}`);

	afterEach(() => {
		rmSync(runtimeDir, { recursive: true, force: true });
	});

	it("waits when a configured display does not exist yet", () => {
		mkdirSync(runtimeDir, { recursive: true });
		expect(findWaylandDisplay(runtimeDir, "wayland-0")).toBeUndefined();
	});

	it("discovers the live socket instead of trusting stale service variables", () => {
		mkdirSync(runtimeDir, { recursive: true });
		writeFileSync(join(runtimeDir, "wayland-1"), "");
		writeFileSync(join(runtimeDir, "wayland-1.lock"), "");

		expect(findWaylandDisplay(runtimeDir, "wayland-0")).toBe("wayland-1");
	});

	it("keeps a configured display once its socket exists", () => {
		mkdirSync(runtimeDir, { recursive: true });
		writeFileSync(join(runtimeDir, "wayland-0"), "");

		expect(findWaylandDisplay(runtimeDir, "wayland-0")).toBe("wayland-0");
	});
});

describe("OverlayProcessManager fallback", () => {
	const root = join(tmpdir(), `hyprvox-overlay-fallback-${process.pid}`);
	const runtimeDir = join(root, "runtime");
	const overlayDir = join(root, "overlay");
	const logsDir = join(root, "logs");
	const marker = join(root, "electron-started");
	const oldRuntimeDir = process.env.XDG_RUNTIME_DIR;
	const oldWaylandDisplay = process.env.WAYLAND_DISPLAY;
	let manager: OverlayProcessManager | undefined;

	afterEach(() => {
		manager?.stop();
		manager = undefined;
		if (oldRuntimeDir === undefined) delete process.env.XDG_RUNTIME_DIR;
		else process.env.XDG_RUNTIME_DIR = oldRuntimeDir;
		if (oldWaylandDisplay === undefined) delete process.env.WAYLAND_DISPLAY;
		else process.env.WAYLAND_DISPLAY = oldWaylandDisplay;
		rmSync(root, { recursive: true, force: true });
	});

	it("starts the guarded Electron backend after GTK exits", async () => {
		const electronBin = join(overlayDir, "node_modules", ".bin", "electron");
		mkdirSync(dirname(electronBin), { recursive: true });
		mkdirSync(runtimeDir, { recursive: true });
		writeFileSync(join(runtimeDir, "wayland-0"), "");
		writeFileSync(
			join(overlayDir, "hyprvox-overlay.py"),
			"raise SystemExit(1)\n",
		);
		writeFileSync(
			electronBin,
			`#!/bin/sh\nprintf started > ${JSON.stringify(marker)}\nexec sleep 30\n`,
		);
		chmodSync(electronBin, 0o755);
		process.env.XDG_RUNTIME_DIR = runtimeDir;
		process.env.WAYLAND_DISPLAY = "wayland-0";

		const config = {
			overlay: { enabled: true, autoStart: true, binaryPath: overlayDir },
			paths: { logs: logsDir },
		} as Config;
		manager = new OverlayProcessManager(
			config,
			join(root, "overlay.pid"),
			join(logsDir, "overlay.log"),
		);
		manager.start();

		const deadline = Date.now() + 4000;
		while (!existsSync(marker) && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}

		expect(existsSync(marker)).toBe(true);
	});

	it("waits at boot and starts GTK when the Wayland socket appears", async () => {
		mkdirSync(overlayDir, { recursive: true });
		mkdirSync(runtimeDir, { recursive: true });
		writeFileSync(
			join(overlayDir, "hyprvox-overlay.py"),
			`from pathlib import Path\nimport time\nPath(${JSON.stringify(marker)}).write_text("started")\ntime.sleep(30)\n`,
		);
		process.env.XDG_RUNTIME_DIR = runtimeDir;
		process.env.WAYLAND_DISPLAY = "wayland-0";

		const config = {
			overlay: { enabled: true, autoStart: true, binaryPath: overlayDir },
			paths: { logs: logsDir },
		} as Config;
		manager = new OverlayProcessManager(
			config,
			join(root, "overlay.pid"),
			join(logsDir, "overlay.log"),
		);
		manager.start();

		await new Promise((resolve) => setTimeout(resolve, 250));
		expect(existsSync(marker)).toBe(false);
		writeFileSync(join(runtimeDir, "wayland-0"), "");

		const deadline = Date.now() + 3500;
		while (!existsSync(marker) && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}

		expect(existsSync(marker)).toBe(true);
	});
});
