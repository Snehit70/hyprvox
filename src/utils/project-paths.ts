import { join } from "node:path";

export const projectRoot = join(import.meta.dir, "..", "..");

export function getBundledOverlayPath(): string {
	return join(projectRoot, "overlay");
}
