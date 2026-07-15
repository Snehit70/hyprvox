# AGENTS.md

Lean repo guide for automated agents.

## Source Of Truth
- `docs/ARCHITECTURE.md`
- `docs/STT_FLOW.md`
- `docs/CONFIGURATION.md`
- `docs/CLI_COMMANDS.md`
- Product requirements live in GitHub issues (epics + child tickets), not a local `PRD.md`.

## Stack
- Bun runtime and package manager (CLI/tests); the app itself runs under Electron/Node
- Strict TypeScript
- pino logs with daily rotation
- Single Electron app hosts the daemon and the overlay window (ADR-0003); state flows main → renderer via webContents.send

## Current Product State
- Hyprvox uses parallel Groq + Deepgram transcription with merge/validation/recovery.
- Quality guardrails now validate prompt artifacts, suffix hallucinations, mixed-script garbage, and long-recording merge expansion.
- Deepgram streaming exposes finalize/close timing metrics for future tuning.
- Endpoint/model tuning is paused until at least one week of fresh usage data is collected.

## Where To Look First
- `src/daemon/service.ts`
- `src/transcribe/`
- `docs/STT_FLOW.md`
- `docs/CONFIGURATION.md`
- `docs/ARCHITECTURE.md`

## Operational Data
- Config: `~/.config/hypr/vox/config.json`
- Logs: `paths.logs` from config; app stdout/stderr in `~/.config/hypr/vox/logs/app.log`
- History: `~/.config/voice-cli/history.json`
- Command socket (single-instance guard + `soniox-toggle`): `~/.config/hypr/vox/daemon.sock`
- App bundle: `dist/app` (built by `bun run build:app`; `package.json` name there sets WM_CLASS)

## Workflow Notes
- Default hotkey: Right Control; Hyprland users often bind `hyprvox toggle` in the compositor.
- `bun run index.ts health` is the first check for setup/debugging.
- Keep `plan.md` untracked.
