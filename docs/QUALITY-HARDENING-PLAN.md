# Transcript Quality Hardening Plan

Source: manual review in `docs/QUALITY-MANUAL-REVIEW-2026-05-13-to-2026-05-19.md`.

## Overall Quality

- 211 transcripts reviewed manually.
- 154 clean, 29 minor issues, 24 major issues, 4 severe issues.
- Routine dictation is mostly reliable; failures are concentrated in merge/repair leakage and weak-source edge cases.

## Failure Modes

1. CoT/meta leakage
   - Risk: unsafe non-speech text reaches clipboard/history.
   - Cause: LLM merge/repair output passed validation when it contained reasoning scaffolds.
   - Action: hard-block reasoning/meta markers in `validateTranscript()`.
2. Injected file/command token tails
   - Risk: otherwise valid dictation gets polluted by unrelated filenames or command-like garbage.
   - Cause: model over-completion or prompt/context carry-over under weak/ambiguous sources.
   - Action: add a conservative orphan technical-token burst guard, then refine with source grounding.
3. Prompt artifacts
   - Risk: merge/repair instructions leak into transcript text.
   - Cause: model boundary failure between instructions and source transcript data.
   - Action: keep expanding prompt-artifact validators and strengthen repair prompt.
4. Weak-source drift/truncation
   - Risk: aggressive merge/repair turns clipped speech into misleading text.
   - Cause: short or contradictory source pairs give the LLM too much room.
   - Action: prefer clean source fallback or no-speech when sources are tiny/contradictory.

## Execution Order

1. P0: Add final-gate CoT/meta blocker and regression tests.
2. P0/P1: Add conservative injected filename/command burst blocker and regression tests.
3. P1: Tighten repair prompt and post-repair validation tests.
4. P1: Add source-grounding checks for unsupported technical-token additions.
5. P1: Add weak-source fallback/no-speech policy.

## Current Pass

- Implement items 1 and the conservative part of item 2 in `src/transcribe/quality.ts`.
- Add focused tests in `tests/transcript-quality.test.ts` and `tests/transcript-recovery.test.ts`.
