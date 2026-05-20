# Hyprvox Manual Model Evaluation (Human Review)

Window:

- Source replay window: `2026-05-15` to `2026-05-19` UTC
- Cases reviewed: `1-130` (130 cases)
- Cases excluded: `131-143` (13 cases) because `llama-3.3-70b-versatile` regeneration repeatedly hit Groq TPD rate limits

Models compared:

- `qwen/qwen3-32b`
- `llama-3.3-70b-versatile`
- `openai/gpt-oss-120b`

Method:

- Case-by-case manual reading of model outputs from replay report:
  - `docs/MODEL-EVAL-2026-05-15-to-2026-05-19.md`
- Human rubric (priority order):
  1. Safety/cleanliness (no CoT leakage, no meta artifacts)
  2. Faithfulness to spoken content and ordering
  3. Technical fidelity (terms/filenames/commands)
  4. Formatting fidelity (no over-rewrite)
  5. Latency as tie-breaker only

## Consolidated Manual Tally

Per-range reviewer tallies:

- Cases `1-33`: llama `20`, openai `11`, qwen `2`
- Cases `34-66`: llama `22`, openai `11`, qwen `0`
- Cases `67-98`: llama `18`, openai `11`, qwen `2`
- Cases `99-130`: llama `17`, openai `12`, qwen `3`

Total across 130 cases:

- **llama-3.3-70b-versatile: 77 wins**
- **openai/gpt-oss-120b: 45 wins**
- **qwen/qwen3-32b: 7 wins**

## Safety Findings

- `qwen/qwen3-32b` repeatedly emitted chain-of-thought/meta leakage (`<think>` and reasoning scaffolding), causing frequent disqualification under rubric priority #1.
- `openai/gpt-oss-120b` was often clean but more likely than llama to append unrelated prior-case content in several ranges.
- `llama-3.3-70b-versatile` had the best overall balance of cleanliness + faithfulness.

## Cases Where All Models Were Poor

- `19, 22, 29, 43, 47, 48, 84, 85, 116, 117`

These should be treated as hard replay edge cases (weak/noisy source pair quality, cross-case contamination sensitivity, or incompleteness).

## Excluded Cases

- Excluded from ranking: `131-143`
- Reason: all llama retries failed due Groq TPD rate limiting during regeneration attempts.
- As directed, these were not included in final model ranking.

## Recommendation

Primary recommendation:

- Keep/choose **`llama-3.3-70b-versatile`** as default merge model.

Why:

- Highest manual win count (`77/130`)
- Best safety cleanliness among available outputs in this review
- Stronger faithfulness consistency than `openai/gpt-oss-120b` in aggregate
- `qwen/qwen3-32b` currently fails safety expectations due CoT/meta leakage behavior in replay

## Follow-up Actions

1. Add strict post-merge guard to reject CoT/meta leakage patterns even if model output appears otherwise coherent.
2. Keep manual spot-audit workflow for future model tests, with script metrics as secondary evidence only.
3. Re-run excluded cases (`131-143`) after rate-limit window resets, then append addendum if ranking changes.
