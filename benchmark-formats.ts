import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@deepgram/sdk";
import Groq from "groq-sdk";
import { loadConfig } from "./src/config/loader";

const config = loadConfig();
const groq = new Groq({ apiKey: config.apiKeys.groq });
const deepgram = createClient(config.apiKeys.deepgram);

const AUDIO_DURATION_SEC = 268.75;

async function testGroq(buffer: Buffer, filename: string, mimeType: string) {
	const start = Date.now();
	const file = new File([buffer], filename, { type: mimeType });
	const result = await groq.audio.transcriptions.create({
		file: file as any,
		model: "whisper-large-v3",
		language: "en",
		response_format: "json",
	});
	return { text: result.text, time: Date.now() - start };
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
	return { text, time: Date.now() - start };
}

async function main() {
	const formats = [
		{ name: "FLAC", path: "/tmp/test-flac.flac", type: "audio/flac" },
		{ name: "Opus-fast", path: "/tmp/test-opus-fast.opus", type: "audio/opus" },
	];

	for (const format of formats) {
		console.log(`\n=== ${format.name} ===`);
		const buffer = readFileSync(format.path);
		console.log(`Size: ${(buffer.length / 1024).toFixed(0)} KB`);

		console.log("[Groq]", await testGroq(buffer, format.path, format.type));
		await new Promise((r) => setTimeout(r, 500));
		console.log("[Deepgram]", await testDeepgram(buffer));
	}
}

main().catch(console.error);
