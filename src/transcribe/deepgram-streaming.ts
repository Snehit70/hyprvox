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

export interface StreamingResult {
	text: string;
	chunkCount: number;
}

export class DeepgramStreamingTranscriber extends EventEmitter {
	private client: DeepgramClient;
	private connection: LiveClient | null = null;
	private transcriptChunks: string[] = [];
	private isConnected: boolean = false;
	private isConnecting: boolean = false;
	private audioBuffer: Buffer[] = [];
	private static readonly MAX_BUFFER_CHUNKS = 100;

	constructor() {
		super();
		const config = loadConfig();
		this.client = createClient(config.apiKeys.deepgram);
	}

	public async start(language: string = "en") {
		try {
			this.transcriptChunks = [];
			this.isConnected = false;
			this.isConnecting = true;
			this.audioBuffer = [];

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
			};

			this.connection = this.client.listen.live(options);

			this.connection.on(LiveTranscriptionEvents.Open, () => {
				if (!this.connection) return; // Connection was closed before open
				this.isConnected = true;
				this.isConnecting = false;
				logger.info("Deepgram streaming connection opened");
				this.emit("open");
				this.flushBuffer();
			});

			this.connection.on(LiveTranscriptionEvents.Transcript, (data) => {
				const transcript = data.channel?.alternatives?.[0]?.transcript;

				if (transcript && transcript.trim().length > 0) {
					if (data.speech_final) {
						this.transcriptChunks.push(transcript.trim());
						logger.info(
							{ transcript: transcript.trim(), isFinal: true },
							"Deepgram chunk finalized (speech_final)",
						);
						this.emit("transcript", transcript.trim());
					} else if (data.is_final) {
						this.transcriptChunks.push(transcript.trim());
						logger.info(
							{ transcript: transcript.trim(), isFinal: data.is_final },
							"Deepgram chunk finalized (is_final)",
						);
						this.emit("transcript", transcript.trim());
					}
				}
			});

			this.connection.on(LiveTranscriptionEvents.Error, (error) => {
				logger.error(
					{ error: JSON.stringify(error, null, 2) },
					"Deepgram streaming error",
				);
				this.isConnecting = false;
				this.isConnected = false;
				this.emit("error", error);
			});

			this.connection.on(LiveTranscriptionEvents.Close, () => {
				this.isConnected = false;
				this.isConnecting = false;
				logger.info("Deepgram streaming connection closed");
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
			// Use connection.send directly to avoid re-buffering check in this.send()
			if (this.connection && this.isConnected) {
				for (const chunk of this.audioBuffer) {
					try {
						const arrayBuffer = chunk.buffer.slice(
							chunk.byteOffset,
							chunk.byteOffset + chunk.byteLength,
						);
						this.connection.send(arrayBuffer);
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
		if (this.connection) {
			try {
				// Flush any buffered audio before closing
				this.connection.finalize();
				logger.debug("Sent finalize signal to Deepgram");

				// Wait for final transcript after finalize
				await new Promise<void>((resolve) => {
					const timeout = setTimeout(() => {
						logger.debug("Finalize wait timeout, proceeding");
						resolve();
					}, 300);

					const transcriptHandler = () => {
						clearTimeout(timeout);
						resolve();
					};
					this.once("transcript", transcriptHandler);
				});

				// Now close the connection
				this.connection.requestClose();

				await new Promise<void>((resolve) => {
					const timeout = setTimeout(() => {
						logger.warn(
							"Deepgram close timeout, proceeding with available transcripts",
						);
						resolve();
					}, 2000);

					this.once("close", () => {
						clearTimeout(timeout);
						resolve();
					});
				});
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
		logger.info(
			{
				chunkCount: this.transcriptChunks.length,
				textLength: finalText.length,
			},
			"Deepgram streaming transcription complete",
		);

		return { text: finalText, chunkCount: this.transcriptChunks.length };
	}
}
