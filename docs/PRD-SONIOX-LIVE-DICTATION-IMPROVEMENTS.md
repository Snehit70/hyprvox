# Soniox Live Dictation Improvements PRD

## Problem Statement

The Soniox live dictation feature works end-to-end (Right Alt → WebSocket → text typing → clipboard), but the output quality is poor. Tokens are concatenated without spaces (`currentimplementation`), there are no paragraph breaks (everything is a wall of text), and no observability exists beyond `textLength`. The user cannot tell which words were recognized correctly, cannot read structured output, and has no way to debug tokenization issues.

## Solution

Fix token spacing, add pause-based paragraph breaks during live typing, add a minimal LLM formatting pass after stop (paragraph breaks only, no rewriting), add per-token debug logging, and add structured performance entries for statistical analysis. All new behavior is gated behind config options with safe defaults.

## User Stories

1. As a Hyprvox user, I want Soniox tokens to have proper word spacing, so that the typed text is readable.
2. As a Hyprvox user, I want paragraph breaks to appear during live typing when I pause between topics, so that the typed text is structured.
3. As a Hyprvox user, I want the LLM-formatted text to replace what was typed after recording stops, so that the final output has proper paragraph breaks.
4. As a Hyprvox user, I want a config option to disable the retype behavior, so that I can use live dictation in contexts where retyping is risky (e.g., code editors with unsaved work).
5. As a Hyprvox user, I want per-token debug logging when I set `LOG_LEVEL=debug`, so that I can diagnose tokenization and spacing issues.
6. As a Hyprvox user, I want structured performance entries for Soniox sessions, so that I can track latency and token throughput over time.
7. As a Hyprvox user, I want the paragraph pause threshold to be configurable, so that I can tune it for my speaking pace.
8. As a Hyprvox user, I want the LLM formatting to only add paragraph breaks (no filler removal, no punctuation fixes, no rewriting), so that the output reflects what I actually said.
9. As a Hyprvox maintainer, I want the LLM formatting to reuse the existing Groq/Llama infrastructure, so that no new API keys or dependencies are needed.
10. As a Hyprvox maintainer, I want the retype mechanism to use Home + Shift+End (not Ctrl+A), so that it doesn't overwrite content outside the dictated text in code editors.
11. As a Hyprvox maintainer, I want the paragraph break logic to be based on message-level timing gaps (not per-token timestamps), so that it works with Soniox's current token delivery model.
12. As a Hyprvox maintainer, I want the `retypeFormatted` config option to default to `true`, so that most users get the formatted output without configuration.
13. As a Hyprvox maintainer, I want the `paragraphPauseMs` config option to live inside `liveDictation.soniox`, so that it's clearly scoped to Soniox live dictation.
14. As a Hyprvox maintainer, I want the LLM formatting pass to run asynchronously after the clipboard/history write, so that it doesn't block the user from continuing to work.
15. As a Hyprvox maintainer, I want the retype mechanism to be a no-op if the focused window content has changed since dictation started, so that manual edits are not overwritten.

## Implementation Decisions

### Token Spacing

Change `renderFinalTokenText` in `soniox-streaming.ts` to join tokens with a space instead of empty string, then collapse double spaces. This handles tokens that already include leading/trailing spaces (which Soniox produces) and tokens that don't (which currently run together).

### Paragraph Break Insertion

During live typing, track the time between consecutive `handleMessage` calls. If the gap exceeds `paragraphPauseMs` (default: 3000ms), insert a paragraph break before the delta. The break is typed as a double space (not `\n\n`) to avoid breaking single-line inputs.

After the LLM formatting pass, the clipboard/history version gets proper `\n\n` paragraph breaks.

### LLM Formatting Pass

After `sonioxStreaming.stop()` returns the raw text, send it to Groq/Llama 3.3 with a minimal prompt:

```
Add paragraph breaks to this transcript at natural sentence boundaries.
Do not change any words, punctuation, or formatting.
Only insert blank lines between paragraphs where the topic changes.
Return the formatted text only, no explanations.
```

The formatted text replaces the raw text for clipboard and history writes. If `retypeFormatted` is true, it also replaces what was typed in the focused window.

### Retype Mechanism

When `retypeFormatted` is true, after the LLM formats the text:
1. Send `Home` to move cursor to start of line
2. Send `Shift+End` to select the entire line (our typed text)
3. Send the formatted text to replace the selection

This avoids `Ctrl+A` which would select all content in the focused window (risky in code editors).

### Config Schema Changes

Add to `liveDictation.soniox`:
- `paragraphPauseMs`: number, default 3000, minimum 1000. Milliseconds of silence between token messages before inserting a paragraph break.

Add to `liveDictation`:
- `retypeFormatted`: boolean, default true. When true, the LLM-formatted text replaces what was typed after recording stops.

### Logging

- Per-token debug logging: log each token's `text` and `is_final` flag at `debug` level in `handleMessage`.
- Structured perf entry: emit `type: "perf"` with `engine: "soniox"`, `textLength`, `recordingDurationMs`, `processingMs`, `tokenCount`, `paragraphBreaksInserted`, `llmFormattingMs`.

## Testing Decisions

- Test `renderFinalTokenText` spacing with tokens that include/exclude leading/trailing spaces.
- Test paragraph break insertion with mock `handleMessage` calls at various time intervals.
- Test LLM formatting pass with mock Groq responses.
- Test retype mechanism with mock `DesktopTextTyper` that records calls.
- Test config schema validation for new fields.
- Test that `retypeFormatted: false` skips the retype step.
- Test that `paragraphPauseMs` below minimum is clamped.
- Avoid real desktop typing, real microphone input, or real API calls in unit tests.

## Out of Scope

- Interim token preview (showing partial words before they commit).
- Self-correction backspacing (detecting and undoing mistakes).
- Filler word removal ("um", "uh", "like").
- Punctuation fixing or grammar correction.
- Sentence restructuring or rewriting.
- Per-token confidence scoring (Soniox doesn't expose this in the current interface).
- Overlay changes for Soniox sessions.
- Deepgram streaming paragraph breaks (has its own `speech_final` mechanism).

## Implementation Status

| Item | Status |
|------|--------|
| Token spacing (join with space, collapse doubles) | Done |
| Per-token debug logging | Done |
| Structured perf entries | Done |
| `paragraphPauseMs` config schema | Done |
| Paragraph break insertion (double-space prefix) | Done |
| LLM formatting pass (Groq/Llama 3.3) | Done |
| `retypeFormatted` config + Home+Shift+End retype | Done |
| Tests (9 Soniox-specific, 245 total) | Done |
| Documentation updates | Done |

## Implementation Status

| Item | Status |
|------|--------|
| Token spacing (join with space, collapse doubles) | Done |
| Per-token debug logging | Done |
| Structured perf entries | Done |
| `paragraphPauseMs` config schema | Done |
| Paragraph break insertion (double-space prefix) | Done |
| LLM formatting pass (Groq/Llama 3.3) | Done |
| `retypeFormatted` config + Home+Shift+End retype | Done |
| Tests (9 Soniox-specific, 245 total) | Done |
| Documentation updates | Done |

## Implementation Status

| Item | Status |
|------|--------|
| Token spacing (join with space, collapse doubles) | Done |
| Per-token debug logging | Done |
| Structured perf entries | Done |
| `paragraphPauseMs` config schema | Done |
| Paragraph break insertion (double-space prefix) | Done |
| LLM formatting pass (Groq/Llama 3.3) | Done |
| `retypeFormatted` config + Home+Shift+End retype | Done |
| Tests (9 Soniox-specific, 245 total) | Done |
| Documentation updates | Done |

## Implementation Status

| Item | Status |
|------|--------|
| Token spacing (join with space, collapse doubles) | Done |
| Per-token debug logging | Done |
| Structured perf entries | Done |
| `paragraphPauseMs` config schema | Done |
| Paragraph break insertion (double-space prefix) | Done |
| LLM formatting pass (Groq/Llama 3.3) | Done |
| `retypeFormatted` config + Home+Shift+End retype | Done |
| Tests (9 Soniox-specific, 245 total) | Done |
| Documentation updates | Done |

## Implementation Status

| Item | Status |
|------|--------|
| Token spacing (join with space, collapse doubles) | Done |
| Per-token debug logging | Done |
| Structured perf entries | Done |
| `paragraphPauseMs` config schema | Done |
| Paragraph break insertion (double-space prefix) | Done |
| LLM formatting pass (Groq/Llama 3.3) | Done |
| `retypeFormatted` config + Home+Shift+End retype | Done |
| Tests (9 Soniox-specific, 245 total) | Done |
| Documentation updates | Done |

## Further Notes

- This PRD builds on the existing `PRD-LIVE-DICTATION-SONIOX.md` which defined the core Soniox provider bypass feature.
- The LLM formatting pass is deliberately minimal — it adds paragraph breaks only, preserving the speaker's exact words and punctuation.
- The `retypeFormatted` default is `true` because most users expect the final output to be formatted. Users who need the raw text can set it to `false`.
- The paragraph pause threshold of 3000ms is a starting point — it should be tuned based on real usage data.
