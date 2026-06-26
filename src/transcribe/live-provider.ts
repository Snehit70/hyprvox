import type { StreamingResult } from "./deepgram-streaming";

export interface LiveTranscriptEvent {
	text: string;
	isFinal: boolean;
	speechFinal: boolean;
}

export interface LiveStreamingProvider {
	start(language: string, boostWords?: string[]): Promise<void>;
	send(audioChunk: Buffer): void;
	stop(): Promise<StreamingResult>;
}

export function isCommittedLiveTranscript(event: LiveTranscriptEvent): boolean {
	return event.isFinal || event.speechFinal;
}
