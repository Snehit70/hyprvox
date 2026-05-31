export class WavChunkingError extends Error {
	public override readonly name = "WavChunkingError";
}

interface PcmWavFormat {
	audioFormat: number;
	numChannels: number;
	sampleRate: number;
	byteRate: number;
	blockAlign: number;
	bitsPerSample: number;
}

interface ParsedPcmWav {
	format: PcmWavFormat;
	data: Buffer;
	dataBytesClamped: boolean;
	dataBytesTrimmed: boolean;
}

export interface WavChunkOptions {
	chunkSeconds: number;
	overlapSeconds: number;
	minDurationSeconds?: number;
}

export interface WavAudioChunk {
	index: number;
	startSample: number;
	endSample: number;
	startSeconds: number;
	durationSeconds: number;
	buffer: Buffer;
}

export interface WavChunkPlan {
	chunks: WavAudioChunk[];
	chunked: boolean;
	durationSeconds: number;
	sampleRate: number;
	channels: number;
	bitsPerSample: number;
	dataBytesClamped: boolean;
	dataBytesTrimmed: boolean;
	chunkSeconds: number;
	overlapSeconds: number;
}

function requireFiniteNumber(value: number, name: string): void {
	if (!Number.isFinite(value)) {
		throw new WavChunkingError(`${name} must be a finite number`);
	}
}

function secondsToSamples(
	seconds: number,
	sampleRate: number,
	name: string,
): number {
	requireFiniteNumber(seconds, name);
	if (seconds <= 0) {
		throw new WavChunkingError(`${name} must be greater than 0`);
	}

	const samples = Math.round(seconds * sampleRate);
	if (samples < 1) {
		throw new WavChunkingError(`${name} is too short for ${sampleRate}Hz WAV`);
	}

	return samples;
}

function parsePcmWav(buffer: Buffer): ParsedPcmWav {
	if (buffer.length < 44) {
		throw new WavChunkingError("Corrupt WAV: header is too short");
	}

	if (
		buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
		buffer.subarray(8, 12).toString("ascii") !== "WAVE"
	) {
		throw new WavChunkingError("Unsupported WAV: expected RIFF/WAVE");
	}

	let offset = 12;
	let format: PcmWavFormat | undefined;
	let data: Buffer | undefined;
	let dataBytesClamped = false;

	while (offset + 8 <= buffer.length) {
		const chunkId = buffer.subarray(offset, offset + 4).toString("ascii");
		const chunkSize = buffer.readUInt32LE(offset + 4);
		const chunkDataStart = offset + 8;
		const chunkDataEnd = chunkDataStart + chunkSize;

		if (chunkDataEnd > buffer.length) {
			if (chunkId === "data" && chunkDataStart < buffer.length) {
				// arecord writes WAV to stdout, so it cannot seek back and fix the
				// final data length. Treat an oversized terminal data chunk as a
				// streaming header and use the PCM bytes that are actually present.
				data = buffer.subarray(chunkDataStart);
				dataBytesClamped = true;
				break;
			}
			throw new WavChunkingError(`Corrupt WAV: ${chunkId} chunk is truncated`);
		}

		if (chunkId === "fmt ") {
			if (chunkSize < 16) {
				throw new WavChunkingError("Corrupt WAV: fmt chunk is too short");
			}

			format = {
				audioFormat: buffer.readUInt16LE(chunkDataStart),
				numChannels: buffer.readUInt16LE(chunkDataStart + 2),
				sampleRate: buffer.readUInt32LE(chunkDataStart + 4),
				byteRate: buffer.readUInt32LE(chunkDataStart + 8),
				blockAlign: buffer.readUInt16LE(chunkDataStart + 12),
				bitsPerSample: buffer.readUInt16LE(chunkDataStart + 14),
			};
		} else if (chunkId === "data") {
			data = buffer.subarray(chunkDataStart, chunkDataEnd);
		}

		offset = chunkDataEnd + (chunkSize % 2);
	}

	if (!format) {
		throw new WavChunkingError("Corrupt WAV: missing fmt chunk");
	}
	if (!data) {
		throw new WavChunkingError("Corrupt WAV: missing data chunk");
	}

	if (format.audioFormat !== 1) {
		throw new WavChunkingError(
			`Unsupported WAV: expected PCM audio format, got ${format.audioFormat}`,
		);
	}
	if (format.numChannels !== 1) {
		throw new WavChunkingError(
			`Unsupported WAV: expected mono audio, got ${format.numChannels} channels`,
		);
	}
	if (format.sampleRate !== 16000) {
		throw new WavChunkingError(
			`Unsupported WAV: expected 16000Hz sample rate, got ${format.sampleRate}Hz`,
		);
	}
	if (format.bitsPerSample !== 16) {
		throw new WavChunkingError(
			`Unsupported WAV: expected 16-bit samples, got ${format.bitsPerSample}`,
		);
	}

	const expectedBlockAlign = format.numChannels * (format.bitsPerSample / 8);
	if (format.blockAlign !== expectedBlockAlign) {
		throw new WavChunkingError(
			`Corrupt WAV: blockAlign ${format.blockAlign} does not match sample format`,
		);
	}
	if (format.byteRate !== format.sampleRate * format.blockAlign) {
		throw new WavChunkingError(
			`Corrupt WAV: byteRate ${format.byteRate} does not match sample format`,
		);
	}
	let dataBytesTrimmed = false;
	const alignedDataLength = data.length - (data.length % format.blockAlign);
	if (alignedDataLength !== data.length) {
		data = data.subarray(0, alignedDataLength);
		dataBytesTrimmed = true;
	}

	if (data.length === 0) {
		throw new WavChunkingError("Corrupt WAV: data chunk is empty");
	}

	return { format, data, dataBytesClamped, dataBytesTrimmed };
}

function buildPcmWav(data: Buffer, format: PcmWavFormat): Buffer {
	const header = Buffer.alloc(44);
	const byteRate = format.sampleRate * format.blockAlign;

	header.write("RIFF", 0, "ascii");
	header.writeUInt32LE(36 + data.length, 4);
	header.write("WAVE", 8, "ascii");
	header.write("fmt ", 12, "ascii");
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(format.numChannels, 22);
	header.writeUInt32LE(format.sampleRate, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(format.blockAlign, 32);
	header.writeUInt16LE(format.bitsPerSample, 34);
	header.write("data", 36, "ascii");
	header.writeUInt32LE(data.length, 40);

	return Buffer.concat([header, data]);
}

export function createPcmWavChunks(
	buffer: Buffer,
	options: WavChunkOptions,
): WavChunkPlan {
	const { format, data, dataBytesClamped, dataBytesTrimmed } =
		parsePcmWav(buffer);
	const chunkSamples = secondsToSamples(
		options.chunkSeconds,
		format.sampleRate,
		"chunkSeconds",
	);

	requireFiniteNumber(options.overlapSeconds, "overlapSeconds");
	if (options.overlapSeconds < 0) {
		throw new WavChunkingError(
			"overlapSeconds must be greater than or equal to 0",
		);
	}

	const overlapSamples = Math.round(options.overlapSeconds * format.sampleRate);
	if (overlapSamples >= chunkSamples) {
		throw new WavChunkingError(
			"overlapSeconds must be smaller than chunkSeconds",
		);
	}

	const minDurationSeconds = options.minDurationSeconds ?? 0;
	requireFiniteNumber(minDurationSeconds, "minDurationSeconds");
	if (minDurationSeconds < 0) {
		throw new WavChunkingError(
			"minDurationSeconds must be greater than or equal to 0",
		);
	}

	const totalSamples = data.length / format.blockAlign;
	const durationSeconds = totalSamples / format.sampleRate;
	const stepSamples = chunkSamples - overlapSamples;

	const ranges: Array<{ startSample: number; endSample: number }> = [];
	if (durationSeconds < minDurationSeconds || totalSamples <= chunkSamples) {
		ranges.push({ startSample: 0, endSample: totalSamples });
	} else {
		let startSample = 0;
		while (startSample < totalSamples) {
			const endSample = Math.min(totalSamples, startSample + chunkSamples);
			ranges.push({ startSample, endSample });

			if (endSample === totalSamples) {
				break;
			}

			startSample += stepSamples;
		}
	}

	const chunks = ranges.map(({ startSample, endSample }, index) => {
		const startByte = startSample * format.blockAlign;
		const endByte = endSample * format.blockAlign;
		const chunkData = data.subarray(startByte, endByte);

		return {
			index,
			startSample,
			endSample,
			startSeconds: startSample / format.sampleRate,
			durationSeconds: (endSample - startSample) / format.sampleRate,
			buffer: buildPcmWav(chunkData, format),
		} satisfies WavAudioChunk;
	});

	return {
		chunks,
		chunked: chunks.length > 1,
		durationSeconds,
		sampleRate: format.sampleRate,
		channels: format.numChannels,
		bitsPerSample: format.bitsPerSample,
		dataBytesClamped,
		dataBytesTrimmed,
		chunkSeconds: options.chunkSeconds,
		overlapSeconds: options.overlapSeconds,
	};
}
