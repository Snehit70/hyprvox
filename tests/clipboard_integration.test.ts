import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClipboardManager } from "../src/output/clipboard";

const TEST_CONFIG_DIR = join(homedir(), ".config", "voice-cli-test");
const TEST_CONFIG_FILE = join(TEST_CONFIG_DIR, "config.json");

vi.mock("../src/config/loader", () => ({
	loadConfig: vi.fn(() => {
		if (existsSync(TEST_CONFIG_FILE)) {
			return JSON.parse(readFileSync(TEST_CONFIG_FILE, "utf-8"));
		}
		throw new Error("Config file not found");
	}),
}));

describe.skip("ClipboardManager Integration", () => {
	let manager: ClipboardManager;
	let originalContent: string;

	beforeEach(async () => {
		if (!existsSync(TEST_CONFIG_DIR)) {
			mkdirSync(TEST_CONFIG_DIR, { recursive: true });
		}

		const testConfig = {
			apiKeys: {
				groq: "gsk_test_long_enough",
				deepgram: "00000000-0000-0000-0000-000000000000",
			},
			behavior: {
				clipboard: {
					append: true,
					minDuration: 0.6,
					maxDuration: 300,
				},
			},
			paths: {
				logs: "~/.config/voice-cli-test/logs",
				history: "~/.config/voice-cli-test/history.json",
			},
		};
		writeFileSync(TEST_CONFIG_FILE, JSON.stringify(testConfig), {
			mode: 0o600,
		});

		manager = new ClipboardManager();

		try {
			originalContent = await (manager as any).read();
		} catch (_e) {
			originalContent = "";
		}
	});

	afterEach(async () => {
		try {
			await (manager as any).write(originalContent);
		} catch (_e) {}

		if (existsSync(TEST_CONFIG_FILE)) {
			unlinkSync(TEST_CONFIG_FILE);
		}
	});

	it("verifies clipboard writes separate entries (integration)", async () => {
		const firstText = `Test Line 1 (${Date.now()})`;
		const secondText = `Test Line 2 (${Date.now()})`;

		await manager.append(firstText);
		const firstRead = await (manager as any).read();
		expect(firstRead).toBe(firstText);

		await new Promise((resolve) => setTimeout(resolve, 100));

		await manager.append(secondText);
		const secondRead = await (manager as any).read();
		expect(secondRead).toBe(secondText);
	});
});
