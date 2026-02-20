# Config Consolidation Plan

> **Status: IMPLEMENTED (Feb 20, 2026)**
> 
> Phase 1 and partial Phase 2 completed. Remaining transcriber refactoring cancelled as unnecessary.

## Implementation Summary

### Completed

| Item | Status | Notes |
|------|--------|-------|
| `clearConfigCache()` | ✅ Done | Added to `src/config/loader.ts` |
| `reloadConfig()` with validation | ✅ Done | Returns `ConfigLoadResult` instead of throwing |
| `tryLoadConfig()` helper | ✅ Done | Non-throwing config load for safe reload |
| Mutex for concurrent reloads | ✅ Done | `reloadInProgress` flag in loader.ts |
| SIGUSR2 handler | ✅ Done | Triggers config reload with notification |
| ConfigService singleton | ✅ Done | `src/config/service.ts` |
| DaemonService integration | ✅ Done | Uses `this.config` from ConfigService |

### Cancelled (Not Needed)

| Item | Reason |
|------|--------|
| Transcriber constructor injection | API keys loaded once; hot-reload not needed |
| AudioRecorder constructor injection | Already reloads settings on each `start()` call |
| Replace module-level loadConfig() | AudioRecorder already hot-reloads; transcribers don't need it |

## Hot-Reload Support Matrix

| Config Value | Hot-Reloadable | Mechanism |
|--------------|----------------|-----------|
| `behavior.hotkey` | ✅ Yes | `this.config` updated in reload handler |
| `overlay.enabled` | ✅ Yes | `this.config` updated in reload handler |
| `overlay.autoStart` | ✅ Yes | `this.config` updated in reload handler |
| `transcription.streaming` | ✅ Yes | `this.config` updated in reload handler |
| `transcription.language` | ✅ Yes | `this.config` updated in reload handler |
| `behavior.clipboard.*` | ✅ Yes | AudioRecorder.reloadSettings() on each start |
| `apiKeys.groq` | ❌ No | Loaded once in GroqClient constructor |
| `apiKeys.deepgram` | ❌ No | Loaded once in transcriber constructors |

## Usage

```bash
# Reload config while daemon is running
kill -SIGUSR2 $(cat ~/.config/hyprvox/daemon.pid)

# Or via CLI (future enhancement)
hyprvox config reload
```

## Files Modified

- `src/config/loader.ts` - Added `clearConfigCache()`, `reloadConfig()`, `tryLoadConfig()`, `ConfigLoadResult`
- `src/config/service.ts` - **NEW** ConfigService singleton
- `src/daemon/service.ts` - SIGUSR2 handler, ConfigService integration

---

## Current State Analysis (Historical)

### Caching Mechanism (`src/config/loader.ts:22-35`)

```typescript
let cachedConfig: Config | null = null;

export const loadConfig = (configPath = DEFAULT_CONFIG_FILE, forceReload = false): Config => {
  if (cachedConfig && !forceReload && configPath === DEFAULT_CONFIG_FILE) {
    return cachedConfig;
  }
  // ... load and validate config
  if (configPath === DEFAULT_CONFIG_FILE) {
    cachedConfig = config;
  }
  return config;
};
```

**Key observations:**
- Caching only works for `DEFAULT_CONFIG_FILE` path
- `forceReload=true` bypasses cache
- Custom config paths are never cached

### Call Site Inventory (31 calls across 16 files)

| Pattern | Files | Count | When Called |
|---------|-------|-------|-------------|
| Module-level init | logger, notification, hotkey, groq, deepgram, deepgram-streaming, merger | 7 | Once on import |
| DaemonService methods | service.ts | 6 | Per method call |
| CLI commands | config.ts, boost.ts, overlay.ts, health.ts, logs.ts, errors.ts | 12 | Per command |
| Utility functions | history.ts, recorder.ts | 5 | Per function call |

**Not a performance issue:** Due to caching, these 31 calls result in exactly 1 file read (after first load). The "31 calls" is misleading—they're all returning the cached object.

---

## Problems Identified

### 1. Config Changes Not Detected at Runtime

**Scenario:** User runs `hyprvox config set behavior.hotkey f13` while daemon is running.

**Current behavior:** Hotkey listener continues using old hotkey until daemon restart.

**Affected config values:**
- `behavior.hotkey` - used in `DaemonService.start()`
- `overlay.enabled` - used in `startOverlay()`, `notifyStateChange()`
- `overlay.autoStart` - used in `startOverlay()`
- `transcription.streaming` - used in `handleTrigger()`

**Unaffected config values:**
- `apiKeys.*` - loaded fresh in transcriber constructors (module-level)
- `paths.*` - used only on startup

### 2. Module-Level Initialization Before Daemon Ready

**Files with module-level config access:**
```typescript
// logger.ts:10 - runs on import
const config = loadConfig();

// notification.ts:13 - runs on import  
const config = loadConfig();

// etc.
```

**Problem:** If config file is missing or corrupted, these modules throw during import, before daemon can show a proper error message.

**Current mitigation:** CLI commands check config health before importing these modules.

### 3. No Config Reload Signal

**Daemon has SIGUSR1 for recording toggle, but no signal for config reload.**

### 4. Inconsistent Error Handling

- `loadConfig()` throws `AppError` with codes `CORRUPTED` or `VALIDATION_FAILED`
- Some callers catch and handle, others let it propagate
- Module-level calls have no try/catch

---

## Edge Cases

### Edge Case 1: Config Deleted While Daemon Running

**Scenario:** User runs `rm ~/.config/hyprvox/config.json`

**Current behavior:**
- `loadConfig()` returns cached config (no re-read)
- Daemon continues with stale config
- Next CLI command creates default config or fails

**Expected behavior:** Unclear. Options:
- (A) Continue with cached config (current behavior)
- (B) Detect file deletion and use defaults
- (C) Fail gracefully

### Edge Case 2: Config Corrupted While Daemon Running

**Scenario:** User edits config and introduces JSON syntax error.

**Current behavior:** If `forceReload=true` called, daemon crashes with `CORRUPTED` error.

**Expected behavior:** Validate config change before applying, rollback on error.

### Edge Case 3: API Key Rotated

**Scenario:** User rotates API keys and updates config.

**Current behavior:** Transcription clients (Groq, Deepgram) have keys from module init, not config reload.

**Expected behavior:** Hot-reload API keys for retry logic.

### Edge Case 4: Overlay Path Changed

**Scenario:** User changes `overlay.binaryPath` while daemon running.

**Current behavior:** Change not picked up until daemon restart.

**Expected behavior:** Overlay would need restart anyway, so current behavior is acceptable.

### Edge Case 5: Multiple CLI Commands in Parallel

**Scenario:** User runs `hyprvox config set ...` in two terminals simultaneously.

**Current behavior:** Race condition. Last write wins.

**Expected behavior:** File locking or atomic writes (already implemented in `file-ops.ts`).

### Edge Case 6: Custom Config Path

**Scenario:** User runs `hyprvox --config /custom/path.json start`

**Current behavior:** Cache doesn't work for custom paths, every `loadConfig()` re-reads file.

**Expected behavior:** Should respect custom path consistently, but this is an edge case.

---

## Consolidation Options

### Option A: Config Object in DaemonService (Recommended)

**Approach:** Load config once in DaemonService constructor, pass to components that need it.

```typescript
class DaemonService {
  private config: Config;
  
  constructor() {
    this.config = loadConfig();
    // Pass config to components
    this.recorder = new AudioRecorder(this.config);
    this.hotkeyListener = new HotkeyListener(this.config);
    // etc.
  }
  
  reloadConfig(): void {
    this.config = loadConfig(DEFAULT_CONFIG_FILE, true);
    // Update components as needed
  }
}
```

**Pros:**
- Single source of truth
- Easy to add reload signal
- Clear dependency graph

**Cons:**
- Requires constructor changes across multiple classes
- Breaking change for module-level initialization

### Option B: Config Service with Subscriptions

**Approach:** Create a ConfigService that emits change events.

```typescript
class ConfigService {
  private config: Config;
  private listeners: Set<(config: Config) => void> = new Set();
  
  getConfig(): Config { return this.config; }
  
  subscribe(listener: (config: Config) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  reload(): void {
    this.config = loadConfig(DEFAULT_CONFIG_FILE, true);
    for (const listener of this.listeners) {
      listener(this.config);
    }
  }
}
```

**Pros:**
- Reactive updates
- Components can subscribe to changes
- Clean separation

**Cons:**
- More complex
- Requires subscription management
- Potential for stale subscriptions

### Option C: Keep Current, Add Reload Signal

**Approach:** Keep `loadConfig()` caching, add SIGUSR2 handler to clear cache.

```typescript
// In loader.ts
export const clearConfigCache = (): void => {
  cachedConfig = null;
};

// In daemon service
process.on("SIGUSR2", () => {
  clearConfigCache();
  // Components that need fresh config will get it on next loadConfig()
});
```

**Pros:**
- Minimal change
- Backward compatible
- Simple implementation

**Cons:**
- Doesn't help with module-level initialization
- Config still scattered across files
- No proactive notification to components

---

## Recommended Approach: Option A + C Hybrid

**Phase 1: Immediate (Low Risk)**
1. Add `clearConfigCache()` export to loader.ts
2. Add SIGUSR2 handler in DaemonService to clear cache
3. Document the reload signal

**Phase 2: Refactor (Medium Risk)**
1. Change transcribers to accept config in constructor
2. Change recorder, hotkey, notification to accept config
3. Load config once in DaemonService constructor
4. Add `reloadConfig()` method to DaemonService

**Phase 3: Future (High Risk)**
1. Implement file watcher for config changes
2. Add config validation before applying
3. Add rollback mechanism for bad configs

---

## Implementation Checklist

### Phase 1: Config Cache Clear (1 hour)

- [ ] Add `clearConfigCache()` to `src/config/loader.ts`
- [ ] Add `reloadConfig()` to `src/config/loader.ts` that calls `loadConfig(path, true)`
- [ ] Add SIGUSR2 handler in `src/daemon/service.ts`
- [ ] Update ISSUES.md with implementation notes
- [ ] Test: Verify `kill -SIGUSR2 <pid>` triggers reload

### Phase 2: Config Injection (3-4 hours)

- [ ] Create `src/config/service.ts` with ConfigService class
- [ ] Refactor `AudioRecorder` to accept config in constructor
- [ ] Refactor `HotkeyListener` to accept config in constructor
- [ ] Refactor `GroqClient` to accept config in constructor
- [ ] Refactor `DeepgramTranscriber` to accept config in constructor
- [ ] Refactor `DeepgramStreamingTranscriber` to accept config in constructor
- [ ] Refactor `TranscriptMerger` to accept config in constructor
- [ ] Refactor `ClipboardManager` to accept config in constructor (if needed)
- [ ] Update DaemonService to inject config
- [ ] Remove module-level config calls
- [ ] Run full test suite
- [ ] Manual integration test

### Phase 3: Hot Reload (Future)

- [ ] Research file watching libraries (chokidar vs node:fs watch)
- [ ] Implement config file watcher
- [ ] Add validation before applying changes
- [ ] Add rollback mechanism
- [ ] Update documentation

---

## Files to Modify

### Phase 1

| File | Change |
|------|--------|
| `src/config/loader.ts` | Add `clearConfigCache()`, `reloadConfig()` exports |
| `src/daemon/service.ts` | Add SIGUSR2 handler |

### Phase 2

| File | Change |
|------|--------|
| `src/config/service.ts` | **NEW** ConfigService class |
| `src/daemon/service.ts` | Inject config into components |
| `src/audio/recorder.ts` | Accept config in constructor |
| `src/daemon/hotkey.ts` | Accept config in constructor |
| `src/transcribe/groq.ts` | Accept config in constructor |
| `src/transcribe/deepgram.ts` | Accept config in constructor |
| `src/transcribe/deepgram-streaming.ts` | Accept config in constructor |
| `src/transcribe/merger.ts` | Accept config in constructor |
| `src/output/notification.ts` | Accept config in constructor |
| `src/utils/logger.ts` | Keep module-level (no change needed) |

---

## Testing Strategy

### Unit Tests

```typescript
// src/config/loader.test.ts
describe('loadConfig caching', () => {
  it('should cache config for default path', () => {
    const c1 = loadConfig();
    const c2 = loadConfig();
    expect(c1).toBe(c2); // Same reference
  });
  
  it('should bypass cache with forceReload', () => {
    const c1 = loadConfig();
    const c2 = loadConfig(DEFAULT_CONFIG_FILE, true);
    expect(c1).not.toBe(c2); // Different reference
  });
});

describe('clearConfigCache', () => {
  it('should clear cached config', () => {
    const c1 = loadConfig();
    clearConfigCache();
    const c2 = loadConfig();
    expect(c1).not.toBe(c2);
  });
});
```

### Integration Tests

```bash
# Test 1: Config reload via signal
bun run index.ts start &
DAEMON_PID=$!
bun run index.ts config set behavior.hotkey f13
kill -SIGUSR2 $DAEMON_PID
# Verify hotkey changed in logs

# Test 2: Config validation on reload
echo "invalid json" > ~/.config/hyprvox/config.json
kill -SIGUSR2 $DAEMON_PID
# Verify daemon doesn't crash, logs error
```

---

## Open Questions

1. **Should we support custom config paths in daemon?**
   - Current: CLI supports `--config`, daemon doesn't
   - Recommendation: Defer, it's an edge case

2. **Should we validate config before applying?**
   - Current: Validation happens on load, but errors crash the process
   - Recommendation: Add try/catch around reload, log error but don't crash

3. **What should happen if config is deleted?**
   - Recommendation: Continue with cached config, log warning

4. **Should we add file watching?**
   - Recommendation: Defer to Phase 3, signal-based reload is sufficient for now
