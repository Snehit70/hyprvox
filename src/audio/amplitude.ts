/**
 * Calculate RMS (Root Mean Square) amplitude from audio buffer
 * Returns normalized value between 0.0 and 1.0
 */
export function calculateAmplitude(buffer: Buffer): number {
	if (buffer.length === 0) {
		return 0;
	}

	// Audio is 16-bit PCM, so 2 bytes per sample
	const samples = buffer.length / 2;
	let sum = 0;

	for (let i = 0; i + 1 < buffer.length; i += 2) {
		// Read 16-bit signed integer (little-endian)
		const sample = buffer.readInt16LE(i);
		// Normalize to -1.0 to 1.0 range
		const normalized = sample / 32768;
		sum += normalized * normalized;
	}

	// Calculate RMS
	const rms = Math.sqrt(sum / samples);

	// Clamp to 0.0 - 1.0 range
	return Math.min(Math.max(rms, 0), 1);
}

/**
 * Calculate amplitude with smoothing (exponential moving average)
 */
export class AmplitudeCalculator {
	private lastAmplitude = 0;
	private readonly smoothingFactor: number;

	constructor(smoothingFactor = 0.3) {
		this.smoothingFactor = smoothingFactor;
	}

	calculate(buffer: Buffer): number {
		const currentAmplitude = calculateAmplitude(buffer);

		// Apply exponential moving average for smoother visualization
		this.lastAmplitude =
			this.smoothingFactor * currentAmplitude +
			(1 - this.smoothingFactor) * this.lastAmplitude;

		return this.lastAmplitude;
	}

	reset(): void {
		this.lastAmplitude = 0;
	}
}
