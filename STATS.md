# Hyprvox Performance Stats

## Log Analysis Period

| Field | Value |
|-------|-------|
| **From** | 2026-02-10 |
| **To** | 2026-02-20 |
| **Log Location** | `~/.config/hypr/vox/logs/` |
| **Commit** | `78230be` |
| **Last Updated** | 2026-03-02 |

---

## Noise Definition (Cleaning Criteria)

Samples removed if:
1. `deepgramTextLength == 0` — Deepgram streaming failed
2. `textLength < 10` — Near-empty output

For WPM calculation, also exclude:
3. `duration < 10000` — Too short for reliable WPM (< 10 sec)

| Metric | Value |
|--------|-------|
| Total Raw Samples | 231 |
| Noise Removed | 18 |
| Noise Rate | 7.8% |
| **Clean Samples** | **213** |

---

## Processing Latency (Clean)

| Percentile | Latency |
|------------|---------|
| **Average** | **1,030 ms** |
| **p50 (Median)** | **882 ms** |
| p67 | 1,095 ms |
| p95 | 2,299 ms |
| p99 | 2,709 ms |
| Min | 447 ms |
| Max | 3,443 ms |

---

## Real-Time Performance

| Metric | Value |
|--------|-------|
| **Real-Time Factor** | **39.4x faster** |
| Avg Recording | 40 sec |
| Avg Processing | ~1 sec |
| Total Audio Processed | 2.4 hours |

*39x means 60 sec of audio is transcribed in ~1.5 sec*

---

## Speaking WPM (Clean: Groq raw, ≥30s recordings)

| Percentile | WPM |
|------------|-----|
| **Overall** | **158** |
| **p50 (Median)** | **161** |
| p67 | 170 |
| p95 | 201 |
| Min | 50 |
| Max | 222 |

### LLM Merge Word Reduction

| Metric | Value |
|--------|-------|
| Raw Words (Groq) | 19,522 |
| Final Words (after LLM cleanup) | 17,129 |
| **Filler Words Removed** | **2,393 (12.3%)** |

---

## Engine Distribution

| Engine | Count | % |
|--------|-------|---|
| Dual-Engine (Groq + Deepgram + LLM) | 216 | 93.5% |
| Groq-Only Fallback | 15 | 6.5% |

---

## Models Used

| Component | Model |
|-----------|-------|
| Groq (STT) | `whisper-large-v3` |
| Deepgram (STT) | `nova-3` (streaming) |
| LLM Merge | `llama-3.3-70b-versatile` |

---

## LLM Merge Latency

| Percentile | Latency |
|------------|---------|
| Average | 281 ms |
| p50 | 287 ms |
| p95 | 556 ms |
| Total Merges | 36 |

---

## Deepgram STT Confidence (Batch Mode Benchmark)

| Format | Confidence |
|--------|------------|
| WAV | 99.06% |
| Opus | 99.08% |
| MP3 | 99.12% |

*Note: This is Deepgram's internal confidence score from batch mode benchmarks, not per-transcription streaming data.*

---

## Notes

- **"Source Agreement"** (logged as `accuracy.confidence`) measures how similar Groq and Deepgram outputs are, NOT transcription accuracy. Low agreement can still produce excellent merged output.
- **WPM uses Groq raw text** because LLM merge removes 12% filler words, which would artificially lower WPM.
- **Short recordings (<10s)** excluded from WPM as they have high start/stop overhead.

---

## Regenerate Stats

To regenerate these stats from fresh logs:

```bash
# Clean samples count
cat ~/.config/hypr/vox/logs/*.log | grep '"msg":"Transcription complete"' | \
  jq -s '[.[] | select(.deepgramTextLength > 0 and .textLength >= 10)] | length'

# Processing latency percentiles
cat ~/.config/hypr/vox/logs/*.log | grep '"msg":"Transcription complete"' | \
  jq -s '[.[] | select(.deepgramTextLength > 0 and .textLength >= 10)] | 
  {
    avg: ([.[].processingTime] | add / length | round),
    p50: (([.[].processingTime] | sort) as $s | $s[(($s | length) / 2) | floor]),
    p95: (([.[].processingTime] | sort) as $s | $s[(($s | length) * 0.95) | floor])
  }'

# WPM (Groq raw, ≥30s)
cat ~/.config/hypr/vox/logs/*.log | grep '"msg":"Transcription complete"' | \
  jq -s '[.[] | select(.deepgramTextLength > 0 and .textLength >= 10 and .duration >= 30000)] |
  {
    overall_wpm: ((([.[] | ((.groqTextLength / 5) | floor)] | add) / ([.[].duration] | add / 1000 / 60)) | round),
    p50_wpm: (([.[] | (((.groqTextLength / 5) | floor) / (.duration / 1000 / 60))] | sort) as $s | $s[(($s | length) / 2) | floor] | round)
  }'
```
