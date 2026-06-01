import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node-notifier", () => ({
	default: {
		notify: vi.fn(),
	},
}));

vi.mock("../src/config/loader", () => ({
	loadConfig: vi.fn(() => ({
		behavior: { notifications: true },
	})),
}));

import { notify } from "../src/output/notification";
import notifier from "node-notifier";

describe("notification output", () => {
	afterEach(() => {
		delete process.env.HYPRVOX_TEST_MODE;
		vi.clearAllMocks();
	});

	it("suppresses desktop notification in test mode", () => {
		process.env.HYPRVOX_TEST_MODE = "1";
		notify("Test", "Message", "info");
		expect(notifier.notify).not.toHaveBeenCalled();
	});

	it("sends desktop notification when not in test mode", () => {
		notify("Ready", "Done", "success");
		expect(notifier.notify).toHaveBeenCalledTimes(1);
	});
});
