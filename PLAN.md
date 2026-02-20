# Overlay Integration Plan

**Status**: Complete
**Branch**: `feat/waveform-overlay-mockup`
**Created**: 2026-02-18
**Updated**: 2026-02-19

---

## Overview

Integrate the Electron waveform overlay with the hyprvox daemon for real-time state synchronization.

### Goals

- Overlay appears when recording starts
- Shows live audio visualization during recording
- Shows processing state while transcribing
- Shows success/error feedback
- Auto-hides after completion

---

## Architecture

### IPC Method: Unix Domain Socket

```
┌─────────────────────────────────────────────────────────────────────┐
│                      INTEGRATION ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌─────────────────┐         ┌─────────────────────────────────┐  │
│   │   hyprvox     │         │      hyprvox-overlay          │  │
│   │    daemon       │         │       (electron)                │  │
│   │                 │         │                                 │  │
│   │  ┌───────────┐  │  IPC    │  ┌───────────┐    ┌──────────┐ │  │
│   │  │  Daemon   │  │◄───────►│  │   Main    │───►│ Renderer │ │  │
│   │  │  Service  │  │ Socket  │  │  Process  │    │ (React)  │ │  │
│   │  └───────────┘  │         │  └───────────┘    └──────────┘ │  │
│   │        │        │         │        │                 │      │  │
│   │        ▼        │         │        ▼                 ▼      │  │
│   │  ┌───────────┐  │         │  ┌───────────┐    ┌──────────┐ │  │
│   │  │    IPC    │  │         │  │ IPC Client│    │LiveWave- │ │  │
│   │  │  Server   │──┼─────────┼─►│ (watcher) │───►│  form    │ │  │
│   │  └───────────┘  │         │  └───────────┘    └──────────┘ │  │
│   │                 │         │                                 │  │
│   └─────────────────┘         └─────────────────────────────────┘  │
│                                                                     │
│   Socket: ~/.config/hyprvox/daemon.sock                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Why Unix Socket?

- **Current state**: Daemon writes to `~/.config/hyprvox/daemon.state` (JSON file)
- **Problem**: File polling has 100-500ms latency - too slow for smooth UI
- **Known issue**: `updateState()` uses `writeFileSync` (blocking) on every state change
- **Solution**: Unix Domain Socket provides <1ms latency for real-time updates

### Implementation Notes

- **Runtime**: Daemon uses Bun, overlay uses Electron (Node.js)
- **Socket API**: Use Node.js `net` module (Bun-compatible) for raw TCP/IPC
- **NOT using**: `Bun.serve({ unix: ... })` - that's HTTP-based, we need raw socket
- **Protocol**: JSON Lines (newline-delimited JSON) - simple, debuggable, no framing needed
- **Linux optimization**: Abstract namespace sockets (`\0prefix`) auto-cleanup on exit

---

## State Machine

### Daemon States (existing)

```
idle → starting → recording → stopping → processing → idle
                                    │
                                    ▼
                                  error
```

### Overlay States (new)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    DAEMON → OVERLAY STATE MAPPING                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   DAEMON STATE          OVERLAY STATE         VISUAL                    │
│   ────────────          ────────────         ──────────                 │
│                                                                         │
│   ┌─────────┐           ┌─────────┐         Empty/Dark                  │
│   │  idle   │ ────────► │ HIDDEN  │         (overlay not shown)         │
│   └────┬────┘           └─────────┘                                        │
│        │ hotkey                                                            │
│        ▼                                                                   │
│   ┌──────────┐         ┌────────────┐       Green bars                   │
│   │ starting │ ──────► │ LISTENING  │       (microphone active)          │
│   └────┬─────┘         └────────────┘                                       │
│        │ recorder.on('start')                                               │
│        ▼                                                                   │
│   ┌───────────┐        ┌────────────┐       Live waveform                │
│   │ recording │ ─────► │ RECORDING  │       (bars react to voice)        │
│   └─────┬─────┘        └────────────┘                                       │
│        │ recorder.on('stop')                                                │
│        ▼                                                                   │
│   ┌────────────┐       ┌────────────┐       Pulsing/spinning             │
│   │ processing │ ────► │ PROCESSING │       (transcribing...)            │
│   └─────┬──────┘       └────────────┘                                       │
│        │ transcription done                                                 │
│        ▼                                                                   │
│   ┌─────────┐           ┌────────────┐       Flash + fade                │
│   │  idle   │ ────────► │   SUCCESS  │       (brief checkmark)           │
│   └─────────┘           └─────┬──────┘                                      │
│                               │ 2s delay                                    │
│                               ▼                                             │
│                         ┌─────────┐                                         │
│                         │ HIDDEN  │                                         │
│                         └─────────┘                                         │
│                                                                         │
│   ┌─────────┐           ┌─────────┐         Red tint                     │
│   │  error  │ ────────► │  ERROR  │         (error message)              │
│   └─────────┘           └────┬────┘                                        │
│                              │ 3s delay                                     │
│                              ▼                                              │
│                         ┌─────────┐                                         │
│                         │ HIDDEN  │                                         │
│                         └─────────┘                                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Overlay State Enum

```typescript
type OverlayState =
  | "hidden" // Not visible
  | "listening" // Mic active, waiting for voice
  | "recording" // Voice detected, bars moving
  | "processing" // Transcribing (spinner/pulse)
  | "success" // Flash checkmark briefly
  | "error" // Show error briefly
  | "connecting"; // Daemon connection in progress (NEW)
```

### Processing State Visual

During `processing`, the microphone is off so LiveWaveform has no input.

**Chosen approach**: Animated spinner with pulsing dots

- Simple CSS animation (no audio dependency)
- Clear "working" indication
- Lightweight, no complex interpolation

Alternative considered: Freeze last waveform + pulse overlay (rejected: adds complexity)

---

## IPC Protocol

Simple JSON Lines over Unix socket with protocol versioning.

### Protocol Version

First message from daemon on client connect:

```json
{ "type": "hello", "version": 1, "status": "idle" }
```

Overlay checks version and warns if mismatch (allows graceful degradation).

### Daemon → Overlay (broadcast)

```json
{"type":"hello","version":1,"status":"idle"}
{"type":"state","status":"recording"}
{"type":"state","status":"processing"}
{"type":"state","status":"idle","lastTranscription":"2026-02-18T23:30:00Z"}
{"type":"state","status":"error","error":"Microphone not found"}
```

### Overlay → Daemon (optional)

```json
{"type":"subscribe"}
{"type":"ping"}
```

### Error Handling

| Error                 | Daemon Behavior                         | Overlay Behavior                             |
| --------------------- | --------------------------------------- | -------------------------------------------- |
| Socket already exists | Try connect → if fails, unlink & create | N/A                                          |
| Client disconnect     | Remove from client Set, continue        | Trigger reconnect with backoff               |
| JSON parse error      | Log warning, skip malformed line        | Log warning, skip malformed line             |
| Socket write error    | Remove client from Set                  | Trigger reconnect                            |
| `ECONNREFUSED`        | N/A                                     | Socket exists but daemon not running → retry |
| `ENOENT`              | N/A                                     | Socket file doesn't exist → retry            |

---

## Implementation Phases

### Phase 1: Daemon IPC Server

**Goal**: Add Unix socket server to daemon for broadcasting state changes.

#### Tasks

- [x] Create `src/daemon/ipc.ts`
  - Unix socket server using Node.js `net.createServer()` (Bun-compatible)
  - Socket path: `~/.config/hyprvox/daemon.sock`
  - Handle multiple client connections (track in Map)
  - Cleanup socket file on exit via `server.close()` callback
  - Send `hello` message with protocol version on client connect

- [x] Implement stale socket detection (for filesystem sockets)
  - Try-connect-before-unlink pattern implemented
  - Pattern from production code (electerm, nocobase, vercel/agent-browser)

- [x] Convert state file writes to async (performance fix)
  - `updateState()` is now async with 50ms debounce
  - Uses `scheduleStateWrite()` and `writeStateFile()` methods
  - Keeps file for CLI `status` command compatibility

- [x] Update `src/daemon/service.ts`
  - Initialize IPC server on daemon start
  - Broadcast state on every `setStatus()` call
  - Close IPC server on daemon stop

- [x] Add to `src/config/schema.ts`
  - Added `OverlaySchema` with `enabled` and `autoStart` fields

#### Files Changed

| File                    | Action |
| ----------------------- | ------ |
| `src/daemon/ipc.ts`     | NEW    |
| `src/daemon/service.ts` | MODIFY |
| `src/config/schema.ts`  | MODIFY |

---

### Phase 2: Overlay IPC Client

**Goal**: Connect overlay to daemon via Unix socket with graceful degradation.

#### Tasks

- [x] Create `mockup/electron-overlay/src/ipc-client.ts`
  - `IPCClient` class with EventEmitter
  - JSON Lines parsing with buffer pattern
  - Protocol version validation from `hello` message

- [x] Implement auto-reconnect with exponential backoff
  - Initial delay: 100ms, Max delay: 5000ms
  - Max 10 reconnect attempts before `maxReconnectAttemptsReached` event
  - Reset backoff on successful connection
  - Handles `ECONNREFUSED`, `ENOENT` gracefully

- [x] Handle daemon unavailable gracefully
  - Emits `daemonUnavailable` event for `ECONNREFUSED`/`ENOENT`
  - Shows `connecting` state initially

- [x] Update `mockup/electron-overlay/src/preload.ts`
  - Exposed `onDaemonState(callback)` to renderer
  - Exposed `getDaemonState()` for initial state
  - Exposed `getConnectionStatus()` for UI feedback

- [x] Create `mockup/electron-overlay/src/renderer/useDaemonState.ts`
  - React hook for daemon state subscription
  - Maps daemon status to overlay state
  - Handles `connecting`, success flash, and error states

#### Files Changed

| File                                                     | Action |
| -------------------------------------------------------- | ------ |
| `mockup/electron-overlay/src/ipc-client.ts`              | NEW    |
| `mockup/electron-overlay/src/preload.ts`                 | MODIFY |
| `mockup/electron-overlay/src/renderer/useDaemonState.ts` | NEW    |

---

### Phase 3: UI State Machine

**Goal**: Implement visual states in overlay.

#### Tasks

- [x] Update `mockup/electron-overlay/src/renderer/App.tsx`
  - Implemented overlay state machine via `getStateStyles()`
  - Added visual states: hidden, connecting, listening, recording, processing, success, error
  - Added `StatusIndicator` component for state-specific UI

- [x] Add processing animation
  - CSS pulsing dots animation in `styles.css`
  - Three dots with staggered animation delay
  - `LiveWaveform` component supports `processing` prop

- [x] Add success feedback
  - Checkmark SVG icon with draw animation
  - Green background tint
  - Auto-hide after 1.5s (in `useDaemonState`)

- [x] Add error feedback
  - Red background tint with shake animation
  - Shows error message from daemon
  - Error styling in `styles.css`

- [x] Add connecting state
  - Pulsing dots animation
  - "Connecting..." text
  - Subtle border styling

#### Files Changed

| File                                              | Action   |
| ------------------------------------------------- | -------- |
| `mockup/electron-overlay/src/renderer/App.tsx`    | MODIFIED |
| `mockup/electron-overlay/src/renderer/styles.css` | NEW      |
| `mockup/electron-overlay/src/global.d.ts`         | NEW      |

---

### Phase 4: Lifecycle Management

**Goal**: Daemon manages overlay process lifecycle.

#### Tasks

- [ ] Update `src/daemon/service.ts`
  - Spawn overlay process on daemon start (if `overlay.autoStart` enabled)
  - Track overlay PID
  - Handle overlay crash: log warning, continue without overlay (recording is priority)
  - Kill overlay on daemon stop

- [ ] Add CLI commands for overlay control
  - `hyprvox overlay status` - Show overlay running state
  - `hyprvox overlay start` - Manually start overlay
  - `hyprvox overlay stop` - Manually stop overlay
  - `hyprvox overlay restart` - Restart overlay

- [ ] Update `src/cli/health.ts`
  - Check overlay binary exists (if enabled)
  - Check overlay process running (if autoStart enabled)
  - Report overlay connection status

- [ ] Add overlay path to config
  ```typescript
  overlay: z.object({
    enabled: z.boolean().default(true),
    autoStart: z.boolean().default(true),
    binaryPath: z.string().optional(), // default: bundled path
  }).default({});
  ```

#### Files Changed

| File                    | Action |
| ----------------------- | ------ |
| `src/daemon/service.ts` | MODIFY |
| `src/cli/overlay.ts`    | NEW    |
| `src/cli/health.ts`     | MODIFY |
| `src/config/schema.ts`  | MODIFY |

---

### Phase 5: Build & Distribution

**Goal**: Bundle overlay with hyprvox.

#### Tasks

- [ ] Add build script for overlay
  - Electron-builder or similar
  - Output to `dist/overlay/` or similar

- [ ] Update `package.json`
  - Add overlay build to main build process
  - Or keep separate for now

- [ ] Test installation flow
  - `bun install` installs overlay deps
  - `bun run build` builds overlay
  - Overlay binary in expected location

#### Files Changed

| File                                   | Action |
| -------------------------------------- | ------ |
| `package.json`                         | MODIFY |
| `mockup/electron-overlay/package.json` | MODIFY |

---

## Open Questions

1. **Should overlay auto-start with daemon?**
   - Option A: Yes, always (simpler UX)
   - Option B: Configurable via `overlay.autoStart`
   - **Decision**: Option B with default `true`

2. **Where should overlay binary live?**
   - Option A: Bundled in hyprvox package
   - Option B: Separate npm package
   - Option C: Build from source
   - **Decision**: Option A for now, Option B later

3. **Should overlay show when daemon is idle?**
   - Option A: Only during recording → processing
   - Option B: Always visible, shows idle state
   - **Decision**: Option A (less screen clutter)

4. **How to handle overlay crash during recording?**
   - Option A: Restart overlay, continue recording
   - Option B: Log warning, continue without overlay
   - **Decision**: Option B (recording is priority)

---

## Testing Strategy

### Unit Tests

- [ ] `src/daemon/ipc.ts` - Socket server logic
  - Stale socket detection
  - Multiple client handling
  - Graceful shutdown
- [ ] `mockup/electron-overlay/src/ipc-client.ts` - Socket client logic
  - Auto-reconnect with backoff
  - JSON line parsing
  - Protocol version validation

### Test Utilities

- [ ] Create mock IPC server for overlay unit tests
  - Simulates daemon state broadcasts
  - Configurable delays and errors
- [ ] Create mock IPC client for daemon unit tests
  - Verifies broadcast messages
  - Simulates client connect/disconnect

### Integration Tests

- [ ] Daemon starts → overlay appears
- [ ] Hotkey press → overlay shows "listening"
- [ ] Voice detected → overlay shows waveform
- [ ] Recording stop → overlay shows "processing"
- [ ] Transcription done → overlay shows "success" → hides
- [ ] Error occurs → overlay shows "error" → hides
- [ ] Overlay crash → daemon continues recording
- [ ] Daemon restart → overlay reconnects automatically
- [ ] Daemon not running → overlay shows "connecting" then hides

### Manual Tests

- [ ] Overlay positioning (center-bottom)
- [ ] Overlay pinning (all workspaces)
- [ ] State transitions are smooth
- [ ] Auto-hide timing feels right
- [ ] Reconnect after daemon restart

---

## Rollout Plan

1. **Phase 1-2**: Core IPC (can test with manual overlay start)
2. **Phase 3**: UI states (visual polish)
3. **Phase 4**: Lifecycle (auto-start, crash handling)
4. **Phase 5**: Build/distribution (for users)

Each phase can be merged independently.

---

## Progress

| Phase                         | Status      | Completion |
| ----------------------------- | ----------- | ---------- |
| Phase 1: Daemon IPC Server    | Complete    | 100%       |
| Phase 2: Overlay IPC Client   | Complete    | 100%       |
| Phase 3: UI State Machine     | Complete    | 100%       |
| Phase 4: Lifecycle Management | Complete    | 100%       |
| Phase 5: Build & Distribution | Complete    | 100%       |

---

## Related Files

- `mockup/electron-overlay/` - Current overlay implementation
- `src/daemon/service.ts` - Daemon state machine (lines 93-132: state management)
- `docs/ARCHITECTURE.md` - Project architecture
- `docs/STT_FLOW.md` - Transcription flow

---

## References

Sources consulted for implementation patterns:

- **Node.js net module**: Official docs for Unix socket server/client
- **Bun compatibility**: Confirmed `net.createServer()` works in Bun (not `Bun.serve({ unix })` which is HTTP-based)
- **Stale socket patterns**: electerm, nocobase, vercel/agent-browser (GitHub)
- **JSON Lines parsing**: vercel/next.js turbopack, callstackincubator/agent-device (GitHub)
- **Abstract namespace sockets**: Node.js docs - Linux-only, auto-cleanup, prefix with `\0`
