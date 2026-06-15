export interface PcmStreamChunk {
	pcm: Buffer;
	sampleRate: 16000;
	channels: 1;
	bitsPerSample: 16;
}

export class PcmStreamExtractor {
	private seenWaveHeader = false;
	private pendingWaveHeader = Buffer.alloc(0);
	private pendingOddByte = Buffer.alloc(0);

	public reset(): void {
		this.seenWaveHeader = false;
		this.pendingWaveHeader = Buffer.alloc(0);
		this.pendingOddByte = Buffer.alloc(0);
	}

	public accept(chunk: Buffer): PcmStreamChunk | null {
		const pcmChunk = this.extractPcmChunk(chunk);
		const aligned = this.alignPcmChunk(pcmChunk);
		if (aligned.length === 0) return null;
		return {
			pcm: aligned,
			sampleRate: 16000,
			channels: 1,
			bitsPerSample: 16,
		};
	}

	private extractPcmChunk(chunk: Buffer): Buffer {
		if (!this.seenWaveHeader) {
			this.pendingWaveHeader = Buffer.concat([this.pendingWaveHeader, chunk]);
			const header = this.pendingWaveHeader;

			if (
				header.length >= 12 &&
				header.subarray(0, 4).toString("ascii") === "RIFF" &&
				header.subarray(8, 12).toString("ascii") === "WAVE"
			) {
				let offset = 12;
				while (offset + 8 <= header.length) {
					const id = header.subarray(offset, offset + 4).toString("ascii");
					const size = header.readUInt32LE(offset + 4);
					offset += 8;
					if (id === "data") {
						this.seenWaveHeader = true;
						const pcm = header.subarray(offset);
						this.pendingWaveHeader = Buffer.alloc(0);
						return pcm;
					}
					if (offset + size > header.length) return Buffer.alloc(0);
					offset += size + (size % 2);
				}
				return Buffer.alloc(0);
			}

			this.seenWaveHeader = true;
			this.pendingWaveHeader = Buffer.alloc(0);
			return header;
		}

		return chunk;
	}

	private alignPcmChunk(chunk: Buffer): Buffer {
		if (chunk.length === 0) return Buffer.alloc(0);
		const withPending =
			this.pendingOddByte.length > 0
				? Buffer.concat([this.pendingOddByte, chunk])
				: chunk;
		const evenLength = Math.floor(withPending.length / 2) * 2;
		const aligned = withPending.subarray(0, evenLength);
		this.pendingOddByte =
			evenLength < withPending.length
				? Buffer.from(withPending.subarray(evenLength))
				: Buffer.alloc(0);
		return aligned;
	}
}
