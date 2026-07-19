import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@deepgram/sdk";
import Groq from "groq-sdk";
import { loadConfig } from "./src/config/loader";

const config = loadConfig();

const groq = new Groq({ apiKey: config.apiKeys.groq });
const deepgram = createClient(config.apiKeys.deepgram);

const files = [
	{ name: "WAV", path: "test-audio.wav", type: "audio/wav" },
	{ name: "Opus", path: "test-audio.opus", type: "audio/opus" },
	{ name: "MP3", path: "test-audio.mp3", type: "audio/mpeg" },
];

const AUDIO_DURATION_SEC = 268.75;

function calcSpeedFactor(timeMs: number) {
	return (AUDIO_DURATION_SEC / (timeMs / 1000)).toFixed(1);
}

function countWords(text: string) {
	return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function calcWpm(text: string, durationSec: number) {
	return Math.round((countWords(text) / durationSec) * 60);
}

async function testGroq(buffer: Buffer, filename: string, mimeType: string) {
	const start = Date.now();
	const file = new File([buffer], filename, { type: mimeType });
	const result = await groq.audio.transcriptions.create({
		file: file as any,
		model: "whisper-large-v3",
		language: "en",
		response_format: "json",
	});
	const time = Date.now() - start;
	return {
		text: result.text,
		time,
		speedFactor: calcSpeedFactor(time),
		wordsPerMin: calcWpm(result.text, AUDIO_DURATION_SEC),
		wordCount: countWords(result.text),
	};
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
	const time = Date.now() - start;
	return {
		text,
		time,
		speedFactor: calcSpeedFactor(time),
		wordsPerMin: calcWpm(text, AUDIO_DURATION_SEC),
		wordCount: countWords(text),
		confidence: result?.results?.channels?.[0]?.alternatives?.[0]?.confidence,
	};
}

async function main() {
	const results: any = {};

	console.log("=".repeat(60));
	console.log("HYPRVOX AUDIO FORMAT BENCHMARK");
	console.log(
		`Audio Duration: ${AUDIO_DURATION_SEC}s (${(AUDIO_DURATION_SEC / 60).toFixed(2)} min)`,
	);
	console.log("=".repeat(60));

	for (const file of files) {
		console.log(`\n=== ${file.name} ===`);
		const buffer = readFileSync(file.path);
		const sizeKB = buffer.length / 1024;
		const sizeMB = buffer.length / 1024 / 1024;
		console.log(`Size: ${sizeMB.toFixed(2)} MB (${sizeKB.toFixed(0)} KB)`);

		results[file.name] = {
			size: buffer.length,
			sizeMB: sizeMB.toFixed(2),
			groq: {},
			deepgram: {},
		};

		console.log("\n[Groq Whisper V3]");
		try {
			const groqResult = await testGroq(buffer, file.path, file.type);
			results[file.name].groq = {
				timeMs: groqResult.time,
				speedFactor: groqResult.speedFactor,
				wordCount: groqResult.wordCount,
				wordsPerMin: groqResult.wordsPerMin,
				textLength: groqResult.text.length,
				text: groqResult.text,
			};
			console.log(`  Time: ${groqResult.time}ms`);
			console.log(`  Speed: ${groqResult.speedFactor}x realtime`);
			console.log(
				`  Words: ${groqResult.wordCount} (${groqResult.wordsPerMin} WPM)`,
			);
		} catch (e: any) {
			console.log(`  ERROR: ${e.message}`);
			results[file.name].groq = { error: e.message };
		}

		await new Promise((r) => setTimeout(r, 1000));

		console.log("\n[Deepgram Nova-3]");
		try {
			const dgResult = await testDeepgram(buffer);
			results[file.name].deepgram = {
				timeMs: dgResult.time,
				speedFactor: dgResult.speedFactor,
				wordCount: dgResult.wordCount,
				wordsPerMin: dgResult.wordsPerMin,
				confidence: dgResult.confidence,
				textLength: dgResult.text.length,
				text: dgResult.text,
			};
			console.log(`  Time: ${dgResult.time}ms`);
			console.log(`  Speed: ${dgResult.speedFactor}x realtime`);
			console.log(
				`  Words: ${dgResult.wordCount} (${dgResult.wordsPerMin} WPM)`,
			);
			console.log(`  Confidence: ${dgResult.confidence}`);
		} catch (e: any) {
			console.log(`  ERROR: ${e.message}`);
			results[file.name].deepgram = { error: e.message };
		}
	}

	console.log("\n" + "=".repeat(60));
	console.log("SUMMARY");
	console.log("=".repeat(60));
	console.log(
		"\n| Format | Size    | Groq Time | Groq Speed | DG Time | DG Speed |",
	);
	console.log(
		"|--------|---------|-----------|------------|---------|----------|",
	);
	for (const file of files) {
		const r = results[file.name];
		const gTime = r.groq.timeMs ? `${r.groq.timeMs}ms` : "ERROR";
		const gSpeed = r.groq.speedFactor ? `${r.groq.speedFactor}x` : "-";
		const dTime = r.deepgram.timeMs ? `${r.deepgram.timeMs}ms` : "ERROR";
		const dSpeed = r.deepgram.speedFactor ? `${r.deepgram.speedFactor}x` : "-";
		console.log(
			`| ${file.name.padEnd(6)} | ${r.sizeMB}MB | ${gTime.padEnd(9)} | ${gSpeed.padEnd(10)} | ${dTime.padEnd(7)} | ${dSpeed.padEnd(8)} |`,
		);
	}

	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const outputPath = `benchmark-results-${timestamp}.json`;
	writeFileSync(outputPath, JSON.stringify(results, null, 2));
	console.log(`\nFull results saved to ${outputPath}`);
}

main().catch(console.error);
