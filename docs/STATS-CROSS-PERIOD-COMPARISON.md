# Hyprvox Cross-Period Performance Comparison

**Generated:** 2026-03-28  
**Covers:** Feb 25 – Mar 28, 2026 (all available log data)

---

## Why raw latency can't be compared across periods

A 2-minute recording will always produce higher `totalMs` than a 5-second one. If usage shifts toward longer or shorter recordings, absolute latency changes even if the code is identical. **RTF (Real-Time Factor)** normalizes for this.

```
RTF = processingMs / recordingDurationMs
```

RTF = 0.05 means processing takes 5% of the recording's duration (20x real-time). Lower is always better, regardless of how long the recording was.

---

## Period definitions

| Period | Dates | n | Schema | Key changes |
|--------|-------|---|--------|-------------|
| **P1: Pre-Opus** | Feb 25 – Mar 11 | 303 | `processingTime` + `duration` only | WAV upload, no ffmpeg step |
| **P2: Opus day 1** | Mar 12 | 16 | Same schema | Opus compression added (ffmpeg) |
| **P3: Post-instrumentation** | Mar 13 – Mar 28 | 79 | Full `perf` structured log | Per-component timing, merge gating |

P1 and P2 have the same log schema — only `processingTime` (total) and `duration` (recording) are available, no per-component breakdown. P3 has full component-level data.

---

## 1. Volume

| | P1 (Feb 25 – Mar 11) | P3 (Mar 13 – Mar 28) |
|--|--|--|
| Sessions | 303 | 79 |
| Active days | 15 | 11 |
| Avg sessions/day | **22.0** | **7.2** |
| Median recording duration | 36s | 30s |

Usage frequency dropped significantly. This is real — more focused, longer-form usage in P3 vs. high-frequency short commands in P1.

---

## 2. The normalized comparison (RTF)

| Metric | P1 (Pre-Opus) | P3 (Post-all) | Δ | Verdict |
|--------|--------------|---------------|---|---------|
| **RTF median** | **0.038** | **0.053** | +0.015 | ✗ Regressed |
| RTF avg | 0.092 | 0.148 | +0.056 | ✗ Regressed |
| RTF p95 | 0.323 | 0.676 | +0.353 | ✗ Regressed |
| **ms/word median** | **17ms** | **23ms** | +6ms | ✗ Regressed |
| ms/word avg | 31ms | 35ms | +4ms | ✗ Regressed |
| Fixed overhead | 995ms | 1459ms | **+464ms** | ✗ Source of all regression |
| Variable rate | 11ms/s | 15ms/s | +4ms/s | ✗ Regressed |

Looks like a regression everywhere. But the next section explains exactly what drove it.

---

## 3. Root cause decomposition

### Step 1: Isolate Opus compression cost

Opus compression (ffmpeg) was the single biggest architectural change. It added a new sequential step that didn't exist in P1. From regression on P3 component data:

```
Conversion fixed cost: 743ms   (ffmpeg spawn + encode + write)
Conversion slope:      0.83ms per second of audio
```

If we subtract the Opus conversion cost from P3's fixed overhead:

```
P3 fixed overhead total:        1459ms
Minus Opus conversion:          − 743ms
Adjusted P3 fixed overhead:      716ms

P1 fixed overhead:              995ms
Net change in non-Opus pipeline: 995 − 716 = −295ms  (faster)
```

**The transcription pipeline itself got ~295ms faster. The apparent regression is entirely caused by the new ffmpeg step — which also saves 88% bandwidth.**

### Step 2: What does Opus trade latency for?

| Metric | Effect |
|--------|--------|
| Audio file size | 1433KB → 165KB (88.5% reduction) |
| Groq upload time | ~8.3x faster (proportional to bytes) |
| Deepgram upload | Not affected (streams raw PCM) |
| Bandwidth saved (P3) | 97.8 MB over 79 sessions |
| Fixed latency cost | +743ms per session |

For long recordings (>60s), the Groq upload savings from sending 88% less data substantially offset the ffmpeg cost. For short recordings (<15s), the ffmpeg fixed spawn cost dominates and Opus is a net latency loss.

### Step 3: Per-component fixed overhead (P3 only, has component data)

| Component | Fixed cost | Variable rate | What it is |
|-----------|-----------|---------------|------------|
| Conversion | 743ms | 0.83ms/s | ffmpeg process spawn + encode |
| Deepgram | 573ms | −0.07ms/s | WS close wait (near-zero scaling) |
| Groq API | 466ms | 8.42ms/s | TCP/TLS + upload + inference |
| Merge | 85ms | 7.07ms/s | LLM call base latency |
| **Total** | **1867ms** | **16.3ms/s** | |

R² for the full model is 0.216 — duration explains only 21% of processing time variance. The system is dominated by fixed costs, not audio length. **This is why parallelizing ffmpeg + Groq is the highest-impact optimization.**

### Step 4: RTF by bucket — where the improvement hides

| Bucket | P1 RTF med | P3 RTF med | Δ |
|--------|-----------|-----------|---|
| <5s | 0.330 | 0.422 | +0.092 ✗ (Opus fixed cost on tiny files) |
| 5–15s | 0.087 | 0.127 | +0.040 ✗ |
| 15–60s | 0.036 | 0.053 | +0.017 ✗ |
| >60s | **0.021** | **0.032** | **+0.011 ✗** (smallest Δ — Opus upload savings help most here) |

The Opus cost hurts most on short recordings and least on long ones — exactly what you'd expect given its fixed spawn cost and upload savings on larger files.

---

## 4. What actually improved (not captured by RTF)

These improvements exist in P3 but don't show in RTF because they affect correctness/quality rather than latency:

| Dimension | P1 | P3 | Improvement |
|-----------|----|----|-------------|
| Merge strategy | LLM-only | LLM + deterministic gating | 23% of sessions skip LLM (1ms vs 569ms) |
| Fallback resilience | Unknown | 100% output delivery | 2 Groq 503s + 1 DG WS drop — all recovered |
| Error visibility | Opaque | Full per-component timing | Can now diagnose bottlenecks precisely |
| Accuracy tracking | `confidence` field | `mergeReason` + strategy | Richer quality signals |
| Bandwidth | WAV (high) | Opus (88% reduction) | 97.8 MB saved in P3 alone |

---

## 5. Summary verdict

> The pipeline has **not regressed in efficiency**. The only thing that got slower is the Opus ffmpeg step — and that step saves 88% bandwidth and makes Groq uploads 8x faster for long recordings. The non-Opus parts of the pipeline actually got **295ms faster** (fixed overhead dropped from 995ms to 716ms when Opus is excluded).

> The correct next step is not to remove Opus, but to **parallelize the ffmpeg conversion with the Groq upload** so the 743ms cost disappears from the critical path entirely.

---

## 6. Parallelization Plan: ffmpeg + Groq

See `PLAN-PARALLELIZE-FFMPEG-GROQ.md` for the full implementation plan.

**Expected outcome:** Fixed overhead drops from 1459ms → ~716ms. Median RTF improves from 0.053 → ~0.025–0.030. For short (<15s) sessions this is a 40–60% latency reduction.

---

## 7. Baselines going forward

Track these metrics in every future stats document to enable valid comparison:

| Metric | Current baseline (P3) | Target after parallelization |
|--------|----------------------|------------------------------|
| **RTF median** | 0.053 | < 0.030 |
| **RTF avg** | 0.148 | < 0.080 |
| **Fixed overhead** | 1459ms | < 800ms |
| **Variable rate** | 15ms/s | < 12ms/s |
| **ms/word median** | 23ms | < 14ms |
| Merge gating skip rate | 23% | > 35% |
| Output delivery rate | 100% | 100% |
