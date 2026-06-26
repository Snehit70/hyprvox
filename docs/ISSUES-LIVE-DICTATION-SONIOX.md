# Offline Issue Breakdown: Live Dictation And Soniox Provider Bypass

## 1. Live Dictation Text Writer Contract

**Type**: AFK

**Blocked by**: None - can start immediately

**User stories covered**: 1, 3, 4, 5, 6, 7, 8, 15, 18

## What to build

Build the smallest focused-input writer path that can accept stable transcript events and type only the committed delta into the currently focused field. The slice should include a command-backed text injection boundary with test doubles for command execution.

## Acceptance criteria

- [ ] Stable transcript chunks insert only new committed text.
- [ ] Repeated transcript events do not duplicate already inserted text.
- [ ] Wayland uses `wtype` by default when available.
- [ ] X11 uses `xdotool type` when Wayland is not active.
- [ ] Tests do not type into the real desktop.
- [ ] Insertion errors are returned as structured failures that callers can log and recover from.

## 2. Live Dictation Config And Readiness

**Type**: AFK

**Blocked by**: Issue 1

**User stories covered**: 8, 9, 13, 14, 18

## What to build

Add configuration for Live Dictation and Soniox credentials without changing default transcription behavior. Readiness checks should report missing optional dependencies only when the feature is enabled.

## Acceptance criteria

- [ ] Existing minimal configs still parse and keep Live Dictation disabled by default.
- [ ] Live Dictation config validates trigger key and insertion command settings.
- [ ] Soniox credentials can be read from config or environment.
- [ ] Missing Soniox credentials do not break default Groq plus Deepgram recording.
- [ ] Tests cover config defaults, enabled Live Dictation config, and invalid trigger key handling.

## 3. Live Provider Contract Around Existing Deepgram Streaming

**Type**: AFK

**Blocked by**: Issue 1

**User stories covered**: 1, 2, 9, 16, 17, 18

## What to build

Introduce a live provider contract that represents streaming transcript events, PCM input, and final transcript stop behavior. Adapt the current Deepgram streaming path to that contract while preserving current default behavior.

## Acceptance criteria

- [ ] Normal streaming recordings still produce the same final clipboard behavior.
- [ ] Live provider events can feed the Live Dictation text writer when enabled.
- [ ] Deepgram streaming failures still fall back to existing batch behavior.
- [ ] Tests prove the contract with a fake provider and do not call Deepgram.

## 4. Soniox Provider Bypass Recording Path

**Type**: AFK

**Blocked by**: Issues 1, 2, 3

**User stories covered**: 10, 11, 12, 13, 14, 16, 17, 18

## What to build

Add Soniox as a live provider and wire a separate provider-bypass trigger key. The path streams recorder PCM to Soniox, feeds stable transcript events to Live Dictation, and writes the final Soniox transcript to clipboard and history without running Groq, Deepgram batch, merge, repair, or quality recovery.

## Acceptance criteria

- [ ] Soniox provider connects to the documented real-time STT WebSocket endpoint.
- [ ] Provider bypass does not call Groq, Deepgram batch, merge, repair, or quality recovery.
- [ ] Final Soniox transcript is copied to clipboard and appended to history.
- [ ] Provider errors surface as user-facing Soniox errors.
- [ ] Tests use a fake WebSocket transport and do not hit Soniox.

## 5. Runtime Verification And PR Readiness

**Type**: HITL

**Blocked by**: Issues 1, 2, 3, 4

**User stories covered**: 1-18

## What to build

Run the focused local test suite, verify no default behavior changed, perform a manual live dictation check on the user machine, then prepare incremental commits and a PR.

## Acceptance criteria

- [ ] Focused unit tests pass.
- [ ] Default config and normal transcription behavior remain unchanged.
- [ ] Live Dictation can be manually tested in a scratch focused input.
- [ ] Soniox provider bypass can be manually tested when credentials are available.
- [ ] Commits are incremental and scoped to planning, infrastructure, provider contract, Soniox path, and verification.
