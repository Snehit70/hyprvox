import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node-notifier", () => ({
	default: {
		notify: vi.fn(),
	},
}));

import { notifyWithConfig } from "../src/output/notification";
import notifier from "node-notifier";

describe("notification output", () => {
	const loadConfig = () =>
		({
			behavior: { notifications: true },
		}) as ReturnType<typeof import("../src/config/loader").loadConfig>;

	afterEach(() => {
		delete process.env.HYPRVOX_TEST_MODE;
		vi.clearAllMocks();
	});

	it("suppresses desktop notification in test mode", () => {
		process.env.HYPRVOX_TEST_MODE = "1";
		notifyWithConfig("Test", "Message", "info", loadConfig);
		expect(notifier.notify).not.toHaveBeenCalled();
	});

	it("sends desktop notification when not in test mode", () => {
		notifyWithConfig("Ready", "Done", "success", loadConfig);
		expect(notifier.notify).toHaveBeenCalledTimes(1);
	});
});
