# Hyprvox Quality Fixes: 2026-05-14

**Context:** PR1 quality work after the May 4-May 14 transcript review.  
**Primary source:** `docs/ANALYSIS-2026-05-04-to-2026-05-14.md`

---

## Summary

This change adds a validation and recovery layer after transcript merge. The goal is to prevent known bad artifacts from reaching clipboard/history while preserving valid speech through retry, trimming, or fallback.

The main issues addressed are:

- `Preserve the following...` prompt/instruction artifacts.
- Detachable outro hallucinations like `Thank you for watching.`
- Mixed-script garbage in English transcripts.
- User-visible failures when a merged output is bad but a clean source transcript is available.

---

## What Changed

### Central Transcript Validator

Added `src/transcribe/quality.ts` with reusable validation functions:

- `validateTranscript(text)`
- `trimHallucinationSuffix(text)`

Validation returns structured reasons instead of a plain boolean.

Current reason types:

- `prompt_artifact`
- `hallucination_suffix`
- `mixed_script`
- `garbage`

### Prompt / Instruction Artifact Detection

The validator now catches artifact families such as:

```text
Preserve the following terms in the following order.
Preserve the following commands for the app.
Preserve the following questions.
```

These were found in 15 saved transcripts during the May 4-May 14 review.

### Hallucination Suffix Trimming

The validator trims detachable suffixes when they appear at the end of otherwise useful text:

```text
Thank you for watching.
Thanks for watching.
Please visit the link in the description.
```

Suffix trimming is treated as recoverable. The transcript can still be saved after the suffix is removed.

### Mixed-Script Detection

English-mode transcripts are flagged when they contain scripts such as Arabic, Thai, Hangul, Japanese, or CJK characters. This targets rare garbage fragments found in the review corpus.

### Merge Retry

If merged output fails validation and both Groq and Deepgram source texts exist, the daemon asks the merge model to repair the output once using a stricter repair prompt.

Successful repair uses:

- `mergeStrategy = "llm_retry_cleaned"`
- `mergeReason = "llm_retry_succeeded"`

### Source Fallback

If merge repair still fails, the daemon tries source fallback:

1. Use clean Deepgram text if valid.
2. Otherwise use clean Groq text if valid.
3. Otherwise fail the transcript.

This prevents user-visible failures when one clean source transcript is available.

### Metrics

Performance logs now include validation observability:

- `validationReasons`
- `validationRetryCount`
- `validationFallbackSource`
- `trimmedHallucinationSuffix`

Groq source transcript logging is also enabled so future model comparisons can replay exact Groq + Deepgram source pairs.

---

## Tests

Added regression tests for:

- `Preserve the following...` artifact detection.
- Ordinary valid use of the word `preserve`.
- Hallucination suffix trimming.
- Mixed-script detection.
- New merge strategy/reason types.

---

## Expected Impact

Expected improvements:

- Saved `Preserve the following...` artifacts should drop to 0.
- Outro hallucination suffixes should be trimmed instead of saved.
- Mixed-script garbage should be blocked or recovered through fallback.
- Prompt/artifact failures should recover when a clean source exists.

This does not fully solve technical term corruption or formatting drift. Those remain later work.
