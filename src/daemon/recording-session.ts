import type { AudioRecorder, PcmAudioPayload } from "../audio/recorder";
import type { Config } from "../config/schema";
import { DeepgramStreamingTranscriber } from "../transcribe/deepgram-streaming";
import { GroqLiveChunkSession } from "../transcribe/groq-live-chunking";
import { logError, logger } from "../utils/logger";

interface StartDeepgramStreamingInput {
	config: Config;
	boostWords: string[];
	onStreamingInterrupted: () => void;
}

interface CreateLiveGroqSessionInput {
	config: Config;
	boostWords: string[];
	transcribe: (
		buffer: Buffer,
		language: string,
		boostWords: string[],
		format: "opus" | "wav",
		recordingMs?: number,
		signal?: AbortSignal,
	) => Promise<string>;
}

interface AttachStreamingPcmHandlerInput {
	recorder: AudioRecorder;
	deepgramStreaming?: DeepgramStreamingTranscriber;
	liveGroqSession?: GroqLiveChunkSession;
}

export async function stopDeepgramStreaming(
	deepgramStreaming: DeepgramStreamingTranscriber | undefined,
	logMessage: string,
): Promise<void> {
	if (!deepgramStreaming) return;
	try {
		await deepgramStreaming.stop();
	} catch (error: unknown) {
		logError(logMessage, error);
	}
}

export function startDeepgramStreaming(
	input: StartDeepgramStreamingInput,
): DeepgramStreamingTranscriber {
	const { config, boostWords, onStreamingInterrupted } = input;
	logger.info("Starting Deepgram streaming connection...");
	const deepgramStreaming = new DeepgramStreamingTranscriber();

	deepgramStreaming.on("transcript", (text) => {
		logger.info({ text }, "Received streaming transcript chunk");
	});
	deepgramStreaming.on("error", (err) => {
		logger.error({ err }, "Deepgram streaming error");
	});
	deepgramStreaming.on("streaming_failed", (reason) => {
		logger.warn(
			{ reason, fallback: "batch mode" },
			"Streaming connection lost, will use batch transcription",
		);
		onStreamingInterrupted();
	});

	const startPromise = deepgramStreaming.start(
		config.transcription.language,
		config.transcription.deepgramBoosting ? boostWords : [],
	);
	startPromise.catch((err) => {
		logError("Failed to initiate Deepgram streaming", err);
	});
	logger.info("Deepgram streaming initiated (background)");
	return deepgramStreaming;
}

export function createLiveGroqSession(
	input: CreateLiveGroqSessionInput,
): GroqLiveChunkSession | undefined {
	const { config, boostWords, transcribe } = input;
	if (!config.transcription.groqChunking.enabled) return undefined;
	const session = new GroqLiveChunkSession({
		chunking: config.transcription.groqChunking,
		language: config.transcription.language,
		boostWords,
		transcribe,
	});
	logger.info("Live Groq chunk session initialized");
	return session;
}

export function attachStreamingPcmHandler(
	input: AttachStreamingPcmHandlerInput,
): (payload: PcmAudioPayload) => void {
	const { recorder, deepgramStreaming, liveGroqSession } = input;
	let chunkCount = 0;
	const handler = (payload: PcmAudioPayload) => {
		chunkCount++;
		logger.debug(
			{ chunkNumber: chunkCount, chunkSize: payload.pcm.length },
			"Handler called with PCM chunk",
		);
		deepgramStreaming?.send(payload.pcm);
		if (deepgramStreaming) {
			logger.debug({ chunkNumber: chunkCount }, "Sent chunk to Deepgram");
		}
		liveGroqSession?.acceptPcmData(payload.pcm);
	};
	recorder.on("pcm-data", handler);
	logger.info("Streaming PCM handler attached to recorder");
	return handler;
}
