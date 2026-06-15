import { clearConfigCache } from "../../src/config/loader";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";

const workerId = process.env.VITEST_POOL_ID ?? "0";
const previousHome = process.env.HOME;
const previousRuntime = process.env.XDG_RUNTIME_DIR;
let isolatedHome = "";

beforeAll(() => {
	isolatedHome = mkdtempSync(join(tmpdir(), `hyprvox-integration-home-${workerId}-`));
	const isolatedRuntimeDir = join(isolatedHome, ".runtime");
	mkdirSync(isolatedRuntimeDir, { recursive: true });
	process.env.HOME = isolatedHome;
	process.env.XDG_RUNTIME_DIR = isolatedRuntimeDir;
	clearConfigCache();
});

afterAll(() => {
	if (previousHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = previousHome;
	}
	if (previousRuntime === undefined) {
		delete process.env.XDG_RUNTIME_DIR;
	} else {
		process.env.XDG_RUNTIME_DIR = previousRuntime;
	}
	if (isolatedHome) {
		rmSync(isolatedHome, { recursive: true, force: true });
	}
	clearConfigCache();
});
