import type { AudioRecorder, PcmAudioPayload } from "../audio/recorder";
import type { Config } from "../config/schema";
import { LiveDictationWriter, type TextTyper } from "../output/live-dictation";
import { DeepgramStreamingTranscriber } from "../transcribe/deepgram-streaming";
import type { GroqSingleFileTranscriber } from "../transcribe/groq-chunking";
import { GroqLiveChunkSession } from "../transcribe/groq-live-chunking";
import {
	isCommittedLiveTranscript,
	type LiveStreamingProvider,
	type LiveTranscriptEvent,
} from "../transcribe/live-provider";
import { logError, logger } from "../utils/logger";

interface StartDeepgramStreamingInput {
	config: Config;
	boostWords: string[];
	onStreamingInterrupted: () => void;
}

interface CreateLiveGroqSessionInput {
	config: Config;
	boostWords: string[];
	transcribe: GroqSingleFileTranscriber;
}

interface AttachStreamingPcmHandlerInput {
	recorder: AudioRecorder;
	deepgramStreaming?: DeepgramStreamingTranscriber;
	liveProvider?: LiveStreamingProvider;
	liveGroqSession?: GroqLiveChunkSession;
}

interface TranscriptEventSource {
	on(
		event: "transcript",
		listener: (text: string, event: LiveTranscriptEvent) => void,
	): unknown;
	off(
		event: "transcript",
		listener: (text: string, event: LiveTranscriptEvent) => void,
	): unknown;
}

interface AttachLiveDictationTranscriptHandlerInput {
	provider: TranscriptEventSource;
	typer: TextTyper;
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

export function attachLiveDictationTranscriptHandler(
	input: AttachLiveDictationTranscriptHandlerInput,
): { detach: () => void; writer: LiveDictationWriter } {
	const { provider, typer } = input;
	const writer = new LiveDictationWriter(typer);
	let pendingWrite = Promise.resolve();

	const handler = (_text: string, event: LiveTranscriptEvent) => {
		if (!isCommittedLiveTranscript(event)) {
			return;
		}

		pendingWrite = pendingWrite
			.then(() => writer.acceptCommittedTranscript(event.text))
			.catch((error) => {
				logError("Failed to type live dictation transcript", error);
			});
	};

	provider.on("transcript", handler);
	return {
		detach: () => {
			provider.off("transcript", handler);
		},
		writer,
	};
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
	const liveProvider = input.liveProvider ?? deepgramStreaming;
	let chunkCount = 0;
	const handler = (payload: PcmAudioPayload) => {
		chunkCount++;
		logger.debug(
			{ chunkNumber: chunkCount, chunkSize: payload.pcm.length },
			"Handler called with PCM chunk",
		);
		liveProvider?.send(payload.pcm);
		if (deepgramStreaming) {
			logger.debug({ chunkNumber: chunkCount }, "Sent chunk to Deepgram");
		}
		liveGroqSession?.acceptPcmData(payload.pcm);
	};
	recorder.on("pcm-data", handler);
	logger.info("Streaming PCM handler attached to recorder");
	return handler;
}
