import { readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "../config/schema";
import { ensureDir } from "../utils/file-ops";
import { logger } from "../utils/logger";

function buildCaptureFilename(durationMs: number): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	return `${timestamp}-${durationMs}ms.wav`;
}

export async function saveDebugAudioCapture(
	config: Config,
	audioBuffer: Buffer,
	durationMs: number,
): Promise<void> {
	const debugAudio = config.transcription.debugAudio;
	if (!debugAudio.enabled) return;

	await ensureDir(debugAudio.directory);
	const filePath = join(
		debugAudio.directory,
		buildCaptureFilename(durationMs),
	);
	await writeFile(filePath, audioBuffer, { mode: 0o600 });

	const entries = await readdir(debugAudio.directory, { withFileTypes: true });
	const captureNames = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".wav"))
		.map((entry) => entry.name)
		.sort()
		.reverse();
	const staleNames = captureNames.slice(debugAudio.keepLast);

	await Promise.all(
		staleNames.map((name) =>
			rm(join(debugAudio.directory, name), { force: true }),
		),
	);

	logger.info(
		{
			filePath,
			keepLast: debugAudio.keepLast,
			removedCount: staleNames.length,
			durationMs,
			audioBytes: audioBuffer.length,
		},
		"Saved debug transcription audio",
	);
}
