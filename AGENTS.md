# AGENTS.md

This file provides minimal, durable context for automated agents working in this repo. It intentionally avoids duplicating existing documentation; see referenced sources for details.

## Project Summary
- `hyprvox` is a Linux speech-to-text daemon with a CLI, global hotkey trigger, and clipboard history output.
- Transcription uses parallel Groq (Whisper V3) + Deepgram (Nova-3) and merges results with an LLM.

**Source of truth:**
- Architecture: `docs/ARCHITECTURE.md`
- End-to-end flow: `docs/STT_FLOW.md`
- Configuration: `docs/CONFIGURATION.md`
- CLI usage: `docs/CLI_COMMANDS.md`
- Product requirements: `PRD.md`

## Runtime & Stack
- Runtime: Bun (package manager + runtime)
- Language: TypeScript (strict)
- Logging: pino w/ daily rotated log files
- Overlay: Electron sidecar started by the daemon over local IPC

**Details:** `package.json`, `docs/ARCHITECTURE.md`

## Key Modules
- `src/daemon/`: daemon supervisor + service lifecycle
- `src/audio/`: recording + conversion
- `src/transcribe/`: Groq + Deepgram + merger
- `src/output/`: clipboard + notifications
- `src/config/`: config schema/loader

**Details:** `docs/ARCHITECTURE.md`

## LLM Merge
- Merge logic is in `src/transcribe/merger.ts`.
- Uses Groq LLM to merge transcripts from Groq Whisper and Deepgram Nova-3.
- Model is configurable via `transcription.mergeModel` (default: `llama-3.3-70b-versatile`).

**Log files:** use `paths.logs` from config; current local config writes to `~/.config/voice-cli/logs/`

## Where to Find Operational Data
- Config dir: `~/.config/hypr/vox/`
- Logs: configured by `paths.logs` in `~/.config/hypr/vox/config.json` (current local config uses `~/.config/voice-cli/logs/`)
- History: `~/.config/voice-cli/history.json`
- Config: `~/.config/hypr/vox/config.json`
- IPC socket: `~/.config/hypr/vox/daemon.sock`
- Overlay PID file: `~/.config/hypr/vox/overlay.pid`

## Known Workflows
- Hotkey toggle: Right Control (default). Recording starts on first press, stops on second.
- In Hyprland setups, the built-in hotkey is often disabled and a compositor binding calls `hyprvox toggle` instead.
- Output: text appended to clipboard + notification; history entry stored.

## Overlay Notes
- Overlay process is launched by `src/daemon/service.ts` and connects to the daemon over IPC.
- If transcription still works but visual feedback disappears, check overlay status separately from daemon status.
- First places to inspect are `bun run index.ts health`, `bun run index.ts overlay`, `journalctl --user -u hyprvox.service`, and the configured log directory from `paths.logs`.

**Details:** `docs/STT_FLOW.md`, `docs/CONFIGURATION.md`
