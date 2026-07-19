import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@deepgram/sdk";
import Groq from "groq-sdk";
import { loadConfig } from "./src/config/loader";

const config = loadConfig();
const groq = new Groq({ apiKey: config.apiKeys.groq });
const deepgram = createClient(config.apiKeys.deepgram);

const clips = [
	{ name: "10s", path: "/tmp/test-10s.wav" },
	{ name: "30s", path: "/tmp/test-30s.wav" },
	{ name: "60s", path: "/tmp/test-60s.wav" },
	{ name: "120s", path: "/tmp/test-120s.wav" },
	{ name: "268s", path: "test-audio.wav" },
];

const formats = [
	{
		name: "WAV",
		ext: "wav",
		type: "audio/wav",
		cmd: (i: string, o: string) =>
			`ffmpeg -y -i ${i} -ar 16000 -ac 1 -c:a pcm_s16le -f wav ${o}`,
	},
	{
		name: "FLAC",
		ext: "flac",
		type: "audio/flac",
		cmd: (i: string, o: string) =>
			`ffmpeg -y -i ${i} -ar 16000 -ac 1 -c:a flac -compression_level 0 -f flac ${o}`,
	},
	{
		name: "Opus",
		ext: "opus",
		type: "audio/opus",
		cmd: (i: string, o: string) =>
			`ffmpeg -y -i ${i} -ar 16000 -ac 1 -c:a libopus -b:a 32k -compression_level 0 -frame_duration 60 -f opus ${o}`,
	},
];

async function testGroq(buffer: Buffer, filename: string, mimeType: string) {
	const start = Date.now();
	const file = new File([buffer], filename, { type: mimeType });
	const result = await groq.audio.transcriptions.create({
		file: file as any,
		model: "whisper-large-v3",
		language: "en",
		response_format: "json",
	});
	return { time: Date.now() - start, words: result.text.split(" ").length };
}

async function testDeepgram(buffer: Buffer) {
	const start = Date.now();
	const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
		buffer,
		{
			model: "nova-3",
			smart_format: true,
			punctuate: true,
			language: "en",
		},
	);
	if (error) throw error;
	const text =
		result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
	return { time: Date.now() - start, words: text.split(" ").length };
}

function convert(cmd: string): number {
	const start = Date.now();
	execSync(cmd, { stdio: "pipe" });
	return Date.now() - start;
}

async function main() {
	const results: any = {};

	console.log("=".repeat(90));
	console.log("COMPREHENSIVE AUDIO FORMAT BENCHMARK");
	console.log("=".repeat(90));
	console.log(
		"Testing: 10s, 30s, 60s, 120s, 268s clips × WAV/FLAC/Opus × Groq/Deepgram",
	);
	console.log("=".repeat(90));

	for (const clip of clips) {
		console.log(`\n${"=".repeat(90)}`);
		console.log(`CLIP: ${clip.name}`);
		console.log("=".repeat(90));
		results[clip.name] = {};

		for (const format of formats) {
			const outputPath = `/tmp/bench-${clip.name}.${format.ext}`;

			// Convert
			const convertTime = convert(format.cmd(clip.path, outputPath));
			const buffer = readFileSync(outputPath);
			const sizeKB = buffer.length / 1024;

			console.log(
				`\n[${format.name}] Size: ${sizeKB.toFixed(0)}KB, Convert: ${convertTime}ms`,
			);

			results[clip.name][format.name] = {
				sizeKB: Math.round(sizeKB),
				convertMs: convertTime,
			};

			// Test Groq (single run to save time)
			try {
				const groqResult = await testGroq(buffer, outputPath, format.type);
				console.log(`  Groq: ${groqResult.time}ms, ${groqResult.words} words`);
				results[clip.name][format.name].groqMs = groqResult.time;
				results[clip.name][format.name].words = groqResult.words;
			} catch (e: any) {
				console.log(`  Groq ERROR: ${e.message}`);
				results[clip.name][format.name].groqMs = -1;
			}

			await new Promise((r) => setTimeout(r, 500));

			// Test Deepgram
			try {
				const dgResult = await testDeepgram(buffer);
				console.log(`  Deepgram: ${dgResult.time}ms, ${dgResult.words} words`);
				results[clip.name][format.name].deepgramMs = dgResult.time;
			} catch (e: any) {
				console.log(`  Deepgram ERROR: ${e.message}`);
				results[clip.name][format.name].deepgramMs = -1;
			}

			await new Promise((r) => setTimeout(r, 500));
		}
	}

	// Summary table
	console.log("\n" + "=".repeat(90));
	console.log("SUMMARY: Total Time (Convert + Groq) - Lower is better");
	console.log("=".repeat(90));
	console.log(
		"| Clip  | WAV Total | WAV Size | FLAC Total | FLAC Size | Opus Total | Opus Size |",
	);
	console.log(
		"|-------|-----------|----------|------------|-----------|-----------|-----------|",
	);

	for (const clip of clips) {
		const r = results[clip.name];
		const wavTotal = r.WAV.convertMs + r.WAV.groqMs;
		const flacTotal = r.FLAC.convertMs + r.FLAC.groqMs;
		const opusTotal = r.Opus.convertMs + r.Opus.groqMs;

		console.log(
			`| ${clip.name.padEnd(5)} | ${wavTotal}ms`.padEnd(12) +
				` | ${r.WAV.sizeKB}KB`.padEnd(10) +
				` | ${flacTotal}ms`.padEnd(12) +
				` | ${r.FLAC.sizeKB}KB`.padEnd(11) +
				` | ${opusTotal}ms`.padEnd(11) +
				` | ${r.Opus.sizeKB}KB |`,
		);
	}

	// Calculate savings
	console.log("\n" + "=".repeat(90));
	console.log("SAVINGS vs WAV (negative = slower)");
	console.log("=".repeat(90));
	console.log("| Clip  | FLAC saves | Opus saves | Best Choice |");
	console.log("|-------|------------|------------|-------------|");

	for (const clip of clips) {
		const r = results[clip.name];
		const wavTotal = r.WAV.convertMs + r.WAV.groqMs;
		const flacTotal = r.FLAC.convertMs + r.FLAC.groqMs;
		const opusTotal = r.Opus.convertMs + r.Opus.groqMs;

		const flacSaves = wavTotal - flacTotal;
		const opusSaves = wavTotal - opusTotal;

		const best = flacTotal <= opusTotal ? "FLAC" : "Opus";
		console.log(
			`| ${clip.name.padEnd(5)} | ${flacSaves}ms`.padEnd(13) +
				` | ${opusSaves}ms`.padEnd(12) +
				` | ${best} |`,
		);
	}
}

main().catch(console.error);
