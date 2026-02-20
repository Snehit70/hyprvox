import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as loader from "../../src/config/loader";
import {
	appendHistory,
	clearHistory,
	type HistoryItem,
	loadHistory,
} from "../../src/utils/history";

describe("History Storage Integration", () => {
	const TEST_DIR = join(
		tmpdir(),
		`hyprvox-history-integration-${Math.random().toString(36).slice(2)}`,
	);
	const HISTORY_FILE = join(TEST_DIR, "history.json");

	beforeEach(() => {
		if (existsSync(TEST_DIR)) {
			rmSync(TEST_DIR, { recursive: true, force: true });
		}
		mkdirSync(TEST_DIR, { recursive: true });

		vi.spyOn(loader, "loadConfig").mockReturnValue({
			paths: {
				history: HISTORY_FILE,
			},
		} as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		if (existsSync(TEST_DIR)) {
			rmSync(TEST_DIR, { recursive: true, force: true });
		}
	});

	it("should persist history items to disk", async () => {
		const item: HistoryItem = {
			timestamp: new Date().toISOString(),
			text: "Integration test message",
			duration: 2.5,
			engine: "groq",
			processingTime: 450,
		};

		await appendHistory(item);

		expect(existsSync(HISTORY_FILE)).toBe(true);

		const content = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
		expect(content).toHaveLength(1);
		expect(content[0]).toEqual(item);

		const loaded = await loadHistory();
		expect(loaded).toHaveLength(1);
		expect(loaded[0]).toEqual(item);
	});

	it("should set correct file permissions (600)", async () => {
		const item: HistoryItem = {
			timestamp: new Date().toISOString(),
			text: "Permission test",
			duration: 1,
			engine: "test",
			processingTime: 100,
		};

		await appendHistory(item);

		const stats = statSync(HISTORY_FILE);
		expect(stats.mode & 0o777).toBe(0o600);
	});

	it("should handle directory creation if it does not exist", async () => {
		const nestedDir = join(TEST_DIR, "deep", "nested", "dir");
		const nestedFile = join(nestedDir, "history.json");

		vi.spyOn(loader, "loadConfig").mockReturnValue({
			paths: {
				history: nestedFile,
			},
		} as any);

		const item: HistoryItem = {
			timestamp: new Date().toISOString(),
			text: "Nested path test",
			duration: 1,
			engine: "test",
			processingTime: 100,
		};

		await appendHistory(item);

		expect(existsSync(nestedFile)).toBe(true);
		expect(await loadHistory()).toHaveLength(1);
	});

	it("should enforce the 1000 item limit across multiple appends", async () => {
		for (let i = 0; i < 1050; i++) {
			await appendHistory({
				timestamp: new Date().toISOString(),
				text: `Message ${i}`,
				duration: 1,
				engine: "test",
				processingTime: 10,
			});
		}

		const history = await loadHistory();
		expect(history).toHaveLength(1000);

		expect(history[0]?.text).toBe("Message 50");
		expect(history[999]?.text).toBe("Message 1049");

		const onDisk = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
		expect(onDisk).toHaveLength(1000);
		expect(onDisk[0].text).toBe("Message 50");
	});

	it("should clear history from disk", async () => {
		await appendHistory({
			timestamp: new Date().toISOString(),
			text: "Temp message",
			duration: 1,
			engine: "test",
			processingTime: 10,
		});

		expect(existsSync(HISTORY_FILE)).toBe(true);

		await clearHistory();

		const loaded = await loadHistory();
		expect(loaded).toEqual([]);

		const onDisk = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
		expect(onDisk).toEqual([]);
	});

	it("should recover from corrupted history file", async () => {
		mkdirSync(TEST_DIR, { recursive: true });
		require("node:fs").writeFileSync(HISTORY_FILE, "invalid json { {");

		const item: HistoryItem = {
			timestamp: new Date().toISOString(),
			text: "Recovery test",
			duration: 1,
			engine: "test",
			processingTime: 100,
		};

		await appendHistory(item);

		const history = await loadHistory();
		expect(history).toHaveLength(1);
		expect(history[0]?.text).toBe("Recovery test");
	});
});
