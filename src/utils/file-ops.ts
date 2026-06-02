import {
	existsSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";

export async function atomicWriteFile(
	filePath: string,
	data: string,
	options?: { mode?: number },
): Promise<void> {
	const tmpPath = `${filePath}.tmp-${Date.now()}-${process.pid}`;
	try {
		await writeFile(tmpPath, data, options);
		await rename(tmpPath, filePath);
	} catch (e) {
		try {
			await unlink(tmpPath);
		} catch {}
		throw e;
	}
}

export function atomicWriteFileSync(
	filePath: string,
	data: string,
	options?: { mode?: number },
): void {
	const tmpPath = `${filePath}.tmp-${Date.now()}-${process.pid}`;
	try {
		writeFileSync(tmpPath, data, options);
		renameSync(tmpPath, filePath);
	} catch (e) {
		try {
			unlinkSync(tmpPath);
		} catch {}
		throw e;
	}
}

export async function ensureDir(dir: string, mode = 0o700): Promise<void> {
	if (!existsSync(dir)) {
		await mkdir(dir, { recursive: true, mode });
	}
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
	try {
		const content = await readFile(filePath, "utf-8");
		return JSON.parse(content) as T;
	} catch {
		return null;
	}
}

export async function readFileOrNull(filePath: string): Promise<string | null> {
	try {
		return await readFile(filePath, "utf-8");
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw e;
	}
}
