# Project Architecture

`hyprvox` follows a feature-based directory structure to ensure high cohesion and low coupling between different parts of the system.

## Directory Structure

```
src/
├── app/            # Electron main: hosts the daemon + overlay window (single process)
├── audio/          # Recording and audio device management
├── cli/            # CLI command implementations
├── config/         # Configuration loading, validation, and storage
├── daemon/         # Background service and hotkey handling
├── output/         # Clipboard and notification integration
├── shared/         # IPC message types shared with the overlay renderer
├── transcribe/     # External API integrations (Groq & Deepgram)
├── utils/          # Shared utilities and helpers
├── types/          # External type definitions
overlay/            # Renderer + preload assets for the overlay window (built to overlay/dist)
```

## Core Architecture

### 1. Single-App Topology (ADR-0003)
`hyprvox` is one resident Electron app: the main process hosts the daemon (`DaemonService`) and the overlay `BrowserWindow`. There is no supervisor process, no systemd unit, and no daemon↔overlay socket — Electron is the single supervisor.

- **App main (`src/app/main.ts`)**: Boots the command socket (single-instance guard), starts `DaemonService` in-process, creates the overlay window, and forwards daemon state to the renderer via `webContents.send`.
- **Service (`src/daemon/service.ts`)**: The orchestrator. Maintains the state machine and coordinates hardware (audio/keyboard) with remote APIs. Emits `state` and `audioLevel` events (it is an `EventEmitter`); the app main relays them to the renderer.
- **Command socket (`src/app/command-server.ts`)**: A minimal unix socket (`daemon.sock`) for CLI verbs that need a payload (`soniox-toggle`); binding it doubles as the single-instance guard.
- **Launch & crash recovery**: Started via Hyprland `exec-once = hyprvox start`. If the app dies, the next `hyprvox toggle` lazily respawns it.
- **Window identity**: The window must map as an XWayland client with `WM_CLASS` `hyprvox-overlay` (Hyprland rules target that class, and self-positioning — how the overlay parks off-screen — only works under XWayland). The launcher strips `ELECTRON_OZONE_PLATFORM_HINT` and the app pins `--ozone-platform=x11`; the class comes from `dist/app/package.json`'s `name` field written by `bun run build:app`.

### 2. State Machine
The daemon tracks its status via a formal state machine to ensure predictable behavior:
- `idle`: Waiting for hotkey trigger.
- `starting`: Initializing audio hardware.
- `recording`: Capturing audio from the microphone.
- `stopping`: Ending the recording session.
- `processing`: Sending data to transcription APIs and merging results.
- `error`: Recovering from a failure.

### 3. Global Hotkey Listener (`src/daemon/hotkey.ts`)
Uses `node-global-key-listener` to monitor keyboard events across the entire OS (Wayland/X11).
- **Toggle Mode**: First press triggers `start`, second press triggers `stop`.
- **Conflict Detection**: Verifies the hotkey isn't bound by other processes at startup.

### 4. Transcription Data Flow
The transcription cycle follows a strictly orchestrated path (see [STT Flow Details](STT_FLOW.md) for a deep dive):
1. **Trigger**: `HotkeyListener` emits a `trigger` event.
2. **Record**: `AudioRecorder` starts `arecord` via `node-record-lpcm16`. Audio chunks are streamed into a buffer.
3. **Conversion**: Audio is converted to optimal format (16kHz WAV Mono) for API consumption.
4. **Parallel Execution**: Audio is sent simultaneously to **Groq (Whisper V3)** and **Deepgram (Nova-3)**.
5. **Merge/Select**: `src/transcribe/merger.ts` either uses deterministic source selection for near-identical transcripts or calls the configured merge model when synthesis is needed.
6. **Quality Guard**: `src/transcribe/quality.ts`, `src/transcribe/recovery.ts`, and `src/transcribe/long-recording.ts` validate, repair, trim, or fall back before text reaches output.
7. **Output**:
   - **Clipboard**: Final text is appended to the system clipboard (Wayland via `wl-copy`, X11 via `clipboardy`).
   - **History**: Transcription is logged to `~/.config/hypr/vox/history.json`.
   - **Notification**: Desktop notification is sent via `notify-send`.

## Feature Modules

For details on using these modules programmatically, see the [Programmatic API Reference](API.md).

### 🎤 Audio Management (`src/audio/`)
- **`recorder.ts`**: Handles the `arecord` process lifecycle and provides a stream-based interface for recording.
- **`device-service.ts`**: Discovers and lists available ALSA input devices.
- **`converter.ts`**: Uses `ffmpeg` (or similar) to ensure audio format compatibility.

### 💻 CLI Interface (`src/cli/`)
- **`index.ts`**: The main entry point for CLI commands.
- **`status.ts`**: Provides real-time status by reading `daemon.state`.
- **`health.ts`**: Diagnostic tool to verify API keys and audio setup.

### ⚙️ Configuration Engine (`src/config/`)
- **`schema.ts`**: Zod-based validation schema for configuration.
- **`loader.ts`**: Handles reading from disk and merging with environment variables.
- **`service.ts`**: Singleton for config access with hot-reload support (SIGUSR2).
- **`writer.ts`**: Safely writes updates back to the configuration file with correct permissions (600).

### 📤 Output Systems (`src/output/`)
- **`clipboard.ts`**: Appends transcripts to the system clipboard with Wayland/X11 detection.
- **`notification.ts`**: Sends desktop notifications with support for different urgency levels.

### ☁️ Transcription Services (`src/transcribe/`)
- **`groq.ts`**: Integration with Groq Cloud SDK.
- **`deepgram.ts`**: Integration with Deepgram SDK.
- **`deepgram-streaming.ts`**: WebSocket streaming path with finalize/close timing metrics.
- **`merger.ts`**: Deterministic and LLM-backed transcript merge logic, including formatting modes and rate-limit fallback for merge calls.
- **`quality.ts`**: Transcript validation for prompt artifacts, CoT/meta leakage, injected technical-token bursts, hallucination suffixes, mixed-script garbage, and garbage fragments.
- **`recovery.ts`**: Repair and source-fallback policy after validation failure.
- **`lexicon.ts`**: Local technical-term lexicon used for provider hints and merge context.
- **`long-recording.ts`**: Long-recording merge expansion guard and validated source fallback selection.

### 🛠️ Utilities (`src/utils/`)
- **`logger.ts`**: Structured JSON logging with daily rotation.
- **`error-templates.ts`**: Standardized, user-friendly error messages.
- **`retry.ts`**: Generic retry logic with backoff and timeout handling.

## Error Handling & Resilience
- **API Fallback**: If one transcription service fails, the other is used automatically.
- **Merge-Key Fallback**: If the primary Groq merge key is rate-limited or quota-limited, merge and repair calls can retry with `apiKeys.groqFallback`.
- **Quality Recovery**: Invalid merged output is repaired once when possible, then falls back to a clean source transcript.
- **Long Recording Guard**: Suspicious long-recording merge expansion falls back to the longest valid source transcript.
- **Fail Fast**: Prioritizes speed over exhaustive retries (max 2 attempts).
- **Audio Validation**: Automatically rejects recordings shorter than 0.6s and warns on silent audio.
- **Safety**: Never overwrites clipboard content; always appends to history.
- **Structured Error Responses**: All internal errors are mapped to user-friendly templates in `src/utils/error-templates.ts`.

## Contributor Guide

### Development Environment
- **Runtime**: [Bun](https://bun.sh) is the required runtime and package manager.
- **Language**: TypeScript (strict mode enabled).
- **Audio Logic**: Uses `node-record-lpcm16` which wraps `arecord`.
- **Keyboard Logic**: Uses `node-global-key-listener`.

### Getting Started
1. Clone the repository: `git clone https://github.com/Snehit70/hyprvox.git`
2. Install dependencies: `bun install`
3. Build the overlay assets (also installs the Electron runtime): `bun run build:overlay`
4. Build the app bundle: `bun run build:app`
5. Start the app: `bun run index.ts start` (add `--foreground` to stay attached)

### Testing
We use [Vitest](https://vitest.dev/) for testing.
- **Run all tests**: `bun test`
- **Run with coverage**: `bun test --coverage`
- **Run safe local suite (no integration)**: `bun run test:safe`
- **Run isolated integration suite**: `bun run test:integration`
- **Run full integration suite (no HOME/runtime isolation)**: `bun run test:integration:full`
- **Unit tests**: Located in `tests/` directory, mirroring the `src/` structure.
- **Integration tests**: Located in `tests/integration/`.
- **Test runtime safety**: test scripts set `HYPRVOX_TEST_MODE=1`, which suppresses desktop notifications so integration tests do not send real user popups.

### Code Style
- Follow the existing functional programming patterns where appropriate.
- Use `async/await` for all asynchronous operations.
- Ensure all new features are accompanied by tests.
- Add JSDoc comments for complex logic.

### Error Handling
- All new functions should have comprehensive error handling.
- Use `src/utils/error-templates.ts` for user-facing error messages.
- Log errors using the structured `logger` from `src/utils/logger.ts`.

## Data Flow Diagram
For a detailed visualization of how audio moves through the system, refer to [STT Flow Details](STT_FLOW.md).
