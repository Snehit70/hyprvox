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
}

export class SonioxStreamingTranscriber
	extends EventEmitter
	implements LiveStreamingProvider
{
	private readonly apiKey: string;
	private readonly endpoint: string;
	private readonly createWebSocket: CreateSonioxWebSocket;
	private connection: SonioxWebSocketLike | null = null;
	private transcriptChunks: string[] = [];
	private audioBuffer: Buffer[] = [];
	private isConnected = false;
	private isConnecting = false;
	private chunksSent = 0;

	public constructor(options: SonioxStreamingTranscriberOptions = {}) {
		super();
		const apiKey = options.apiKey ?? loadConfig().apiKeys.soniox;
		if (!apiKey) {
			throw new Error("Soniox API key is required for live dictation");
		}

		this.apiKey = apiKey;
		this.endpoint = options.endpoint ?? SONIOX_WEBSOCKET_ENDPOINT;
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

			const finalText = renderFinalTokenText(response.tokens ?? []);
			if (!finalText) return;

			this.transcriptChunks.push(finalText);
			const event: LiveTranscriptEvent = {
				text: finalText,
				isFinal: true,
				speechFinal: true,
			};
			this.emit("transcript", finalText, event);
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

function renderFinalTokenText(tokens: SonioxToken[]): string {
	return tokens
		.filter((token) => token.is_final && token.text)
		.map((token) => token.text)
		.join("");
}
