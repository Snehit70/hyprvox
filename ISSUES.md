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
6. [Test Issues](#test-issues--resolved)
7. [Overlay Timing & Logging](#overlay-timing--logging--resolved)
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

### 2. Empty Catch Blocks ✅ RESOLVED

**Status:** Fixed in commit `7035739`. All empty catch blocks now have appropriate logging.

**Resolution:**
- Cleanup operations (log rotation, file deletion) → Debug-level logging with `console.debug`
- Fallback paths (config load, directory creation) → Debug/warn logging with context
- Process existence checks → Comments documenting the control flow pattern
- Best-effort operations (systemctl commands, PID file cleanup) → Debug logging

| File | Lines | Fix Applied |
|------|-------|-------------|
| `src/utils/logger.ts` | 37, 40, 43 | Debug logging for log rotation |
| `src/utils/stats.ts` | 69 | Error logging for stats save failure |
| `src/cli/index.ts` | 56, 57, 319, 376, 382, 388 | Comments documenting control flow + debug logging |
| `src/audio/recorder.ts` | 32 | Debug logging for config load fallback |
| `src/daemon/service.ts` | 194, 207, 213, 373 | Debug logging for cleanup operations |
| `src/daemon/supervisor.ts` | 107 | Debug logging for PID file cleanup |
| `src/output/clipboard.ts` | 29 | Error logging for directory creation failure |

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

Chunks array grows unbounded during recording (up to 5 minutes max). At 16 kHz mono 16-bit audio:
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
5. **Overlay stdout in daemon output** - Temporarily changed to `stdio: "inherit"` for timing measurements; reverted to `stdio: "ignore"` in cleanup commit.

### Results

| Metric | Measured |
|--------|----------|
| IPC latency | 0-1ms |
| State change to window shown | 1-4ms |
| Initial connection hello | ~193ms |

---

## Code Quality

### 1. Hardcoded Values - Resolved

Only `mergeModel` needed to be configurable. Others are internal tuning values that don't need user exposure.

| Value | Status |
|-------|--------|
| `MERGE_MODEL` | ✅ Now configurable via `transcription.mergeModel` |
| `MAX_BUFFER_CHUNKS` | ⏸️ Internal tuning |
| `HALLUCINATION_MAX_CHARS` | ⏸️ Tuned heuristic |
| `WARNING_4M/430M` | ✅ Via `maxDuration` |
| `backoffs` | ⏸️ Fast backoff is optimal |

### 2. Missing JSDoc Comments - Scrapped

TypeScript types provide sufficient documentation for a personal CLI tool. No external API consumers.

### 3. Duplicate IPC Types - Resolved

`IPCMessage` interface now defined in shared locations:
- `src/shared/ipc-types.ts` (daemon)
- `overlay/src/shared/ipc-types.ts` (overlay)

Files are identical and maintained in sync. Separate copies needed for build isolation.

---

## Configuration

### 1. Default boostWords - Remaining

The `boostWords` array is typically empty. Consider:
- Adding default technical vocabulary
- Providing example words in config template

This is the only remaining enhancement.

### 2. Overlay Timing Config - Deferred

Overlay timing (successHideDelay, errorHideDelay) uses sensible defaults. They can be made configurable if needed.

### 3. Config Consolidation in DaemonService ✅ RESOLVED

- Added SIGUSR2 handler for config hot-reload
- Created ConfigService singleton in `src/config/service.ts`
- Hot-reload works for: hotkey, overlay settings, transcription settings
- API keys still require restart (acceptable edge case)

---

## Recommendations Summary

### Remaining

1. **Add default boostWords** for common technical terms

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

*Last updated: Feb 20, 2026*
*Review conducted by: Code Review*
