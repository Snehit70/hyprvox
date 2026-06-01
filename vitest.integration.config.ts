import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/integration/*.test.ts"],
		setupFiles: ["tests/integration/setup.ts"],
		fileParallelism: false,
		maxWorkers: 1,
		testTimeout: 120000,
	},
});
