# AGENTS.md

This file provides minimal, durable context for automated agents working in this repo. It intentionally avoids duplicating existing documentation; see referenced sources for details.

## Project Summary
- `voice-cli` is a Linux speech-to-text daemon with a CLI, global hotkey trigger, and clipboard history output.
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

**Log files:** `~/.config/voice-cli/logs/voice-cli-YYYY-MM-DD.log`

## Where to Find Operational Data
- Logs: `~/.config/voice-cli/logs/`
- History: `~/.config/voice-cli/history.json`
- Config: `~/.config/voice-cli/config.json`

## Known Workflows
- Hotkey toggle: Right Control (default). Recording starts on first press, stops on second.
- Output: text appended to clipboard + notification; history entry stored.

**Details:** `docs/STT_FLOW.md`, `docs/CONFIGURATION.md`
