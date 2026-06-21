import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir =
	(import.meta as { dir?: string }).dir ??
	fileURLToPath(new URL(".", import.meta.url));

export const projectRoot = join(dir, "..", "..");

export function getBundledOverlayPath(): string {
	return join(projectRoot, "overlay");
}
