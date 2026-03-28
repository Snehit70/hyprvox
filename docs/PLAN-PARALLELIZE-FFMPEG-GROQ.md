# Plan: Parallelize ffmpeg Conversion + Groq Upload

**Status:** Proposed  
**Expected impact:** Fixed overhead 1459ms → ~750ms. Median RTF 0.053 → ~0.025–0.030.  
**Baseline targets:** RTF median < 0.030, fixed overhead < 800ms, ms/word median < 14ms

---

## 1. The Problem

In `service.ts:processAudio()`, the current execution order is strictly sequential:

```
[STOP recording]
      │
      ▼
  convertAudio()          ← 743ms fixed cost, blocks everything
      │
      ▼  (convertedBuffer is ready)
  Promise.all([
    groq.transcribe(),    ← needs convertedBuffer  ✓
    deepgramStreaming.stop() ← does NOT need convertedBuffer ✗
  ])
      │
      ▼
  merger.merge()
```

**Deepgram streaming does not need the converted buffer** — it has already been receiving raw PCM during the recording. `deepgramStreaming.stop()` only closes the WebSocket and collects accumulated transcripts. It can run the moment recording stops, in parallel with ffmpeg.

**Groq** needs the converted opus buffer — but only the bytes, not the full conversion to complete first. Groq's SDK constructs a multipart HTTP upload from the File object. By the time Groq's TCP connection is established and headers are sent (~200–300ms), ffmpeg will have produced enough output to begin streaming it.

---

## 2. What can be parallelized

| Operation | Depends on | Can start when |
|-----------|-----------|----------------|
| `deepgramStreaming.stop()` | nothing | recording stops |
| `ffmpeg` spawn + encode | raw audio buffer | recording stops |
| Groq HTTP connection setup | nothing | recording stops |
| Groq upload (bytes) | opus bytes | as ffmpeg produces them (streaming) |
| Groq inference | full file received by Groq | after last opus byte sent |
| `merger.merge()` | both transcripts | after both complete |

The ideal timeline:

```
t=0ms   Recording stops
        │
        ├─► deepgramStreaming.stop()          → completes ~536ms  (currently in parallel ✓)
        │
        ├─► ffmpeg spawn + encode             → starts immediately
        │       │ (streaming output bytes)
        │       ▼
        └─► groq TCP connect + upload stream  → starts immediately
                │ (upload completes ~50ms after ffmpeg finishes)
                ▼
            Groq inference                    → ~400ms
                │
                ▼
            merger.merge()                    → ~376ms
```

**Net critical path after parallelization:**
```
max(ffmpeg_fixed + groq_inference, deepgram_wait) + merge
= max(743 + 400, 536) + 376
= max(1143, 536) + 376
= ~1519ms  (vs current ~1765ms median)
```

But the real win is **for short recordings** where Deepgram finishes before Groq — the entire Deepgram wait disappears from the critical path. And ffmpeg spawn overlaps with Groq TCP handshake, saving ~400ms of fixed overhead.

**Realistic target for short sessions (<15s):** 1100–1300ms total (down from ~1400ms).  
**Realistic target for long sessions (>60s):** 2200–2600ms total (down from ~3100ms).

---

## 3. Implementation approach

### Option A: Stream ffmpeg output into Groq upload (full parallelism)

Instead of collecting ffmpeg output into a Buffer then passing it to Groq, pipe ffmpeg stdout directly into the Groq multipart upload as a stream. This eliminates the sequential dependency entirely.

**Problem:** Groq's SDK (`groq-sdk`) accepts `File | Blob | fs.ReadStream` — not a generic `Readable` stream piped from a child process stdout. The `File` object requires the full buffer upfront.

**Workaround:** Use a `PassThrough` stream — write ffmpeg chunks into it as they arrive, then construct a `Blob`/`ReadableStream` from it for Groq. The Groq SDK can accept a `ReadableStream` via the `toFile()` helper.

**Risk:** Groq's SDK may buffer internally anyway, negating the streaming benefit. Worth testing but complex.

### Option B: Start both concurrently, Groq waits for conversion (minimal change)

Start `deepgramStreaming.stop()` and `convertAudio()` in parallel. Groq only starts after `convertAudio` completes — but Deepgram's wait is now fully overlapped.

```typescript
// Start Deepgram stop immediately (no dep on conversion)
const deepgramPromise = this.deepgramStreaming.stop();

// Start conversion immediately too
const conversionPromise = timeAsync(() => convertAudio(audioBuffer));

// Wait for conversion, then kick off Groq (Deepgram already running)
const conversion = await conversionPromise;
const groqPromise = timeAsync(() => this.groq.transcribe(...));

// Collect both
const [deepgramTimed, groqTimed] = await Promise.all([deepgramPromise, groqPromise]);
```

**This is the recommended approach.** Removes ~500ms fixed Deepgram wait from the critical path. No SDK risk.

**Expected gain:** 
- Deepgram wait (573ms fixed) fully overlaps with ffmpeg (743ms fixed)
- Net fixed overhead: `max(743, 573) + 466` = `743 + 466` = **~1209ms** (down from 1459ms, saving ~250ms)
- Median RTF: ~0.042 (down from 0.053)

### Option C: Option B + pre-warm Groq TCP connection (maximum gain)

During the ffmpeg conversion window (~743ms), open the Groq HTTPS connection speculatively. TCP + TLS handshake takes ~150–300ms. If we start it in parallel with ffmpeg, the connection is ready when the opus buffer is ready.

**This saves the Groq fixed cost (~466ms) minus the connection portion we can overlap:**
- ffmpeg: 743ms
- Groq TCP/TLS (overlapped): ~200ms → wasted waiting 0ms
- Groq upload + inference: ~400ms (variable, not reducible without chunking)

Net fixed overhead with Option C: `743 + 400` = **~1143ms** for the serial parts, vs Deepgram at 573ms → critical path is Groq side. **Saves ~316ms vs Option B**.

**Implementation:** Instantiate the Groq `fetch` call with an empty body as a "preamble", swap in the real body when ffmpeg completes. Complex and SDK-dependent — leave for later milestone.

---

## 4. Recommended implementation: Option B

### 4.1 Changes to `service.ts`

**Current code (`service.ts:727–789`):**

```typescript
// --- Stage: Audio conversion ---
const conversion = await timeAsync(() => convertAudio(audioBuffer));   // SEQUENTIAL
const convertedBuffer = conversion.result;
metrics.conversionMs = conversion.durationMs;
metrics.convertedAudioBytes = convertedBuffer.length;

// --- Stage: Parallel transcription ---
if (this.config.transcription.streaming && this.deepgramStreaming) {
    const [groqTimed, deepgramTimed] = await Promise.all([
        timeAsync(() => this.groq.transcribe(convertedBuffer, ...)),
        timeAsync(() => this.deepgramStreaming!.stop()),               // SERIAL after conversion
    ]);
```

**New code:**

```typescript
// --- Stage: Conversion + Deepgram stop in parallel ---
// Deepgram streaming doesn't need the converted buffer — start stop() immediately
// so its close wait overlaps with ffmpeg encode time.
const deepgramStopPromise = this.config.transcription.streaming && this.deepgramStreaming
    ? timeAsync(() => this.deepgramStreaming!.stop().catch((err) => {
          deepgramErr = err;
          return { text: "", chunkCount: -1, stopReason: "not_connected" as const };
      }))
    : null;

const conversion = await timeAsync(() => convertAudio(audioBuffer));
const convertedBuffer = conversion.result;
metrics.conversionMs = conversion.durationMs;
metrics.convertedAudioBytes = convertedBuffer.length;

// --- Stage: Groq transcription (Deepgram already in flight) ---
if (deepgramStopPromise) {
    const [groqTimed, deepgramTimed] = await Promise.all([
        timeAsync(() =>
            this.groq.transcribe(convertedBuffer, language, boostWords)
                .catch((err) => { groqErr = err; return ""; })
        ),
        deepgramStopPromise,   // already started, may already be done
    ]);
    metrics.groqMs = groqTimed.durationMs;
    metrics.deepgramMs = deepgramTimed.durationMs;
    groqText = groqTimed.result;
    const streamingResult = deepgramTimed.result;
    deepgramText = streamingResult.text;
    streamingChunkCount = streamingResult.chunkCount;
    metrics.deepgramStopReason = streamingResult.stopReason;
} else {
    // batch mode: unchanged
    const [groqTimed, deepgramTimed] = await Promise.all([...]);
    ...
}
```

### 4.2 Metrics impact

The `deepgramMs` field in the perf log will now reflect only the **remaining** Deepgram wait after ffmpeg completes (i.e., `max(0, deepgram_wall_time - ffmpeg_wall_time)`). This is expected and correct — it represents the actual delay Deepgram adds to the critical path, which is what matters.

Add a new metric field `deepgramStartedEarlyMs: true/false` to track when the optimization is active. This makes the perf log self-describing.

### 4.3 Error handling — no changes needed

The existing error handling in both branches is preserved. `deepgramStopPromise` already `.catch()`es internally the same way the current code does. If Deepgram fails mid-stop, the behavior is identical to today.

### 4.4 Metrics to add to `TranscriptionMetrics`

```typescript
interface TranscriptionMetrics {
    // ... existing fields ...
    deepgramStartedEarlyMs: boolean;  // true = deepgram stop overlapped with ffmpeg
    conversionOverlapMs: number;      // how much Deepgram wait was hidden by ffmpeg
}
```

Compute `conversionOverlapMs = min(conversion.durationMs, deepgramWallClockMs)` where `deepgramWallClockMs` is measured from the moment we kick off `deepgramStopPromise` to when it resolves.

---

## 5. Testing plan

### 5a. Unit tests
- No changes to `converter.ts` or `groq.ts` — no new unit tests needed
- The parallelization change is in `service.ts` orchestration logic only

### 5b. Integration test
Add a timing integration test that:
1. Mocks `convertAudio` with a 500ms delay
2. Mocks `deepgramStreaming.stop()` with a 400ms delay
3. Asserts that total processing time is `~500ms` (max of the two), not `~900ms` (sum)

### 5c. Real-world validation
After deployment, compare perf logs:
- `deepgramMs` should drop toward 0 for most sessions (it completes during ffmpeg)
- `conversionMs` unchanged (ffmpeg is the same)
- `totalMs` median should drop by ~250–400ms
- RTF median should drop from 0.053 → < 0.035

---

## 6. Follow-on: Option C (pre-warm Groq connection)

After Option B is validated and RTF is measured:

1. Investigate whether `groq-sdk` exposes connection-level control (keep-alive, pre-connect)
2. If not, consider switching Groq upload to raw `fetch()` with `ReadableStream` body, letting us:
   - Open TCP connection at recording-stop time
   - Start piping ffmpeg stdout into the request body as bytes are produced
   - Groq server begins receiving audio while ffmpeg is still encoding
3. Expected additional savings: ~250–350ms on top of Option B

This is a larger SDK-level change and should be done as a separate PR after Option B is confirmed to work correctly.

---

## 7. Future: merge gating expansion (separate track)

While Option B/C address fixed overhead, the other lever is **merge gating skip rate**:

- **Current:** 23% of sessions skip LLM merge (deterministic path, ~1ms vs ~569ms)
- **Target:** 40%+
- **How:** Lower `diff_below_threshold` char count; add a normalized similarity score gate for short transcripts

This is orthogonal to the parallelization work and can be done in parallel by a different developer.

---

## 8. Summary

| Milestone | Change | Expected RTF median | Expected fixed overhead |
|-----------|--------|--------------------|-----------------------|
| Baseline (now) | — | 0.053 | 1459ms |
| **Option B** | Deepgram stop overlaps ffmpeg | ~0.035–0.042 | ~1100–1200ms |
| Option C | Groq TCP pre-warm | ~0.025–0.030 | ~850–950ms |
| Merge gating 40% | More deterministic merges | unchanged RTF | −140ms avg merge |
| All combined | — | **< 0.025** | **< 800ms** |

Option B is a ~30-line change in `service.ts`. It has zero risk to correctness, no new dependencies, and is fully reversible. It should be the next PR.
