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

		expect(events).toEqual(["hello", "world!"]);
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
		expect(result.paragraphBreakCount).toBe(0);
		expect(result.stopReason).toBe("finalize_transcript");
	});

	test("joins tokens with spaces and collapses double spaces", async () => {
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
					{ text: "  ", is_final: true },
					{ text: "world", is_final: true },
				],
			}),
		);

		expect(events).toEqual(["hello world"]);
	});

	test("strips spaces before punctuation", async () => {
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
					{ text: "world ", is_final: true },
					{ text: ", ", is_final: true },
					{ text: "test ", is_final: true },
					{ text: ". ", is_final: true },
					{ text: "Hello ", is_final: true },
					{ text: "! ", is_final: true },
				],
			}),
		);

		expect(events).toEqual(["world, test. Hello!"]);
	});

	test("inserts double-space paragraph break on long pause", async () => {
		MockSonioxWebSocket.instances = [];
		const transcriber = new SonioxStreamingTranscriber({
			apiKey: "soniox-test-key",
			createWebSocket: (url) => new MockSonioxWebSocket(url),
			paragraphPauseMs: 100,
		});
		const events: string[] = [];
		transcriber.on("transcript", (text) => events.push(text));

		await transcriber.start("en");
		const socket = getSocket();
		socket.open();

		socket.receive(
			JSON.stringify({
				tokens: [{ text: "first sentence", is_final: true }],
			}),
		);

		await new Promise((resolve) => setTimeout(resolve, 150));

		socket.receive(
			JSON.stringify({
				tokens: [{ text: "second sentence", is_final: true }],
			}),
		);

		expect(events.length).toBe(2);
		expect(events[1]).toContain("  ");
	});

	test("does not insert paragraph break on short pause", async () => {
		MockSonioxWebSocket.instances = [];
		const transcriber = new SonioxStreamingTranscriber({
			apiKey: "soniox-test-key",
			createWebSocket: (url) => new MockSonioxWebSocket(url),
			paragraphPauseMs: 5000,
		});
		const events: string[] = [];
		transcriber.on("transcript", (text) => events.push(text));

		await transcriber.start("en");
		const socket = getSocket();
		socket.open();

		socket.receive(
			JSON.stringify({
				tokens: [{ text: "first", is_final: true }],
			}),
		);

		socket.receive(
			JSON.stringify({
				tokens: [{ text: "second", is_final: true }],
			}),
		);

		expect(events.length).toBe(2);
		expect(events[1]).not.toContain("  ");
	});

	test("includes paragraphBreakCount in stop result", async () => {
		MockSonioxWebSocket.instances = [];
		const transcriber = new SonioxStreamingTranscriber({
			apiKey: "soniox-test-key",
			createWebSocket: (url) => new MockSonioxWebSocket(url),
			paragraphPauseMs: 100,
		});

		await transcriber.start("en");
		const socket = getSocket();
		socket.open();

		socket.receive(
			JSON.stringify({
				tokens: [{ text: "first", is_final: true }],
			}),
		);

		await new Promise((resolve) => setTimeout(resolve, 150));

		socket.receive(
			JSON.stringify({
				tokens: [{ text: "second", is_final: true }],
			}),
		);

		const resultPromise = transcriber.stop();
		socket.close();
		const result = await resultPromise;

		expect(result.paragraphBreakCount).toBe(1);
	});

	test("resets paragraphBreakCount on start", async () => {
		MockSonioxWebSocket.instances = [];
		const transcriber = new SonioxStreamingTranscriber({
			apiKey: "soniox-test-key",
			createWebSocket: (url) => new MockSonioxWebSocket(url),
			paragraphPauseMs: 100,
		});

		await transcriber.start("en");
		const socket1 = getSocket();
		socket1.open();

		socket1.receive(
			JSON.stringify({
				tokens: [{ text: "first", is_final: true }],
			}),
		);

		await new Promise((resolve) => setTimeout(resolve, 150));

		socket1.receive(
			JSON.stringify({
				tokens: [{ text: "second", is_final: true }],
			}),
		);

		const result1 = await (async () => {
			const p = transcriber.stop();
			socket1.close();
			return p;
		})();

		expect(result1.paragraphBreakCount).toBe(1);

		MockSonioxWebSocket.instances = [];
		await transcriber.start("en");
		const socket2 = getSocket();
		socket2.open();

		socket2.receive(
			JSON.stringify({
				tokens: [{ text: "fresh", is_final: true }],
			}),
		);

		const result2Promise = transcriber.stop();
		socket2.close();
		const result2 = await result2Promise;

		expect(result2.paragraphBreakCount).toBe(0);
	});
});
