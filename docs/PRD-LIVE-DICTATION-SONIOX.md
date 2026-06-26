# Live Dictation And Soniox Provider Bypass PRD

## Problem Statement

Hyprvox currently optimizes for final transcript quality: the user records, waits for provider results, receives a merged transcript, and then pastes from the clipboard. That is accurate, but it is not enough for workflows where the focused input should fill as the user speaks. The user also wants a low-latency Soniox live path that bypasses the existing Groq plus Deepgram merge pipeline while still copying the final transcript to the clipboard after the recording ends.

## Solution

Add Live Dictation as an explicit output mode. During an active recording, stable live transcript text is typed into the currently focused text field. When the recording stops, Hyprvox still writes the final transcript to clipboard and history.

Add Soniox as a live transcription provider. Soniox provider bypass mode starts a recording through a separate trigger key, streams PCM to Soniox, types stable live transcript text into the focused text field, and copies the final Soniox transcript to the clipboard. It intentionally skips Groq, Deepgram batch transcription, merge, repair, and quality recovery.

## User Stories

1. As a Hyprvox user, I want dictated words to appear in the focused input while I speak, so that I do not have to wait until recording stops to see text.
2. As a Hyprvox user, I want the final transcript copied to the clipboard after live dictation ends, so that my existing paste workflow still works.
3. As a Hyprvox user, I want live text insertion to avoid duplicate partial phrases, so that the focused input remains readable.
4. As a Hyprvox user, I want live insertion to type only stable transcript text, so that unstable interim provider guesses do not corrupt the input.
5. As a Hyprvox user, I want live insertion to use the current focused text field, so that the feature works across editors, browsers, terminals, and chat inputs.
6. As a Hyprvox user on Wayland, I want live insertion to use the available desktop text injection tool, so that the feature works in my normal Hyprland session.
7. As a Hyprvox user on X11, I want a compatible text injection fallback, so that live dictation is not Wayland-only.
8. As a Hyprvox user, I want live insertion failures to fall back to normal clipboard behavior, so that transcription is not lost.
9. As a Hyprvox user, I want normal Groq plus Deepgram transcription to keep working unchanged unless live dictation is enabled, so that quality-critical recordings are not affected.
10. As a Hyprvox user, I want a separate Soniox trigger key, so that I can choose a low-latency live provider without changing the default trigger key behavior.
11. As a Hyprvox user, I want Soniox provider bypass to skip merge and quality recovery, so that the final transcript reflects the live provider directly with low latency.
12. As a Hyprvox user, I want Soniox provider bypass to still write the final transcript to clipboard and history, so that downstream workflows remain consistent.
13. As a Hyprvox user, I want Soniox authentication to be configured through Hyprvox config or environment variables, so that it behaves like the existing provider keys.
14. As a Hyprvox user, I want Soniox provider errors to be reported clearly, so that I can distinguish auth, network, and runtime failures.
15. As a Hyprvox maintainer, I want the live text writer to be tested independently from real desktop input, so that the behavior is stable without disrupting laptop usage.
16. As a Hyprvox maintainer, I want provider bypass tests to exercise observable daemon behavior, so that refactors do not break the user-facing modes.
17. As a Hyprvox maintainer, I want live provider implementations behind a small interface, so that Deepgram and Soniox streaming can share daemon orchestration without coupling to provider-specific SDK details.
18. As a Hyprvox maintainer, I want benchmark thresholds for live insertion and stop latency, so that the feature has measurable quality gates.

## Implementation Decisions

- Keep normal recording semantics intact. The default trigger key continues to run the existing Groq plus Deepgram path unless the user explicitly enables Live Dictation for that path.
- Introduce a Live Dictation output component that accepts transcript events and emits text insertion operations. It tracks committed text and only inserts stable deltas.
- Treat provider interim text as display/input candidates and provider final text as committed text. Stable final chunks are the only text typed by default.
- Use `wtype` as the primary Wayland focused-input writer because it is installed on the target machine and matches the Hyprland environment. Use `xdotool type` as an X11 fallback. Keep `ydotool` as a later fallback because it may require daemon permissions.
- Add configuration for Live Dictation enablement, insertion command selection, and Soniox provider credentials.
- Add a separate Soniox provider bypass trigger key. This mode has its own lifecycle but reuses audio capture, PCM streaming, clipboard output, history, notifications, and daemon state where practical.
- Add a small live provider contract with start, send PCM, stop, and transcript events. Deepgram streaming can be adapted to that contract, and Soniox can implement the same contract.
- Soniox provider bypass uses Soniox real-time STT over WebSocket. Current official docs describe real-time STT as WebSocket-based, with endpoint `wss://stt-rt.soniox.com`; the SDK reference exposes `wss://stt-rt.soniox.com/transcribe-websocket` as the default STT WebSocket URL.
- Provider bypass final text is not sent through the Groq plus Deepgram merge result pipeline. It is copied as the Soniox final transcript and marked as provider bypass in history/metrics.
- Keep GitHub issue publishing out of scope for the first planning artifact. Issues are drafted offline in this repository.

## Testing Decisions

- Tests should verify behavior through public interfaces and shell/system boundaries, not private methods.
- Start with the Live Dictation text accumulator and text writer contract because it is the riskiest user-visible behavior and can be tested without real desktop input.
- Mock only external boundaries: text injection command execution, WebSocket transport, and provider API responses.
- Add focused tests for config parsing so Soniox and Live Dictation settings are validated without starting the daemon.
- Add provider-bypass tests around a fake live provider to prove final transcript copy behavior without hitting Soniox.
- Avoid local tests that open real microphones, real Electron windows, or real desktop notifications by default. Use existing `HYPRVOX_TEST_MODE=1` behavior and targeted unit tests first.

## Benchmarks And Quality Gates

- Live insertion latency: committed provider chunks should be scheduled for focused-input insertion within 100 ms of receipt in unit-level timing tests.
- Duplication guard: repeated partial/final events must not insert duplicate words.
- Stop-to-clipboard latency for provider bypass: no merge or batch provider call may run in the Soniox bypass path.
- Normal path safety: default Groq plus Deepgram recording tests must not observe any Soniox dependency or live insertion side effect when the feature is disabled.
- Desktop safety: automated tests must not type into the real desktop, send real notifications, or require real microphone input.
- Config safety: missing Soniox credentials must fail only when Soniox bypass mode is used or explicitly verified, not when normal transcription runs.

## Out of Scope

- Replacing the Groq plus Deepgram merge result pipeline.
- Streaming unstable interim text with later destructive edits in arbitrary inputs.
- Overlay redesign.
- Publishing PRD or issue drafts to GitHub before user approval.
- Tuning endpointing or merge models for existing providers.
- Supporting every desktop environment’s preferred text injection tool in the first slice.

## Further Notes

- Official Soniox references used for planning: `https://soniox.com/docs/api-reference/stt/websocket-api`, `https://soniox.com/docs/api-reference`, and `https://soniox.com/docs/stt/models`.
- The term `Provider Bypass` is intentionally distinct from `Fallback`: fallback is an error recovery behavior, while provider bypass is a deliberate low-latency mode.
