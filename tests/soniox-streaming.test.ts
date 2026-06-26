import { describe, expect, test } from "vitest";
import { SonioxStreamingTranscriber } from "../src/transcribe/soniox-streaming";

class MockSonioxWebSocket {
	public static instances: MockSonioxWebSocket[] = [];
	public readyState = 0;
	public onopen: (() => void) | null = null;
	public onmessage: ((event: { data: unknown }) => void) | null = null;
	public onerror: ((event: unknown) => void) | null = null;
	public onclose: (() => void) | null = null;
	public readonly sent: Array<string | Buffer> = [];

	public constructor(public readonly url: string) {
		MockSonioxWebSocket.instances.push(this);
	}

	public send(data: string | Buffer): void {
		this.sent.push(data);
	}

	public close(): void {
		this.readyState = 3;
		this.onclose?.();
	}

	public open(): void {
		this.readyState = 1;
		this.onopen?.();
	}

	public receive(data: unknown): void {
		this.onmessage?.({ data });
	}
}

function getSocket(): MockSonioxWebSocket {
	const socket = MockSonioxWebSocket.instances[0];
	if (!socket) {
		throw new Error("Expected Soniox websocket to be created");
	}
	return socket;
}

describe("SonioxStreamingTranscriber", () => {
	test("starts a Soniox websocket session with raw PCM config", async () => {
		MockSonioxWebSocket.instances = [];
		const transcriber = new SonioxStreamingTranscriber({
			apiKey: "soniox-test-key",
			createWebSocket: (url) => new MockSonioxWebSocket(url),
		});

		await transcriber.start("en");
		const socket = getSocket();
		socket.open();

		expect(socket.url).toBe("wss://stt-rt.soniox.com/transcribe-websocket");
		expect(JSON.parse(String(socket.sent[0]))).toMatchObject({
			api_key: "soniox-test-key",
			model: "stt-rt-v5",
			audio_format: "pcm_s16le",
			sample_rate: 16000,
			num_channels: 1,
			language_hints: ["en"],
			enable_endpoint_detection: true,
		});
	});

	test("buffers audio until the websocket opens", async () => {
		MockSonioxWebSocket.instances = [];
		const transcriber = new SonioxStreamingTranscriber({
			apiKey: "soniox-test-key",
			createWebSocket: (url) => new MockSonioxWebSocket(url),
		});
		const audioChunk = Buffer.from([1, 2, 3]);

		await transcriber.start("en");
		transcriber.send(audioChunk);
		const socket = getSocket();
		socket.open();

		expect(socket.sent.at(-1)).toBe(audioChunk);
	});

	test("emits committed transcript events for final Soniox tokens only", async () => {
		MockSonioxWebSocket.instances = [];
		const transcriber = new SonioxStreamingTranscriber({
			apiKey: "soniox-test-key",
			createWebSocket: (url) => new MockSonioxWebSocket(url),
		});
		const events: string[] = [];
		transcriber.on("transcript", (text) => events.push(text));

		await transcriber.start("en");
		const socket = getSocket();
		socket.open();
		socket.receive(
			JSON.stringify({
				tokens: [
					{ text: "hello", is_final: true },
					{ text: " ", is_final: true },
					{ text: "wor", is_final: false },
				],
			}),
		);
		socket.receive(
			JSON.stringify({
				tokens: [
					{ text: "world", is_final: true },
					{ text: "!", is_final: true },
				],
			}),
		);

		expect(events).toEqual(["hello ", "world!"]);
	});

	test("sends an empty frame on stop and returns the final transcript", async () => {
		MockSonioxWebSocket.instances = [];
		const transcriber = new SonioxStreamingTranscriber({
			apiKey: "soniox-test-key",
			createWebSocket: (url) => new MockSonioxWebSocket(url),
		});

		await transcriber.start("en");
		const socket = getSocket();
		socket.open();
		socket.receive(
			JSON.stringify({
				tokens: [{ text: "done", is_final: true }],
			}),
		);

		const resultPromise = transcriber.stop();
		socket.close();
		const result = await resultPromise;

		expect(socket.sent).toContain("");
		expect(result.text).toBe("done");
		expect(result.chunkCount).toBe(1);
		expect(result.stopReason).toBe("finalize_transcript");
	});
});
