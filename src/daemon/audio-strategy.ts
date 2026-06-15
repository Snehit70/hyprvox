export type CompressionMode = "always" | "never" | "auto";

export function shouldCompressAudio(
	mode: CompressionMode,
	bufferSize: number,
	threshold: number,
): boolean {
	if (mode === "always") return true;
	if (mode === "never") return false;
	return bufferSize >= threshold;
}
