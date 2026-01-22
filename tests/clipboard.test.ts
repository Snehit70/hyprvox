import { exec, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { appendFileSync } from "node:fs";
import clipboardy from "clipboardy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config/loader";
import { ClipboardManager } from "../src/output/clipboard";

vi.mock("clipboardy", () => ({
	default: {
		read: vi.fn(),
		write: vi.fn(),
	},
}));

vi.mock("../src/config/loader", () => ({
	loadConfig: vi.fn(() => ({
		behavior: {
			clipboard: {
				append: true,
			},
		},
	})),
}));

vi.mock("../src/utils/logger", () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
	logError: vi.fn(),
}));

vi.mock("node:fs", () => ({
	appendFileSync: vi.fn(),
	existsSync: vi.fn(() => true),
	mkdirSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	exec: vi.fn(),
	spawn: vi.fn(),
}));

describe("ClipboardManager", () => {
	let manager: ClipboardManager;

	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.WAYLAND_DISPLAY;
		manager = new ClipboardManager();
	});

	it("should write text as new clipboard entry", async () => {
		(clipboardy.write as any).mockResolvedValue(undefined);

		await manager.append("new");

		expect(clipboardy.write).toHaveBeenCalledWith("new");
	});

	it("should fallback to file if clipboard write fails and throw ClipboardAccessError", async () => {
		(clipboardy.write as any).mockRejectedValue(new Error("clipboard fail"));

		await expect(manager.append("new")).rejects.toThrow(
			"Failed to write to clipboard",
		);
		expect(appendFileSync).toHaveBeenCalled();
	});

	describe("Wayland Support", () => {
		beforeEach(() => {
			process.env.WAYLAND_DISPLAY = "wayland-0";
			manager = new ClipboardManager();
		});

		const mockSpawnSuccess = () => {
			const mockStdin = { write: vi.fn(), end: vi.fn() };
			const mockChild = new EventEmitter();
			(mockChild as any).stdin = mockStdin;
			(spawn as any).mockReturnValue(mockChild as any);
			setTimeout(() => mockChild.emit("close", 0), 10);
			return { mockChild, mockStdin };
		};

		it("should use wl-copy to write clipboard on Wayland", async () => {
			const { mockStdin } = mockSpawnSuccess();

			const promise = manager.append("new");
			await promise;

			expect(spawn).toHaveBeenCalledWith(
				"wl-copy",
				expect.any(Array),
				expect.any(Object),
			);
			expect(mockStdin.write).toHaveBeenCalled();
		});
	});
});
