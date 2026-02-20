# Programmatic API Reference

`hyprvox` is designed primarily as a CLI tool and daemon, but its core modules are built to be highly reusable. If you are developing other tools in TypeScript/Node.js, you can import and use these components directly.

> **Note**: This project is currently marked as private and uses Bun. Ensure your environment supports Bun or is configured to handle TypeScript files if importing from `src/`.

## Table of Contents
- [Audio Management](#audio-management)
  - [AudioRecorder](#audiorecorder)
  - [AudioDeviceService](#audiodeviceservice)
- [Transcription Services](#transcription-services)
  - [GroqClient](#groqclient)
  - [DeepgramTranscriber](#deepgramtranscriber)
  - [TranscriptMerger](#transcriptmerger)
- [Output Systems](#output-systems)
  - [ClipboardManager](#clipboardmanager)
- [Daemon Integration](#daemon-integration)
  - [DaemonService](#daemonservice)

---

## Audio Management

### `AudioRecorder`
Located in `src/audio/recorder.ts`. Handles the lifecycle of recording audio from the system microphone.

#### Methods
- `start(): Promise<void>`: Starts recording audio at 16kHz WAV Mono.
- `stop(force?: boolean): Promise<Buffer | null>`: Stops recording and returns the audio buffer.
- `isRecording(): boolean`: Returns `true` if a recording is currently in progress.

#### Events
- `start`: Emitted when recording successfully starts.
- `stop (audioBuffer: Buffer, duration: number)`: Emitted when recording stops normally.
- `warning (msg: string)`: Emitted for non-fatal issues (e.g., silence detected).
- `error (err: Error)`: Emitted for fatal recording errors.

---

### `AudioDeviceService`
Located in `src/audio/device-service.ts`. Used to discover available audio input devices.

#### Methods
- `listDevices(): Promise<AudioDevice[]>`: Returns a list of available ALSA input devices.

#### Types
```typescript
interface AudioDevice {
  id: string;          // ALSA device ID (e.g., "default", "hw:0,0")
  name: string;        // Human-readable name
  description: string; // Detailed device description
}
```

---

## Transcription Services

### `GroqClient`
Located in `src/transcribe/groq.ts`. High-speed transcription using Groq's Whisper Large V3.

#### Methods
- `transcribe(audioBuffer: Buffer, language?: string, boostWords?: string[]): Promise<string>`: Transcribes the provided audio buffer.
- `checkConnection(): Promise<boolean>`: Verifies API connectivity.

---

### `DeepgramTranscriber`
Located in `src/transcribe/deepgram.ts`. Reliable transcription using Deepgram's Nova-3.

#### Methods
- `transcribe(audioBuffer: Buffer, language?: string, boostWords?: string[]): Promise<string>`: Transcribes the provided audio buffer.
- `checkConnection(): Promise<boolean>`: Verifies API connectivity.

---

### `TranscriptMerger`
Located in `src/transcribe/merger.ts`. Uses Llama 3.3 70B to merge transcripts from multiple sources.

#### Methods
- `merge(groqText: string, deepgramText: string): Promise<string>`: Intelligently combines two transcripts into one polished result.

---

## Output Systems

### `ClipboardManager`
Located in `src/output/clipboard.ts`. Manages system clipboard operations for Wayland and X11.

#### Methods
- `append(text: string): Promise<void>`: Appends the given text to the system clipboard (respecting the `behavior.clipboard.append` configuration).

---

## Daemon Integration

### `DaemonService`
Located in `src/daemon/service.ts`. The central orchestrator that manages the entire recording-to-transcription lifecycle.

#### Methods
- `start(): Promise<void>`: Initializes hardware listeners and starts the daemon state machine.
- `stop(): void`: Safely shuts down listeners and cleans up PID files.

#### Properties
- `status`: Current state of the daemon (`idle`, `recording`, `processing`, etc.).

---

## Example Usage

Detailed examples are available in the [scripts/examples/](../scripts/examples/) directory.

### Simple Transcription
```typescript
import { GroqClient } from "./src/transcribe/groq";
import { readFileSync } from "node:fs";

const groq = new GroqClient();
const buffer = readFileSync("audio.wav");
const text = await groq.transcribe(buffer);
console.log(text);
```

### Parallel Transcription with Merging
This is the recommended way to use the API for maximum accuracy.

```typescript
import { GroqClient } from "./src/transcribe/groq";
import { DeepgramTranscriber } from "./src/transcribe/deepgram";
import { TranscriptMerger } from "./src/transcribe/merger";

const groq = new GroqClient();
const deepgram = new DeepgramTranscriber();
const merger = new TranscriptMerger();

const buffer = Buffer.from(...); // Your audio buffer

const [groqText, deepgramText] = await Promise.all([
  groq.transcribe(buffer),
  deepgram.transcribe(buffer)
]);

const finalResult = await merger.merge(groqText, deepgramText);
```

### Full Event-Driven Recording
```typescript
import { AudioRecorder } from "./src/audio/recorder";

const recorder = new AudioRecorder();

recorder.on("start", () => console.log("Recording..."));
recorder.on("warning", (msg) => console.warn(msg));
recorder.on("error", (err) => console.error(err));

await recorder.start();
// ... wait ...
const audioBuffer = await recorder.stop();
```
