import { EventEmitter } from "node:events";
import {
	createClient,
	type DeepgramClient,
	type LiveClient,
	type LiveSchema,
	LiveTranscriptionEvents,
} from "@deepgram/sdk";
import { loadConfig } from "../config/loader";
import { logError, logger } from "../utils/logger";
import { sanitizeDeepgramKeyterms } from "./deepgram-boost";

export type StreamingStopReason =
	| "finalize_transcript"
	| "finalize_timeout"
	| "finalize_transcript+close_timeout"
	| "finalize_timeout+close_timeout"
	| "not_connected";

export interface StreamingResult {
	text: string;
	chunkCount: number;
	stopReason: StreamingStopReason;
	finalizeWaitMs: number;
	closeWaitMs: number;
}

export interface StreamingFailureReason {
	type: "error" | "close";
	message: string;
	duration: number;
	chunksReceived: number;
	chunksSent: number;
}

export class DeepgramStreamingTranscriber extends EventEmitter {
	private client: DeepgramClient;
	private connection: LiveClient | null = null;
	private transcriptChunks: string[] = [];
	private isConnected: boolean = false;
	private isConnecting: boolean = false;
	private isStopping: boolean = false;
	private connectionStartTime: number = 0;
	private chunksSent: number = 0;
	private audioBuffer: Buffer[] = [];
	private static readonly MAX_BUFFER_CHUNKS = 100;

	// Finalize wait: how long to wait for a final transcript after sending
	// the finalize signal to Deepgram.  Lower values reduce stop latency
	// but risk truncating tail words on slow-finalize sessions.
	// Data from Apr-May 2026: clean detection median=286ms, p95=376ms.
	// 81% of sessions hit the 600ms timeout unnecessarily.
	// Reduced to 400ms to save ~200ms on timeout cases while maintaining
	// safety margin above p95 clean detection time.
	private static readonly FINALIZE_TIMEOUT_MS = 400;

	constructor() {
		super();
		const config = loadConfig();
		this.client = createClient(config.apiKeys.deepgram);
	}

	public async start(language: string = "en", boostWords: string[] = []) {
		try {
			this.transcriptChunks = [];
			this.isConnected = false;
			this.isConnecting = true;
			this.isStopping = false;
			this.connectionStartTime = 0;
			this.chunksSent = 0;
			this.audioBuffer = [];

			const keyterms = sanitizeDeepgramKeyterms(boostWords);
			const options: LiveSchema = {
				model: "nova-3",
				interim_results: true,
				endpointing: 300,
				vad_events: true,
				smart_format: true,
				encoding: "linear16",
				sample_rate: 16000,
				channels: 1,
				language: language,
				...(keyterms.length > 0 ? { keyterm: keyterms } : {}),
			};

			this.connection = this.client.listen.live(options);

			this.connection.on(LiveTranscriptionEvents.Open, () => {
				if (!this.connection) return; // Connection was closed before open
				this.isConnected = true;
				this.isConnecting = false;
				this.connectionStartTime = Date.now();
				logger.info(
					{
						language,
						boostWordsCount: boostWords.length,
						deepgramKeytermsCount: keyterms.length,
					},
					"Deepgram streaming connection opened",
				);
				this.emit("open");
				this.flushBuffer();
			});

			this.connection.on(LiveTranscriptionEvents.Transcript, (data) => {
				const transcript = data.channel?.alternatives?.[0]?.transcript;

				if (transcript && transcript.trim().length > 0) {
					if (data.speech_final) {
						this.transcriptChunks.push(transcript.trim());
						logger.debug(
							{ transcript: transcript.trim(), isFinal: true },
							"Deepgram chunk finalized (speech_final)",
						);
						this.emit("transcript", transcript.trim());
					} else if (data.is_final) {
						this.transcriptChunks.push(transcript.trim());
						logger.debug(
							{ transcript: transcript.trim(), isFinal: data.is_final },
							"Deepgram chunk finalized (is_final)",
						);
						this.emit("transcript", transcript.trim());
					}
				}
			});

			this.connection.on(LiveTranscriptionEvents.Error, (error) => {
				const wasConnectedBeforeError = this.isConnected;
				const duration =
					this.connectionStartTime > 0
						? Date.now() - this.connectionStartTime
						: 0;

				logger.error(
					{
						error: JSON.stringify(error, null, 2),
						duration,
						chunksReceived: this.transcriptChunks.length,
						chunksSent: this.chunksSent,
					},
					"Deepgram streaming error",
				);

				this.isConnecting = false;
				this.isConnected = false;

				// Emit streaming_failed if connection was lost mid-session
				if (wasConnectedBeforeError && !this.isStopping) {
					const failureReason: StreamingFailureReason = {
						type: "error",
						message: error?.message || "Unknown error",
						duration,
						chunksReceived: this.transcriptChunks.length,
						chunksSent: this.chunksSent,
					};
					this.emit("streaming_failed", failureReason);
				}

				this.emit("error", error);
			});

			this.connection.on(LiveTranscriptionEvents.Close, () => {
				const wasConnectedBeforeClose = this.isConnected;
				const duration =
					this.connectionStartTime > 0
						? Date.now() - this.connectionStartTime
						: 0;

				this.isConnected = false;
				this.isConnecting = false;

				logger.info(
					{
						duration,
						chunksReceived: this.transcriptChunks.length,
						chunksSent: this.chunksSent,
						expected: this.isStopping,
					},
					"Deepgram streaming connection closed",
				);

				if (wasConnectedBeforeClose && !this.isStopping) {
					const failureReason: StreamingFailureReason = {
						type: "close",
						message: "Connection closed unexpectedly",
						duration,
						chunksReceived: this.transcriptChunks.length,
						chunksSent: this.chunksSent,
					};
					this.emit("streaming_failed", failureReason);
				}

				this.emit("close");
			});

			// Setup connection timeout monitor
			this.monitorConnection().catch((err) => {
				logger.error({ err }, "Connection monitor failed");
			});
		} catch (error) {
			this.isConnecting = false; // Ensure flag is reset on sync error
			logError("Failed to start Deepgram streaming", error);
			throw error;
		}
	}

	private async monitorConnection() {
		// Wait for connection to open or timeout
		const timeoutMs = 5000;
		const checkInterval = 100;
		let elapsed = 0;

		while (elapsed < timeoutMs) {
			if (this.isConnected) return;
			if (!this.connection && !this.isConnecting) return; // Stopped or failed

			await new Promise((resolve) => setTimeout(resolve, checkInterval));
			elapsed += checkInterval;
		}

		if (this.isConnecting) {
			const err = new Error("Deepgram streaming connection timeout");
			logger.error("Deepgram streaming connection timed out");
			this.emit("error", err);
			if (this.connection) {
				try {
					this.connection.removeAllListeners();
					this.connection.requestClose();
				} catch (e) {
					logger.error({ err: e }, "Failed to close timed out connection");
				}
				this.connection = null;
			}
			this.isConnecting = false;
		}
	}

	private flushBuffer() {
		if (this.audioBuffer.length > 0) {
			logger.debug(
				{ chunks: this.audioBuffer.length },
				"Flushing buffered audio to Deepgram",
			);
			if (this.connection && this.isConnected) {
				for (const chunk of this.audioBuffer) {
					try {
						const arrayBuffer = chunk.buffer.slice(
							chunk.byteOffset,
							chunk.byteOffset + chunk.byteLength,
						);
						this.connection.send(arrayBuffer);
						this.chunksSent++;
					} catch (error) {
						logError("Failed to send buffered chunk to Deepgram", error);
					}
				}
			}
			this.audioBuffer = [];
		}
	}

	public send(audioChunk: Buffer) {
		if (this.connection && this.isConnected) {
			try {
				const arrayBuffer = audioChunk.buffer.slice(
					audioChunk.byteOffset,
					audioChunk.byteOffset + audioChunk.byteLength,
				);
				this.connection.send(arrayBuffer);
				this.chunksSent++;
			} catch (error) {
				logError("Failed to send audio chunk to Deepgram", error);
			}
		} else if (this.isConnecting) {
			if (
				this.audioBuffer.length >=
				DeepgramStreamingTranscriber.MAX_BUFFER_CHUNKS
			) {
				logger.warn(
					"Audio buffer full while connecting, dropping chunk to prevent memory leak",
				);
				return;
			}
			this.audioBuffer.push(audioChunk);
		}
	}

	public async stop(): Promise<StreamingResult> {
		this.isStopping = true;
		let stopReason: StreamingStopReason = "not_connected";
		let finalizeWaitMs = 0;
		let closeWaitMs = 0;

		if (this.connection) {
			try {
				// Flush any buffered audio before closing
				this.connection.finalize();
				logger.debug("Sent finalize signal to Deepgram");

				// Wait for final transcript after finalize
				const finalizeStart = Date.now();
				stopReason = await new Promise<StreamingStopReason>((resolve) => {
					const timeout = setTimeout(() => {
						logger.debug("Finalize wait timeout, proceeding");
						this.off("transcript", transcriptHandler);
						resolve("finalize_timeout");
					}, DeepgramStreamingTranscriber.FINALIZE_TIMEOUT_MS);

					const transcriptHandler = () => {
						clearTimeout(timeout);
						resolve("finalize_transcript");
					};
					this.once("transcript", transcriptHandler);
				});
				finalizeWaitMs = Date.now() - finalizeStart;

				// Now close the connection
				this.connection.requestClose();

				const closeStart = Date.now();
				const closeClean = await new Promise<boolean>((resolve) => {
					const timeout = setTimeout(() => {
						logger.warn(
							"Deepgram close timeout, proceeding with available transcripts",
						);
						resolve(false);
					}, 2000);

					this.once("close", () => {
						clearTimeout(timeout);
						resolve(true);
					});
				});
				closeWaitMs = Date.now() - closeStart;

				// Preserve close_timeout info using compound value to distinguish:
				// - "finalize_transcript+close_timeout": finalize worked, transport stalled
				// - "finalize_timeout+close_timeout": both stages timed out
				if (!closeClean) {
					stopReason = `${stopReason}+close_timeout` as StreamingStopReason;
				}
			} catch (error) {
				logError("Error finishing Deepgram streaming", error);
			} finally {
				this.connection.removeAllListeners();
				this.connection = null;
				this.isConnected = false;
				this.isConnecting = false;
				this.audioBuffer = [];
			}
		}

		// Also clear state if stop called while no connection exists
		this.isConnecting = false;
		this.isConnected = false;
		this.audioBuffer = [];

		const finalText = this.transcriptChunks.join(" ").trim();
		logger.debug(
			{
				chunkCount: this.transcriptChunks.length,
				textLength: finalText.length,
				stopReason,
				finalizeWaitMs,
				closeWaitMs,
			},
			"Deepgram streaming transcription complete",
		);

		return {
			text: finalText,
			chunkCount: this.transcriptChunks.length,
			stopReason,
			finalizeWaitMs,
			closeWaitMs,
		};
	}
}
