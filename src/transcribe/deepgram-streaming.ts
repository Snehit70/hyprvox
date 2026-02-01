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

export class DeepgramStreamingTranscriber extends EventEmitter {
	private client: DeepgramClient;
	private connection: LiveClient | null = null;
	private transcriptChunks: string[] = [];
	private isConnected: boolean = false;

	constructor() {
		super();
		const config = loadConfig();
		this.client = createClient(config.apiKeys.deepgram);
	}

	public async start(language: string = "en", boostWords: string[] = []) {
		try {
			this.transcriptChunks = [];
			this.isConnected = false;

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

			if (boostWords.length > 0) {
				options.keywords = boostWords;
			}

			this.connection = this.client.listen.live(options);

			this.connection.on(LiveTranscriptionEvents.Open, () => {
				this.isConnected = true;
				logger.info("Deepgram streaming connection opened");
				this.emit("open");
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
				this.emit("error", error);
			});

			this.connection.on(LiveTranscriptionEvents.Close, () => {
				this.isConnected = false;
				logger.info("Deepgram streaming connection closed");
				this.emit("close");
			});

			// Wait for connection to open
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error("Deepgram streaming connection timeout"));
				}, 5000);

				this.once("open", async () => {
					clearTimeout(timeout);
					// Add buffer time for WebSocket to be fully ready
					await new Promise((r) => setTimeout(r, 200));
					logger.info("Deepgram streaming ready to receive audio");
					resolve();
				});

				this.once("error", (err) => {
					clearTimeout(timeout);
					reject(err);
				});
			});
		} catch (error) {
			logError("Failed to start Deepgram streaming", error);
			throw error;
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
		}
	}

	public async stop(): Promise<string> {
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
			}
		}

		const finalText = this.transcriptChunks.join(" ").trim();
		logger.info(
			{
				chunkCount: this.transcriptChunks.length,
				textLength: finalText.length,
			},
			"Deepgram streaming transcription complete",
		);

		return finalText;
	}
}
