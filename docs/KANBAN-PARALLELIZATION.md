# Hyprvox Parallelization - Architecture Kanban

All numbers from real log data (Mar 13-28, n=79 sessions).
Model accuracy: 1720ms modeled vs 1741ms actual median.

---

## The correction

The earlier parallelization plan overstated the impact of moving Deepgram stop
earlier.

Current critical path:

```text
ffmpeg (serial) -> Promise.all([groq, deepgram.stop()]) -> merge
```

That means Groq and Deepgram are already parallel with each other. The only
strictly serial step today is ffmpeg conversion.

Moving `deepgramStreaming.stop()` to start before ffmpeg helps only when
Deepgram is the slower side of the current `Promise.all(...)`.

From the data:

- `deepgramMs > groqMs`: 32/79 sessions (41%)
- `groqMs >= deepgramMs`: 47/79 sessions (59%)
- average saving across all sessions if we start Deepgram early: about 75ms
- median saving: 0ms

So this is still a good optimization, but it is a targeted short-session win,
not a universal latency reset.

---

## What the current architecture actually does

During recording:

- recorder captures raw PCM into a local buffer
- Deepgram streaming already receives PCM over WebSocket
- Deepgram is doing transcription work while the user is still speaking

After recording stops:

```text
1. convertAudio(audioBuffer)          // ffmpeg
2. Promise.all([
     groq.transcribe(convertedBuffer),
     deepgramStreaming.stop()
   ])
3. merger.merge()
```

Important implication:

- `deepgramStreaming.stop()` is mostly teardown and finalization wait
- it does not depend on `convertedBuffer`
- Groq does depend on `convertedBuffer`

That dependency shape is what makes Option A safe and cheap.

---

## What actually controls latency

By duration bucket:

- `<5s` sessions (19% of usage): fixed overhead dominates, especially Deepgram
  stop and ffmpeg
- `5-15s` sessions (6%): near the tipping point between Deepgram-bound and
  Groq-bound
- `15-60s` sessions (46%): Groq usually dominates
- `>60s` sessions (29%): Groq clearly dominates

From the stats docs:

- conversion fixed cost: about 743ms
- Deepgram stop fixed cost: about 573ms
- Groq warm fixed cost: about 466ms
- merge fixed cost: about 85-124ms depending on model fit

For long sessions, the architectural ceiling is still Groq inference time.
For short sessions, the user mostly feels fixed overhead.

---

## Hidden finding: Groq keep-alive already works

Observed behavior:

- first Groq call after daemon start: about 1329ms average
- later Groq calls in same daemon process: about 761ms average

This strongly suggests the SDK is already reusing warm HTTP connections.

Implication:

- "add keep-alive" is not a real optimization target for warm sessions
- the remaining Groq fixed cost is mostly request setup, auth, SDK overhead, and
  response handling

So we should not spend roadmap space on keep-alive unless new evidence appears.

---

## Why the old backlog needed to change

The previous kanban mixed together three different things:

1. How much a change saves when it hits
2. How often it hits in real sessions
3. How much correctness risk it introduces

That made safe changes and risky changes look closer than they really are.
It also linearly added wins that are not additive.

Example:

- Option A and Option B both reduce the Deepgram tail
- if Option A already removes Deepgram from the critical path for a session,
  Option B adds little or nothing for that same session
- merge gating savings also apply only when a session still reaches the LLM path

So "A + B + D = total average saving" is not trustworthy without a combined
model.

---

## Backlog ranked by ROI and confidence

| Item | Change | Avg win | Hit rate | Confidence | Risk |
|------|--------|---------|----------|------------|------|
| A | Start `deepgramStreaming.stop()` before ffmpeg finishes | ~75ms/session | 41% | High | Low |
| D | Expand deterministic merge gating | ~50-100ms/session if skip rate reaches 35-40% | All sessions | Medium | Low |
| B | Reduce Deepgram finalize wait `300ms -> 100ms` | ~46ms/session | ~30% | Medium | Medium |
| E | Tune endpointing/finalization behavior | Unknown | Mostly short sessions | Low | Medium |
| H/I | Short-session path that skips streaming entirely | Potentially high for `<5s` | 19% | Low | Medium/High |
| G | True streaming upload to Groq | Potentially high | Unknown | Low | High |
| C | Groq keep-alive | 0ms after first warm call | Most sessions | High | None |

Interpretation:

- `A` is still the best first ship because it is cheap, safe, and measurable
- `D` likely has better average upside than `B` once implemented well
- `B` is not wrong, but it should be treated as a guarded experiment because it
  can hurt transcript completeness
- `G` has the biggest architectural upside, but also the most uncertainty

---

## Revised implementation plan

### Milestone 0: observability first

Files:

- `src/daemon/service.ts`
- stats extraction / future stats docs

Add metrics that separate wall time from critical-path time:

- `deepgramStopWallMs`
- `deepgramCriticalPathMs`
- `deepgramStartedEarly`
- `deepgramOverlapMs`

Reason:

- today `deepgramMs` means the full stop duration
- after Option A, that same field could silently become "remaining tail after
  conversion" if we are not careful
- that would make post-change stats look better without making the semantics
  clear

This is worth doing in the same PR as Option A if we want to keep momentum, but
the metrics design should come first.

### Milestone 1: Option A in `service.ts`

File:

- `src/daemon/service.ts`

Change:

- in streaming mode, start `deepgramStreaming.stop()` immediately when
  processing begins
- run ffmpeg conversion while Deepgram teardown is already in flight
- only start Groq after conversion completes

Implementation safeguards:

- declare `groqErr`, `deepgramErr`, transcript strings, and chunk counters
  before launching the early Deepgram promise
- only create the early promise in the streaming branch
- preserve the internal `.catch(...)` on the early promise so a later
  conversion failure does not leave an unhandled rejection
- if conversion fails after stop has started, settle the stop promise in a
  best-effort path so teardown does not run detached from the request lifecycle
- record both wall time and critical-path contribution for Deepgram

Why this is first:

- it uses a real dependency fact already proven by the code
- it does not change transcript semantics
- it is the best safety/effort ratio in the backlog
- it helps the short-session experience, which is where fixed overhead hurts the
  most

Expected outcome:

- modest improvement in overall medians
- meaningful improvement on short commands
- zero expected accuracy regression

#### Agent handoff: exact implementation sequence for A

1. Extend `TranscriptionMetrics` in `src/daemon/service.ts`

- add `deepgramStopWallMs: number`
- add `deepgramCriticalPathMs: number`
- add `deepgramOverlapMs: number`
- add `deepgramStartedEarly: boolean`
- initialize them with `-1`, `-1`, `0`, and `false`

Reason:

- this avoids reusing `deepgramMs` for two different meanings before and after
  the change

2. Reorder local state near the top of `processAudio()`

- move `groqErr`, `deepgramErr`, `groqText`, `deepgramText`, and
  `streamingChunkCount` above conversion
- compute `const useStreaming = this.config.transcription.streaming && this.deepgramStreaming`

Reason:

- the early Deepgram promise needs access to those variables before ffmpeg
  starts

3. Start Deepgram stop early only in the streaming path

Suggested shape:

```ts
let deepgramStopPromise:
	| Promise<{
			result: { text: string; chunkCount: number; stopReason: StreamingStopReason };
			durationMs: number;
	  }>
	| null = null;

if (useStreaming) {
	metrics.deepgramStartedEarly = true;
	deepgramStopPromise = timeAsync(() =>
		this.deepgramStreaming!.stop().catch((err) => {
			deepgramErr = err;
			return {
				text: "",
				chunkCount: -1,
				stopReason: "not_connected" as const,
			};
		}),
	);
}
```

Reason:

- batch mode should stay untouched
- the internal `.catch(...)` prevents an unhandled rejection if conversion later
  fails

4. Leave conversion logic in place

- keep `const conversion = await timeAsync(() => convertAudio(audioBuffer))`
- keep `metrics.conversionMs` and `metrics.convertedAudioBytes`

Reason:

- Option A is an orchestration change, not a conversion change

5. Split the transcription stage cleanly by mode

Streaming branch:

```ts
const [groqTimed, deepgramTimed] = await Promise.all([
	timeAsync(() =>
		this.groq.transcribe(convertedBuffer, language, boostWords).catch((err) => {
			groqErr = err;
			return "";
		}),
	),
	deepgramStopPromise!,
]);

metrics.groqMs = groqTimed.durationMs;
metrics.deepgramStopWallMs = deepgramTimed.durationMs;
metrics.deepgramCriticalPathMs = Math.max(
	0,
	deepgramTimed.durationMs - metrics.conversionMs,
);
metrics.deepgramOverlapMs =
	deepgramTimed.durationMs - metrics.deepgramCriticalPathMs;
metrics.deepgramMs = metrics.deepgramCriticalPathMs;
```

Batch branch:

- keep the current `Promise.all([groq.transcribe, deepgram.transcribe])`
- set the new Deepgram metrics to:
  `deepgramStopWallMs = -1`
  `deepgramCriticalPathMs = metrics.deepgramMs`
  `deepgramOverlapMs = 0`
  `deepgramStartedEarly = false`

Reason:

- this keeps metric semantics explicit
- batch mode should not inherit streaming-only fields accidentally

6. Preserve existing transcript extraction and error handling

- keep `metrics.deepgramStopReason` sourced from the streaming result
- keep `groqText`, `deepgramText`, and `streamingChunkCount` assignment logic
- keep `handleTranscriptionError(...)` behavior unchanged

Reason:

- this milestone is about latency only, not behavior changes

7. Add one focused orchestration test if feasible

Preferred approach:

- extract a small helper for the streaming transcription stage and test it with
  mocked promises and delays

Fallback approach if refactor feels too large:

- add a narrow service-level test that stubs `convertAudio`,
  `this.groq.transcribe`, and `this.deepgramStreaming.stop`
- assert that total elapsed time is close to `max(conversion, deepgramStop) + groq + merge/...`
  instead of `conversion + deepgramStop + groq`

Reason:

- there is no current `service.ts` orchestration test, so without one this
  change will rely entirely on manual timing checks

8. Manual validation after code lands

- run one short streaming session and one medium streaming session
- inspect perf logs and confirm:
  `deepgramStartedEarly=true`
  `deepgramStopWallMs` is similar to old `deepgramMs`
  `deepgramCriticalPathMs` shrinks toward `0` on short sessions where ffmpeg
  hides most of the stop time
  transcript output is unchanged

Suggested commands:

- `bun test`
- `bun run lint`

### Milestone 2: merge gating expansion before timeout reduction

File:

- `src/transcribe/merger.ts`

Change:

- expand deterministic fast-path coverage conservatively
- prefer rules that are safe on short utterances:
  equal word count, short length, low normalized distance, possibly a
  token-similarity gate for very short strings

Why this moves ahead of Option B:

- likely better average latency upside than B
- helps all duration buckets, not just the Deepgram-bound tail
- lower correctness risk than cutting Deepgram finalize wait
- the merger already has a clean deterministic gate framework, so this extends
  an existing pattern instead of introducing a new subsystem

Guardrail:

- do not bump thresholds blindly
- sample real disagreements first, especially product names, commands, and
  code-like dictation

#### Agent handoff: implementation sequence for D

1. Collect a small corpus of real disagreements from logs or saved examples
2. Add tests to `tests/merger.test.ts` for the new safe cases first
3. Prefer adding a new deterministic gate instead of loosening
   `MINOR_DIFF_THRESHOLD` globally
4. Keep word-count divergence on the LLM path unless there is strong contrary
   evidence
5. Re-run `bun test tests/merger.test.ts`

Reason:

- the current merger code is already conservative for good reasons, especially
  around split proper nouns like "Hyprland" -> "hyper land"

### Milestone 3: Option B as a guarded experiment

File:

- `src/transcribe/deepgram-streaming.ts`

Change:

- reduce finalize wait from `300ms` to `100ms`, but only behind a flag or
  temporary constant during validation

Why this is not the next default step:

- the upside is narrower than it first appeared
- the downside is transcript truncation, not just a missed optimization
- seeing many `finalize_timeout` results does not prove that `100ms` is safe

Required validation:

- compare `finalize_transcript` vs `finalize_timeout` before and after
- spot-check short-session transcripts for missing tail words
- confirm that any latency gain is not being bought with accuracy loss

#### Agent handoff: implementation sequence for B

1. Replace the `300` constant in `src/transcribe/deepgram-streaming.ts` with a
   named constant
2. Make the experimental value easy to toggle during validation
3. Start with `100ms` only after A has landed and metrics are available
4. Validate using real short sessions, not just synthetic timings

Reason:

- without the Milestone 0 metrics, it will be hard to tell whether B helped or
  simply changed transcript completeness

### Milestone 4: investigate, do not commit yet

These are valid explorations, but not ahead of A/D/B:

- **E: endpointing/finalization tuning**
  Reason: may reduce teardown wait by finalizing more speech during recording,
  but can also alter segmentation and transcript quality.
- **H/I: short-session fast path**
  Reason: could be a big win for `<5s` sessions by skipping streaming entirely,
  but it changes runtime behavior and fallback characteristics.
- **G: true streaming upload to Groq**
  Reason: strongest architectural upside, but highest implementation
  uncertainty because SDK/body-streaming behavior is still unproven here.

### Explicitly deprioritized

- **C: Groq keep-alive**
  Reason: already happening for warm calls, so this should not consume roadmap
  time.

---

## Success criteria

Do not judge the next PR by a single headline latency number.

Track:

- `RTF` by duration bucket, especially `<5s`
- median and p95 `processingMs`
- `deepgramStopWallMs` vs `deepgramCriticalPathMs`
- merge skip rate
- `deepgramStopReason` distribution
- transcript quality spot-checks on short sessions

Milestone success looks like:

- after `A`: short-session latency improves, overlap metrics confirm the hidden
  Deepgram time, and transcript behavior is unchanged
- after `D`: merge skip rate rises without obvious semantic regressions
- before making `B` default: truncated-tail risk is ruled out with data, not
  inferred from timeout math

---

## Ceiling

The high-level ceiling is unchanged:

- long sessions are Groq-bound
- Deepgram teardown improvements stop mattering once Groq is much longer than
  Deepgram
- a real step-change beyond the current architecture likely requires one of:
  a different Groq interaction model,
  a faster merge path,
  or a duration-aware product path for short commands
