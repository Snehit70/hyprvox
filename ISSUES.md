# voice-cli Issues & Improvements

> Comprehensive code review conducted Feb 19, 2026. This document catalogs all identified issues, bugs, and improvement opportunities for future development.
>
> **Update (Feb 19, 2026)**: Test suite aggressively cleaned. Reduced from 34 files (~6,120 lines) to 6 files (~825 lines). Only critical integration tests remain.

## Table of Contents

1. [Critical Issues](#critical-issues)
2. [Type Safety Issues](#type-safety-issues)
3. [Performance Bottlenecks](#performance-bottlenecks)
4. [Memory Management](#memory-management)
5. [Error Handling](#error-handling)
6. [Test Issues](#test-issues)
7. [Overlay Timing & Logging](#overlay-timing--logging)
8. [Code Quality](#code-quality)
9. [Configuration](#configuration)
10. [Recommendations Summary](#recommendations-summary)

---

## Critical Issues

### ~~1. TypeScript Compilation Error in Tests~~ ✅ RESOLVED

**Status:** Fixed by removing the broken test file during test cleanup.

The file `tests/transcribe/deepgram.test.ts` was deleted as part of aggressive test cleanup. The real Deepgram integration is tested in `tests/integration/deepgram_api.test.ts`.

### 2. Overlay Component Lint Errors ✅ RESOLVED

**Status:** Fixed in commit `e79b39f`.

Changed `forEach()` to `for...of` loops and added `tabIndex={-1}` to canvas.

---

## Type Safety Issues

### 1. `as any` Type Assertions in Production Code ✅ RESOLVED

**Status:** Fixed in commit `674eda6`. Added type guards in `src/utils/errors.ts`:
- `isAppError()`, `getErrorCode()`, `hasErrorCode()`, `isErrorWithName()`, `errorIncludes()`

---

### 2. Empty Catch Blocks

**Severity:** LOW-MEDIUM

Found 29 instances of `catch (_e) {}` that silently swallow errors:

| File | Lines |
|------|-------|
| `src/utils/logger.ts` | 44, 47 |
| `src/utils/stats.ts` | 65 |
| `src/cli/index.ts` | 56, 57, 319, 376, 382, 388 |
| `src/audio/recorder.ts` | 32 |
| `src/daemon/service.ts` | 194, 200, 361 |
| `src/daemon/supervisor.ts` | 78, 84 |
| `src/output/clipboard.ts` | 28 |

**Recommendation:** At minimum, log errors at debug level. Critical paths should handle errors explicitly.

### 3. Biome Lint Warnings

**Severity:** LOW

- `overlay/vite.config.ts:2` - Missing `node:` protocol for path import
- `scripts/examples/*.ts` - Multiple `any` type annotations in catch blocks

---

## Performance Bottlenecks

### 1. Synchronous File Operations in Hot Paths

**Severity:** HIGH

| File | Line | Operation | Impact |
|------|------|-----------|--------|
| `src/daemon/supervisor.ts` | 74, 77 | `readFileSync`, `writeFileSync` | Blocks event loop during crash handling |
| `src/utils/logger.ts` | 42 | `unlinkSync` | Blocks during log rotation |
| `src/output/clipboard.ts` | 49 | `appendFileSync` | Blocks in fallback path |
| `src/config/loader.ts` | 52 | `readFileSync` | Blocks on every config load |
| `src/utils/stats.ts` | 28, 64 | `readFileSync`, `writeFileSync` | Blocks on stats operations |
| `src/utils/history.ts` | 85, 103, 125, 145 | Multiple sync operations | Blocks history operations |

**Recommendation:** Convert to async operations with `fs/promises`. The daemon service already uses `writeFile` from `fs/promises` for state updates (good pattern to follow).

### 2. Config Loading on Every Operation

**Severity:** MEDIUM

`loadConfig()` is called in constructors of:
- `GroqClient` (line 11)
- `DeepgramTranscriber` (line 11)
- `DeepgramStreamingTranscriber` (line 28)
- `TranscriptMerger` (line 48)
- `AudioRecorder` (line 29)
- `DaemonService` (lines 147, 155, 228, 314, 369, 531)

**Current State:** Config IS cached (line 22-23 in loader.ts), but only for the default config path. The cache is properly implemented.

**Issue:** Multiple `loadConfig()` calls within `DaemonService.processAudio()` and `handleTrigger()` could be consolidated.

### 3. Deepgram Streaming Connection Monitoring

**Severity:** LOW

**File:** `src/transcribe/deepgram-streaming.ts:112-140`

Uses polling with 100ms intervals to monitor connection timeout. This is acceptable but could be replaced with a single `setTimeout` for cleaner code.

### 4. Retry Backoff Strategy

**Severity:** LOW

**File:** `src/utils/retry.ts`

Fixed backoffs `[100, 200]ms` may be too aggressive for API rate limits. Consider:
- Exponential backoff option
- Jitter to prevent thundering herd

---

## Memory Management

### 1. Unbounded Array Growth During Recording

**Severity:** MEDIUM

**File:** `src/audio/recorder.ts:89`

```typescript
this.chunks.push(bufferChunk);
```

Chunks array grows unbounded during recording (up to 5 minutes max). At 16kHz mono 16-bit audio:
- 5 minutes = ~9.6MB of audio data

**Mitigation:** Max duration is enforced (5 min), and chunks are cleared on stop. This is acceptable but could benefit from a warning if approaching memory limits.

### 2. Transcript Chunks Accumulation

**Severity:** LOW

**File:** `src/transcribe/deepgram-streaming.ts:20`

```typescript
private transcriptChunks: string[] = [];
```

Accumulates all transcript chunks during streaming. Cleared on `stop()`. Acceptable for typical use.

### 3. Audio Buffer During Connection

**Severity:** LOW

**File:** `src/transcribe/deepgram-streaming.ts:178-189`

Audio is buffered while Deepgram connection is establishing. Has `MAX_BUFFER_CHUNKS = 100` limit with warning. Good implementation.

---

## Error Handling

### 1. Inconsistent Error Typing

**Severity:** MEDIUM

Error handling uses multiple patterns:
- `AppError` with error codes
- `TranscriptionError` extending `AppError`
- `ClipboardAccessError` extending `AppError`
- Raw `Error` objects
- `any` type assertions for error properties

**Recommendation:** Standardize on `AppError` with proper error codes. Create type guards for error checking.

### 2. Missing Error Recovery in Streaming

**Severity:** MEDIUM

**File:** `src/transcribe/deepgram-streaming.ts`

No automatic reconnection on connection drop during recording. If WebSocket drops mid-recording, streaming fails silently and falls back to batch mode.

**Recommendation:** Add reconnection logic with buffered audio replay.

---

## Test Issues ✅ RESOLVED

### Test Suite Cleanup (Feb 19, 2026)

**Status:** Aggressively cleaned per user directive.

| Metric | Before | After |
|--------|--------|-------|
| Test files | 34 | 6 |
| Lines of code | ~6,120 | ~825 |
| Test count | 150+ | 32 |

**Remaining test files (critical only):**
- `tests/config.test.ts` - Config schema validation
- `tests/retry.test.ts` - Retry utility logic
- `tests/integration/crash_recovery.test.ts` - Daemon crash recovery
- `tests/integration/deepgram_api.test.ts` - Real Deepgram API integration
- `tests/integration/groq_api.test.ts` - Real Groq API integration
- `tests/integration/history_storage.test.ts` - History persistence

**Deleted (28 files):**
- Unit tests with excessive mocking
- Tests duplicating integration test coverage
- Manual test documentation
- Edge case tests with low value

All remaining tests pass: `bun test` → 32 tests, 0 failures.

---

## Overlay Timing & Logging ✅ RESOLVED

**Status:** Implemented in commits `0f1ff40`, `6ab029e`, `0c0612f`.

### Implemented

1. **Timestamp in IPC messages** - Added to `IPCMessage` type, set in `broadcastStatus()`
2. **IPC latency logging** - `overlay/src/ipc-client.ts` logs `[TIMING] IPC state received, latency=Xms`
3. **State change timing** - `overlay/src/main.ts` logs `[TIMING] State change: X, latency=Yms`
4. **Window visibility timing** - Logs `[TIMING] Window shown (X), total=Yms`
5. **Overlay stdout in daemon output** - Changed `stdio: "ignore"` → `stdio: "inherit"`

### Results

| Metric | Measured |
|--------|----------|
| IPC latency | 0-1ms |
| State change to window shown | 1-4ms |
| Initial connection hello | ~193ms |

---

## Code Quality

### 1. Hardcoded Values That Should Be Configurable

| File | Line | Value | Suggestion |
|------|------|-------|------------|
| `src/transcribe/merger.ts` | 7 | `MERGE_MODEL = "llama-3.3-70b-versatile"` | Add to config |
| `src/transcribe/deepgram-streaming.ts` | 24 | `MAX_BUFFER_CHUNKS = 100` | Add to config |
| `src/daemon/service.ts` | 25 | `HALLUCINATION_MAX_CHARS = 20` | Add to config |
| `src/audio/recorder.ts` | 18-19 | `WARNING_4M`, `WARNING_430M` | Already configurable via maxDuration |
| `src/utils/retry.ts` | 16 | `backoffs = [100, 200]` | Add to config |

### 2. Missing JSDoc Comments

Core public APIs lack documentation:
- `DaemonService` public methods
- `AudioRecorder` public methods
- `TranscriptMerger.merge()`

### 3. Duplicate IPC Types

`IPCMessage` interface is defined in both:
- `src/daemon/ipc.ts:16-22`
- `overlay/src/ipc-client.ts:27-33`

**Recommendation:** Create shared types package or move to a common location.

---

## Configuration

### 1. Empty boostWords Array

**File:** User's `config.json`

The `boostWords` array is typically empty. Consider:
- Adding default technical vocabulary
- Providing example words in config template
- Adding CLI command to suggest words based on usage

### 2. Missing Overlay Timing Config

Add configurable timing values:
```json
{
  "overlay": {
    "successHideDelay": 1500,
    "errorHideDelay": 3000,
    "showLatencyLogging": false
  }
}
```

### 3. Config Consolidation in DaemonService ✅ RESOLVED

**Status:** Implemented (Feb 20, 2026). See `PLAN-CONFIG-CONSOLIDATION.md` for full details.

**Summary:**
- Added SIGUSR2 handler for config hot-reload
- Created ConfigService singleton in `src/config/service.ts`
- DaemonService now uses injected config with reload support
- Hot-reload works for: hotkey, overlay settings, transcription settings
- API keys still require restart (acceptable edge case)

**Quick stats:**
| Pattern | Count | Files |
|---------|-------|-------|
| Module-level init | 7 | logger, notification, hotkey, groq, deepgram, etc. |
| DaemonService methods | 6 | service.ts |
| CLI commands | 12 | config.ts, boost.ts, overlay.ts, etc. |
| Utility functions | 5 | history.ts, recorder.ts |

**Implementation phases:**
1. Phase 1: Add `clearConfigCache()` + SIGUSR2 handler (1 hour, low risk)
2. Phase 2: Inject config into component constructors (3-4 hours, medium risk)
3. Phase 3: Add file watcher for hot reload (future, high risk)

---

## Recommendations Summary

### High Priority

1. ~~**Fix TypeScript error** in `tests/transcribe/deepgram.test.ts:84`~~ ✅ RESOLVED (file deleted)
2. ~~**Convert sync file ops to async** in supervisor, logger, clipboard fallback~~ ✅ RESOLVED (commit `fa8053f`)
3. ~~**Add overlay timing logs** for performance monitoring~~ ✅ RESOLVED (commit `0f1ff40`)
4. ~~**Standardize error handling** with proper type guards~~ ✅ RESOLVED (commit `674eda6`)

### Medium Priority

5. **Add Deepgram streaming reconnection** logic
6. ~~**Consolidate config loading** in DaemonService~~ ✅ RESOLVED (commit `51cf9df`)
7. **Add exponential backoff** option to retry utility
8. ~~**Create shared IPC types** between daemon and overlay~~ ✅ RESOLVED (commit `0f1ff40`)

### Low Priority

9. **Add JSDoc comments** to public APIs
10. **Make hardcoded values configurable**
11. **Add default boostWords** for common technical terms
12. **Replace empty catch blocks** with debug logging

---

## Metrics for Future Tracking

Timing logs added in commit `0f1ff40`. Current measurements (Feb 19, 2026):

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Overlay show latency | <50ms | 1-4ms | ✅ Excellent |
| IPC message latency | <10ms | 0-1ms | ✅ Excellent |
| State file write time | <5ms | ~1ms (debounced) | ✅ Good |
| Config load time (cached) | <1ms | <1ms | ✅ Good |
| Transcription processing | <2s | ~500-600ms | ✅ Excellent |
| LLM merge time | <1s | 120-180ms | ✅ Excellent |

---

*Last updated: Feb 19, 2026*
*Review conducted by: Code Review*
