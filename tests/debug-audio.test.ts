import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveDebugAudioCapture } from "../src/daemon/debug-audio";
import type { Config } from "../src/config/schema";

const tempDirs: string[] = [];

function createTestDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "hyprvox-debug-audio-"));
	tempDirs.push(dir);
	return dir;
}

function createConfig(directory: string, keepLast: number): Config {
	return {
		transcription: {
			debugAudio: {
				enabled: true,
				keepLast,
				directory,
			},
		},
	} as Config;
}

describe("saveDebugAudioCapture", () => {
	afterEach(() => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir && existsSync(dir)) {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});

	it("writes raw wav captures and keeps only the newest files", async () => {
		const directory = createTestDir();
		const config = createConfig(directory, 2);

		await saveDebugAudioCapture(config, Buffer.from("one"), 1000);
		await new Promise((resolve) => setTimeout(resolve, 5));
		await saveDebugAudioCapture(config, Buffer.from("two"), 2000);
		await new Promise((resolve) => setTimeout(resolve, 5));
		await saveDebugAudioCapture(config, Buffer.from("three"), 3000);

		const names = readdirSync(directory)
			.filter((name: string) => name.endsWith(".wav"))
			.sort();
		const newestName = names[1];
		if (!newestName) {
			throw new Error("Expected newest debug audio capture");
		}

		expect(names).toHaveLength(2);
		expect(names[0]).toContain("2000ms");
		expect(newestName).toContain("3000ms");
		expect(readFileSync(join(directory, newestName), "utf-8")).toBe("three");
		expect(statSync(join(directory, newestName)).mode & 0o777).toBe(0o600);
	});
});
