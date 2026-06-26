import { EventEmitter } from "node:events";
import { loadConfig } from "../config/loader";
import { logError, logger } from "../utils/logger";
import type {
	StreamingResult,
	StreamingStopReason,
} from "./deepgram-streaming";
import type {
	LiveStreamingProvider,
	LiveTranscriptEvent,
} from "./live-provider";

const SONIOX_WEBSOCKET_ENDPOINT =
	"wss://stt-rt.soniox.com/transcribe-websocket";
const SONIOX_MODEL = "stt-rt-v5";
const SONIOX_SAMPLE_RATE = 16000;
const SONIOX_CLOSE_TIMEOUT_MS = 2000;

interface SonioxToken {
	text?: string;
	is_final?: boolean;
}

interface SonioxResponse {
	tokens?: SonioxToken[];
	error_code?: string;
	error_message?: string;
}

interface SonioxWebSocketLike {
	readonly readyState: number;
	onopen: (() => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onerror: ((event: unknown) => void) | null;
	onclose: (() => void) | null;
	send(data: string | Buffer): void;
	close(): void;
}

type CreateSonioxWebSocket = (url: string) => SonioxWebSocketLike;

interface SonioxStreamingTranscriberOptions {
	apiKey?: string;
	endpoint?: string;
	createWebSocket?: CreateSonioxWebSocket;
	paragraphPauseMs?: number;
}

export class SonioxStreamingTranscriber
	extends EventEmitter
	implements LiveStreamingProvider
{
	private readonly apiKey: string;
	private readonly endpoint: string;
	private readonly createWebSocket: CreateSonioxWebSocket;
	private readonly paragraphPauseMs: number;
	private connection: SonioxWebSocketLike | null = null;
	private transcriptChunks: string[] = [];
	private audioBuffer: Buffer[] = [];
	private isConnected = false;
	private isConnecting = false;
	private chunksSent = 0;
	private lastEmittedFullText = "";
	private lastMessageTimestamp = 0;
	private hasReceivedMessage = false;
	private paragraphBreakCount = 0;

	public constructor(options: SonioxStreamingTranscriberOptions = {}) {
		super();
		const apiKey = options.apiKey ?? loadConfig().apiKeys.soniox;
		if (!apiKey) {
			throw new Error("Soniox API key is required for live dictation");
		}

		this.apiKey = apiKey;
		this.endpoint = options.endpoint ?? SONIOX_WEBSOCKET_ENDPOINT;
		this.paragraphPauseMs = options.paragraphPauseMs ?? 3000;
		this.createWebSocket =
			options.createWebSocket ??
			((url) => new WebSocket(url) as unknown as SonioxWebSocketLike);
	}

	public async start(language: string = "en"): Promise<void> {
		this.transcriptChunks = [];
		this.audioBuffer = [];
		this.isConnected = false;
		this.isConnecting = true;
		this.chunksSent = 0;
		this.lastEmittedFullText = "";
		this.lastMessageTimestamp = 0;
		this.hasReceivedMessage = false;
		this.paragraphBreakCount = 0;

		this.connection = this.createWebSocket(this.endpoint);
		this.connection.onopen = () => {
			if (!this.connection) return;

			this.isConnected = true;
			this.isConnecting = false;
			this.connection.send(
				JSON.stringify({
					api_key: this.apiKey,
					model: SONIOX_MODEL,
					audio_format: "pcm_s16le",
					sample_rate: SONIOX_SAMPLE_RATE,
					num_channels: 1,
					language_hints: [language],
					enable_endpoint_detection: true,
				}),
			);
			logger.info({ language }, "Soniox streaming connection opened");
			this.emit("open");
			this.flushBuffer();
		};

		this.connection.onmessage = (event) => {
			this.handleMessage(event.data);
		};

		this.connection.onerror = (event) => {
			this.isConnected = false;
			this.isConnecting = false;
			logger.error({ event }, "Soniox streaming error");
			this.emit("error", event);
		};

		this.connection.onclose = () => {
			this.isConnected = false;
			this.isConnecting = false;
			logger.info(
				{
					chunksReceived: this.transcriptChunks.length,
					chunksSent: this.chunksSent,
				},
				"Soniox streaming connection closed",
			);
			this.emit("close");
		};
	}

	public send(audioChunk: Buffer): void {
		if (this.connection && this.isConnected) {
			this.connection.send(audioChunk);
			this.chunksSent++;
			return;
		}

		if (this.isConnecting) {
			this.audioBuffer.push(audioChunk);
		}
	}

	public async stop(): Promise<StreamingResult> {
		let stopReason: StreamingStopReason = "not_connected";
		let closeWaitMs = 0;

		if (this.connection) {
			try {
				this.connection.send("");
				stopReason = "finalize_transcript";
				const closeStart = Date.now();
				const closeClean = await this.waitForClose();
				closeWaitMs = Date.now() - closeStart;
				if (!closeClean) {
					stopReason = "finalize_transcript+close_timeout";
					this.connection.close();
				}
			} catch (error) {
				logError("Error finishing Soniox streaming", error);
			} finally {
				this.connection = null;
				this.isConnected = false;
				this.isConnecting = false;
				this.audioBuffer = [];
			}
		}

		const finalText = this.transcriptChunks.join("").trim();
		return {
			text: finalText,
			chunkCount: this.transcriptChunks.length,
			paragraphBreakCount: this.paragraphBreakCount,
			stopReason,
			finalizeWaitMs: 0,
			closeWaitMs,
			endpointingMs: 0,
			receivedFinalChunk: this.transcriptChunks.length > 0,
			hadSpeechFinal: this.transcriptChunks.length > 0,
		};
	}

	private handleMessage(data: unknown): void {
		try {
			const response = JSON.parse(String(data)) as SonioxResponse;
			if (response.error_code || response.error_message) {
				const message =
					response.error_message ??
					`Soniox streaming error: ${response.error_code ?? "unknown"}`;
				const error = new Error(message);
				this.emit("error", error);
				return;
			}

			const tokens = response.tokens ?? [];
			for (const token of tokens) {
				logger.debug(
					{ text: token.text, isFinal: token.is_final },
					"Soniox token received",
				);
			}

			const fullText = renderFinalTokenText(tokens);
			const delta = fullText.slice(this.lastEmittedFullText.length);
			this.lastEmittedFullText = fullText;

			if (!delta) return;

			const now = Date.now();
			const gapMs = this.lastMessageTimestamp > 0
				? now - this.lastMessageTimestamp
				: 0;
			this.lastMessageTimestamp = now;

			let prefix = "";
			if (this.hasReceivedMessage && gapMs >= this.paragraphPauseMs) {
				prefix = "  ";
				this.paragraphBreakCount++;
				logger.debug(
					{ gapMs, paragraphPauseMs: this.paragraphPauseMs },
					"Soniox paragraph break inserted",
				);
			}
			this.hasReceivedMessage = true;

			logger.debug({ delta, fullText }, "Soniox transcript delta emitted");
			this.transcriptChunks.push(prefix + delta);
			const event: LiveTranscriptEvent = {
				text: prefix + fullText,
				isFinal: true,
				speechFinal: true,
			};
			this.emit("transcript", prefix + fullText, event);
		} catch (error) {
			logError("Failed to parse Soniox streaming response", error);
		}
	}

	private flushBuffer(): void {
		if (!this.connection || !this.isConnected) return;

		for (const chunk of this.audioBuffer) {
			this.connection.send(chunk);
			this.chunksSent++;
		}
		this.audioBuffer = [];
	}

	private waitForClose(): Promise<boolean> {
		return new Promise((resolve) => {
			const timeout = setTimeout(() => {
				resolve(false);
			}, SONIOX_CLOSE_TIMEOUT_MS);

			this.once("close", () => {
				clearTimeout(timeout);
				resolve(true);
			});
		});
	}
}

const SONIOX_STRIP_PATTERN = /<\|?end\|?>|<\|?start\|?>|<\|\d+\.\d+\|>/g;

function renderFinalTokenText(tokens: SonioxToken[]): string {
	return tokens
		.filter((token) => token.is_final && token.text)
		.map((token) => (token.text ?? "").replace(SONIOX_STRIP_PATTERN, ""))
		.join("")
		.replace(/  +/g, " ")
		.trim();
}

const LLM_FORMAT_SYSTEM_PROMPT = `Task: add paragraph breaks to raw dictation text.

Output contract:
- Return the text with paragraph breaks inserted at natural sentence boundaries.
- Do not add any content, metadata, or explanations.
- Do not modify the text itself, only insert paragraph breaks (\\n\\n).
- Preserve all original wording exactly.
- Insert paragraph breaks between topics or after a pause in thought.

Input: Raw dictation text with double-space paragraph markers.`;

export async function formatSonioxWithLLM(
	text: string,
	apiKey: string,
	fallbackApiKey?: string,
): Promise<{ formattedText: string; llmFormattingMs: number }> {
	const startTime = Date.now();
	try {
		const GroqModule = await import("groq-sdk");
		const Groq = GroqModule.default;
		const client = new Groq({ apiKey });

		const completion = await client.chat.completions.create({
			model: "llama-3.3-70b-versatile",
			messages: [
				{ role: "system", content: LLM_FORMAT_SYSTEM_PROMPT },
				{ role: "user", content: text },
			],
			temperature: 0,
			max_tokens: Math.ceil(text.length / 3),
			seed: 42,
		});

		const formattedText =
			completion.choices[0]?.message?.content?.trim() ?? text;
		const llmFormattingMs = Date.now() - startTime;

		logger.debug(
			{ originalLength: text.length, formattedLength: formattedText.length, llmFormattingMs },
			"Soniox LLM formatting complete",
		);

		return { formattedText, llmFormattingMs };
	} catch (error) {
		const llmFormattingMs = Date.now() - startTime;
		logError("Soniox LLM formatting failed; using raw text", error);
		return { formattedText: text, llmFormattingMs };
	}
}

const LLM_FORMATTING_SYSTEM_PROMPT = `Task: add paragraph breaks to the following transcript text.

Output contract:
- Return the transcript text with paragraph breaks added.
- Do not modify the wording, punctuation, or content in any way.
- Do not remove filler words, fix grammar, or rewrite anything.
- Do not emit metadata, labels, instructions, or explanations.

Paragraph break rules:
- Insert a blank line (double newline) between distinct topic changes or when there's a clear pause in thought.
- Do not add paragraph breaks within sentences.
- Do not add paragraph breaks to very short texts (under 100 characters).
- If the text is already well-structured with paragraph breaks, return it unchanged.

Invalid output:
- Any changes to wording, punctuation, or content.
- Added explanations or metadata.`;

export async function formatSonioxWithLlm(text: string): Promise<string> {
	if (text.length < 100) return text;

	const config = loadConfig();
	const apiKey = config.apiKeys.groq;
	if (!apiKey) {
		logger.warn("No Groq API key available for LLM formatting; returning raw text");
		return text;
	}

	try {
		const GroqSdk = (await import("groq-sdk")).default;
		const client = new GroqSdk({ apiKey });

		const response = await client.chat.completions.create({
			model: "llama-3.3-70b-versatile",
			messages: [
				{ role: "system", content: LLM_FORMATTING_SYSTEM_PROMPT },
				{ role: "user", content: text },
			],
			temperature: 0,
			max_tokens: Math.min(Math.ceil(text.length * 1.5), 4096),
			seed: 42,
		});

		const formatted = response.choices[0]?.message?.content?.trim();
		if (formatted && formatted.length > 0) {
			logger.debug(
				{ rawLength: text.length, formattedLength: formatted.length },
				"LLM formatting applied to Soniox transcript",
			);
			return formatted;
		}

		logger.warn("LLM returned empty formatting result; using raw text");
		return text;
	} catch (error) {
		logError("LLM formatting failed; using raw text", error);
		return text;
	}
}
