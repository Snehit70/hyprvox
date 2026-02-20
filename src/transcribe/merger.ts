import { distance as levenshteinDistance } from "fastest-levenshtein";
import Groq from "groq-sdk";
import { loadConfig } from "../config/loader";
import { logError, logger } from "../utils/logger";
import { withRetry } from "../utils/retry";

const SYSTEM_PROMPT = `You are an expert technical transcription editor.

CONTEXT: This is audio from a software developer discussing programming, Linux systems, development tools, and AI systems. Expect technical jargon, project names, and command-line references.

Source A (Groq Whisper): Accurate words, technical terms, proper nouns.
Source B (Deepgram Nova): Good formatting, punctuation, casing.

EXAMPLES:
- If Source A says "github" and Source B says "get hub", choose "GitHub"
- If Source A says "convex" and Source B says "con next", choose "Convex"
- If Source A says "hyprland" and Source B says "high per land", choose "Hyprland"
- If Source A says "waybar" and Source B says "Vbar", choose "Waybar"
- If Source A says "systemd" and Source B says "system d", choose "systemd"
- If Source A says "antigravity" and Source B says "anti gravity", choose "antigravity"

RULES:
1. Trust Source A for: proper nouns, project names, technical terms, acronyms.
2. Trust Source B for: punctuation, capitalization, number formatting.
3. Preserve technical accuracy over grammatical perfection.
4. Remove: hallucinations, self-corrections, filler words ("um", "uh", "like").
5. Remove spelling clarifications (e.g., "with an I", "spelled S-M-I-T-H").
6. Remove pronunciation meta-commentary (e.g., "that's pronounced...").
7. Remove thinking-out-loud phrases and rhetorical self-questions.
8. Remove false starts and abandoned sentences.
9. Output ONLY the merged text, no quotes or preamble.`;

export interface MergeResult {
	text: string;
	accuracy: {
		sourcesMatch: boolean;
		editDistance: number;
		confidence: number;
	};
}

export class TranscriptMerger {
	private _client: Groq | null = null;
	private _cachedApiKey: string | null = null;

	private getClient(apiKey: string): Groq {
		if (!this._client || this._cachedApiKey !== apiKey) {
			this._client = new Groq({ apiKey });
			this._cachedApiKey = apiKey;
		}
		return this._client;
	}

	public reset(): void {
		this._client = null;
		this._cachedApiKey = null;
	}

	public async merge(
		groqText: string,
		deepgramText: string,
	): Promise<MergeResult> {
		const config = loadConfig();
		const mergeModel = config.transcription.mergeModel;
		const apiKey = config.apiKeys.groq;
		const sourcesMatch = groqText === deepgramText;

		if (!groqText && !deepgramText) {
			return {
				text: "",
				accuracy: { sourcesMatch, editDistance: 0, confidence: 0 },
			};
		}
		if (!groqText) {
			return {
				text: deepgramText,
				accuracy: { sourcesMatch, editDistance: 0, confidence: 0.5 },
			};
		}
		if (!deepgramText) {
			return {
				text: groqText,
				accuracy: { sourcesMatch, editDistance: 0, confidence: 0.5 },
			};
		}

		if (sourcesMatch) {
			return {
				text: deepgramText,
				accuracy: { sourcesMatch: true, editDistance: 0, confidence: 1 },
			};
		}

		const startTime = Date.now();
		let finalText: string;

		try {
			const completion = await withRetry(
				async (signal) => {
					return await this.getClient(apiKey).chat.completions.create(
						{
							model: mergeModel,
							messages: [
								{ role: "system", content: SYSTEM_PROMPT },
								{
									role: "user",
									content: `Source A (Groq Whisper):\n${groqText}\n\nSource B (Deepgram Nova):\n${deepgramText}`,
								},
							],
							temperature: 0.1,
							max_tokens: 4096,
						},
						{ signal, timeout: 30000, maxRetries: 0 },
					);
				},
				{
					maxRetries: 2,
					backoffs: [500, 1000],
					operationName: "LLM merge",
					timeout: 30000,
					shouldRetry: (error: Error) =>
						/ECONNRESET|ETIMEDOUT|rate_limit/i.test(error.message),
				},
			);

			finalText = completion.choices[0]?.message?.content?.trim() || "";
			const timeMs = Date.now() - startTime;

			logger.info(
				{
					model: mergeModel,
					timeMs,
					resultLength: finalText.length,
					groqTextLength: groqText.length,
					deepgramTextLength: deepgramText.length,
				},
				"LLM merge complete",
			);
		} catch (error) {
			logError("LLM merge failed, using fallback", error);
			finalText = deepgramText || groqText;
		}

		const distToGroq = levenshteinDistance(finalText, groqText);
		const distToDeepgram = levenshteinDistance(finalText, deepgramText);

		// Normalize each distance by the max length of the two strings being compared
		const maxDistGroq = Math.max(finalText.length, groqText.length) || 1;
		const maxDistDeepgram =
			Math.max(finalText.length, deepgramText.length) || 1;
		const normalizedDistGroq = distToGroq / maxDistGroq;
		const normalizedDistDeepgram = distToDeepgram / maxDistDeepgram;
		const editDistance = Math.round(
			(normalizedDistGroq + normalizedDistDeepgram) * 50,
		);
		const confidence = Math.max(
			0,
			Math.min(1, 1 - (normalizedDistGroq + normalizedDistDeepgram) / 2),
		);

		return {
			text: finalText,
			accuracy: {
				sourcesMatch: false,
				editDistance,
				confidence: Math.round(confidence * 100) / 100,
			},
		};
	}
}
