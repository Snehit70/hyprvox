# Audio Visualization Overlay

`voice-cli` includes an optional real-time audio visualization overlay that displays waveform animations during recording sessions.

## Overview

The visualization system consists of two components:

1. **Node.js Daemon** (`src/overlay/manager.ts`) - Spawns the overlay process and streams audio amplitude data
2. **Rust Overlay Binary** (`overlay/`) - Renders the waveform using Wayland layer-shell protocol

**Architecture:**
```
┌─────────────────┐
│  Audio Recorder │
│   (Node.js)     │
└────────┬────────┘
         │ PCM audio chunks
         ▼
┌─────────────────┐
│   Amplitude     │
│   Calculator    │
└────────┬────────┘
         │ RMS values (0.0-1.0)
         ▼
┌─────────────────┐      Unix Socket       ┌─────────────────┐
│ Overlay Manager │ ──────────────────────► │  Rust Overlay   │
│   (Node.js)     │  /tmp/voice-cli-overlay │  (Layer Shell)  │
└─────────────────┘                         └─────────────────┘
                                                     │
                                                     ▼
                                            ┌─────────────────┐
                                            │ Wayland Display │
                                            │  (Top Layer)    │
                                            └─────────────────┘
```

## Features

- **Real-time waveform rendering** - Smooth 30 FPS animations
- **Wayland native** - Uses layer-shell protocol for overlay positioning
- **Low overhead** - Rust binary is only 1.4MB, minimal CPU usage
- **Automatic lifecycle** - Starts/stops with recording sessions
- **Non-intrusive** - Positioned at top-center, doesn't block interaction

## Requirements

### System Dependencies

- **Wayland compositor** with layer-shell support (Hyprland, Sway, KDE Plasma 5.27+, GNOME 45+)
- **Rust toolchain** (1.70+) for building the overlay binary

### Install Rust

If you don't have Rust installed:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

## Building the Overlay

The overlay binary must be built before enabling visualization:

```bash
# From project root
bun run build:overlay

# Or manually
cd overlay
cargo build --release
```

This creates the binary at `overlay/target/release/voice-overlay` (~1.4MB).

**Development build** (faster compilation, larger binary):
```bash
bun run build:overlay:dev
```

## Configuration

Enable visualization in `~/.config/voice-cli/config.json`:

```json
{
  "apiKeys": {
    "groq": "gsk_...",
    "deepgram": "..."
  },
  "visualization": {
    "enabled": true
  }
}
```

**Default:** `enabled: false` (visualization is opt-in)

## Usage

Once enabled, the overlay automatically:

1. **Starts** when the daemon starts (if `visualization.enabled: true`)
2. **Shows waveform** during recording (animated based on audio amplitude)
3. **Hides** when recording stops
4. **Stops** when the daemon stops

No manual interaction required.

## Verification

Check if the overlay is working:

```bash
# 1. Verify binary exists
ls -lh overlay/target/release/voice-overlay

# 2. Run health check
bun run index.ts health

# 3. Check daemon logs
journalctl --user -u voice-cli -f | grep -i overlay
```

Expected output in logs:
```
Visualization overlay started
```

## Troubleshooting

### Binary Not Found

**Error:** `Overlay binary not found`

**Solution:**
```bash
bun run build:overlay
bun run index.ts health  # Verify
```

### Overlay Doesn't Appear

**Possible causes:**

1. **Compositor doesn't support layer-shell**
   - Check: `echo $XDG_CURRENT_DESKTOP`
   - Supported: Hyprland, Sway, KDE Plasma 5.27+, GNOME 45+
   - Not supported: X11 compositors, older GNOME/KDE versions

2. **Binary failed to start**
   - Check logs: `journalctl --user -u voice-cli -f`
   - Look for: "Failed to start visualization overlay"

3. **Socket connection failed**
   - Check: `ls -l /tmp/voice-cli-overlay.sock`
   - If missing, overlay binary didn't start

### Waveform Not Animating

**Possible causes:**

1. **No audio input**
   - Verify microphone: `bun run index.ts list-mics`
   - Test recording: Start recording and speak

2. **Amplitude calculation issue**
   - Check logs for amplitude values
   - Should see: `amplitude: 0.X` during speech

### Performance Issues

The overlay is designed to be lightweight, but if you experience issues:

1. **Disable visualization:**
   ```json
   "visualization": { "enabled": false }
   ```

2. **Check CPU usage:**
   ```bash
   ps aux | grep voice-overlay
   ```
   Should be <1% CPU when idle, <5% during recording

## Technical Details

### Amplitude Calculation

Audio amplitude is calculated using RMS (Root Mean Square) with exponential smoothing:

```typescript
// Smoothing factor: 0.3 (30% new value, 70% previous)
smoothedAmplitude = (0.3 * currentRMS) + (0.7 * previousAmplitude)
```

This provides smooth transitions without jitter.

### IPC Protocol

Communication uses Unix domain sockets with newline-delimited JSON messages:

```json
{"amplitude": 0.45, "recording": true}
{"amplitude": 0.52, "recording": true}
{"amplitude": 0.38, "recording": false}
```

Each message contains:
- `amplitude` (float): RMS amplitude value from 0.0 to 1.0
- `recording` (boolean): Whether recording is active

### Rendering

- **Backend:** tiny-skia (software rendering)
- **Frame rate:** 30 FPS
- **Resolution:** 400x80 pixels
- **Position:** Top-center, 20px from top edge
- **Layer:** Overlay layer (above windows, below notifications)

### Dependencies

Rust crates used:
- `layershellev` (0.14) - Wayland layer-shell protocol
- `tiny-skia` (0.11) - 2D rendering
- `tokio` (1.0) - Async runtime for socket handling

## Disabling Visualization

To disable:

1. **Temporary** (current session):
   ```bash
   bun run index.ts stop
   # Edit config.json: "enabled": false
   bun run index.ts start
   ```

2. **Permanent:**
   ```json
   "visualization": { "enabled": false }
   ```
   Then restart the daemon.

## Future Enhancements

Potential improvements (not yet implemented):

- Customizable colors and themes
- Position configuration (top/bottom/left/right)
- Multiple visualization styles (bars, circle, spectrum)
- Opacity/transparency settings
- Size configuration

## See Also

- [Architecture Documentation](ARCHITECTURE.md) - Overall system design
- [Wayland Support Guide](WAYLAND.md) - Wayland-specific setup
- [Configuration Guide](CONFIGURATION.md) - All config options
