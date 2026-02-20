import { execSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";

describe.skipIf(isCI)("Daemon Crash Recovery Integration", () => {
	const testHome = join(tmpdir(), `voice-cli-crash-test-${Date.now()}`);
	const configDir = join(testHome, ".config", "voice-cli");
	const pidFile = join(configDir, "daemon.pid");
	const configFile = join(configDir, "config.json");
	const stateFile = join(configDir, "daemon.state");

	beforeEach(() => {
		if (existsSync(testHome)) {
			rmSync(testHome, { recursive: true, force: true });
		}
		mkdirSync(configDir, { recursive: true });

		const testConfig = {
			apiKeys: {
				groq: "gsk_test_12345678901234567890",
				deepgram: "00000000-0000-0000-0000-000000000000",
			},
			behavior: {
				hotkey: "RIGHT CONTROL",
				audioDevice: "default",
				clipboard: { append: true, minDuration: 0.6, maxDuration: 300 },
			},
			paths: {
				logs: join(configDir, "logs"),
				history: join(configDir, "history.json"),
			},
			transcription: {
				language: "en",
				boostWords: [],
			},
		};
		writeFileSync(configFile, JSON.stringify(testConfig), { mode: 0o600 });
	});

	afterEach(() => {
		try {
			execSync(`HOME=${testHome} bun run index.ts stop`, {
				env: { ...process.env, HOME: testHome },
				stdio: "ignore",
			});
		} catch (_e) {}

		if (existsSync(pidFile)) {
			try {
				const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
				process.kill(pid, "SIGKILL");
			} catch (_e) {}
		}

		rmSync(testHome, { recursive: true, force: true });
	});

	const getPid = () => {
		if (!existsSync(pidFile)) return null;
		try {
			return parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
		} catch (_e) {
			return null;
		}
	};

	const waitForDaemon = async (timeout = 10000) => {
		const start = Date.now();
		while (Date.now() - start < timeout) {
			const pid = getPid();
			if (pid && pid > 0) return pid;
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		throw new Error("Timeout waiting for daemon to start");
	};

	it("should auto-restart after a crash", async () => {
		const supervisorProcess = spawn("bun", ["run", "index.ts", "start"], {
			env: { ...process.env, HOME: testHome },
			stdio: "pipe",
		});

		const initialPid = await waitForDaemon();
		expect(initialPid).toBeGreaterThan(0);

		process.kill(initialPid, "SIGKILL");

		let newPid = 0;
		const start = Date.now();
		while (Date.now() - start < 15000) {
			const pid = getPid();
			if (pid && pid !== initialPid) {
				newPid = pid;
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}

		expect(
			newPid,
			"Daemon should have restarted with a new PID",
		).toBeGreaterThan(0);
		expect(newPid).not.toBe(initialPid);

		supervisorProcess.kill("SIGKILL");
	}, 30000);

	it("should stop after exceeding max restarts (3 crashes)", async () => {
		const supervisorProcess = spawn("bun", ["run", "index.ts", "start"], {
			env: { ...process.env, HOME: testHome },
			stdio: "pipe",
		});

		let currentPid = await waitForDaemon();
		const pids = [currentPid];

		for (let i = 0; i < 3; i++) {
			const pidToKill = currentPid;
			process.kill(pidToKill, "SIGKILL");

			const start = Date.now();
			let restarted = false;
			while (Date.now() - start < 10000) {
				const pid = getPid();
				if (pid && !pids.includes(pid)) {
					currentPid = pid;
					pids.push(pid);
					restarted = true;
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
			expect(
				restarted,
				`Daemon should have restarted after crash ${i + 1}`,
			).toBe(true);
		}

		process.kill(currentPid, "SIGKILL");

		await new Promise((resolve) => setTimeout(resolve, 5000));
		expect(
			existsSync(pidFile),
			"PID file should not exist after exceeding max restarts",
		).toBe(false);

		if (existsSync(stateFile)) {
			const state = JSON.parse(readFileSync(stateFile, "utf-8"));
			expect(state.status).toBe("error");
			expect(state.lastError).toContain("crashed 3 times in 5 minutes");
		}

		supervisorProcess.kill("SIGKILL");
	}, 60000);
});
