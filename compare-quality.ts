import { readFileSync, writeFileSync } from "node:fs";

const filePath =
	process.argv[2] || "benchmark-results-2026-02-21T09-46-17-923Z.json";
const data = JSON.parse(readFileSync(filePath, "utf-8"));

const formats = ["WAV", "Opus", "MP3"];
const services = ["groq", "deepgram"];

console.log("=".repeat(80));
console.log("TRANSCRIPTION QUALITY COMPARISON");
console.log("=".repeat(80));

for (const format of formats) {
	console.log(`\n${"=".repeat(80)}`);
	console.log(`FORMAT: ${format}`);
	console.log("=".repeat(80));

	for (const service of services) {
		const result = data[format][service];
		console.log(`\n--- ${service.toUpperCase()} ---`);
		console.log(`Words: ${result.wordCount}, Chars: ${result.textLength}`);
		if (result.confidence) console.log(`Confidence: ${result.confidence}`);
		console.log("\nFull text:\n");
		console.log(result.text);
	}
}

console.log("\n" + "=".repeat(80));
console.log("KEY DIFFERENCES ANALYSIS");
console.log("=".repeat(80));

console.log("\n1. WORD COUNT COMPARISON:");
console.log("   Format  | Groq | Deepgram | Diff");
console.log("   --------|------|----------|-----");
for (const format of formats) {
	const g = data[format].groq.wordCount;
	const d = data[format].deepgram.wordCount;
	console.log(
		`   ${format.padEnd(7)} | ${g}  | ${d}      | ${g - d > 0 ? "+" : ""}${g - d}`,
	);
}

console.log("\n2. PUNCTUATION (Groq lacks it, Deepgram has it):");
const sampleGroq = data.WAV.groq.text.slice(0, 200);
const sampleDeepgram = data.WAV.deepgram.text.slice(0, 200);
console.log("   Groq sample:     ", sampleGroq);
console.log("   Deepgram sample: ", sampleDeepgram);

console.log("\n3. REPETITION ISSUES (self-corrections captured):");
const repeatPattern = /repeat once again/gi;
for (const format of formats) {
	for (const service of services) {
		const matches = data[format][service].text.match(repeatPattern);
		if (matches) {
			console.log(
				`   ${format}/${service}: ${matches.length} "repeat once again" phrases`,
			);
		}
	}
}

console.log("\n4. KEY TERMS CHECK:");
const terms = [
	"agent observatory",
	"token tracker",
	"monthly forecast",
	"p95",
	"latency",
];
for (const term of terms) {
	console.log(`\n   "${term}":`);
	for (const format of formats) {
		for (const service of services) {
			const count = (
				data[format][service].text.toLowerCase().match(new RegExp(term, "g")) ||
				[]
			).length;
			console.log(`      ${format}/${service}: ${count}x`);
		}
	}
}
