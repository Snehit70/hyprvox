# hyprvox

[![Build Status](https://github.com/Snehit70/hyprvox/actions/workflows/test.yml/badge.svg)](https://github.com/Snehit70/hyprvox/actions)

Voice input for AI workflows on Linux.

<!-- DEMO PLACEHOLDER: Add a GIF showing the full workflow -->

## The Problem

You're deep in a session with a coding agent. You know exactly what you want to ask — a complex refactor, a debugging question, a feature request. But now you have to type it all out.

By the time you're done, you've lost the thread.

Context switching kills flow. And typing at 40 WPM when you can speak at 150 WPM is a bottleneck you don't need.

## The Solution

Press a key. Speak. Press again. Paste.

hyprvox is a voice-to-text daemon for Linux. It runs in the background, transcribes when you need it, and puts the result on your clipboard — ready to paste into Claude, Copilot, or whatever agent you're working with.

Built for Hyprland/Wayland first. Works on X11 too.

## Quick Start

### For Humans

```bash
git clone https://github.com/Snehit70/hyprvox.git
cd hyprvox
bun install

bun run index.ts config init   # Set up API keys (Groq + Deepgram)
bun run index.ts install       # Install as systemd service
```

Press Right Ctrl to record. Press again to stop. Paste anywhere.

### For AI Agents

<details>
<summary>Click to expand setup prompt</summary>

Copy this prompt to your coding agent:

```
Install and configure hyprvox on this Linux system:

1. Clone: git clone https://github.com/Snehit70/hyprvox.git
2. Install: cd hyprvox && bun install
3. Run `bun run index.ts config init` — I'll provide API keys when prompted:
   - Groq API key (get from console.groq.com)
   - Deepgram API key (get from console.deepgram.com)
4. Install service: bun run index.ts install
5. For Hyprland, add keybind to ~/.config/hypr/hyprland.conf:
    bind = , code:105, exec, bun run /path/to/hyprvox/index.ts toggle
    # code:105 = Right Control (use `wev` to find other key codes)
6. For Hyprland overlay, add to ~/.config/hypr/UserConfigs/WindowRules.conf:
    windowrule = match:class hyprvox-overlay, float on
    windowrule = match:class hyprvox-overlay, pin on
    windowrule = match:class hyprvox-overlay, no_focus on
    windowrule = match:class hyprvox-overlay, no_shadow on
    windowrule = match:class hyprvox-overlay, no_anim on
7. Reload: hyprctl reload
8. Verify: bun run index.ts health
```

</details>

## How It Works

**Dual-engine transcription.** Audio goes to both Groq (Whisper V3) and Deepgram (Nova-3) in parallel. Results are merged with an LLM for better accuracy. If one fails, the other continues.

**Streaming or batch.** ~500ms latency in streaming mode. Higher accuracy in batch mode. Your choice.

**Runs as a daemon.** Systemd service starts on login. Always ready when you need it.

## The Overlay

A small waveform appears at the bottom of your screen while recording — visual feedback that it's listening.

![Overlay showing waveform during recording](assets/overlay.png)

For Hyprland, add these window rules:

```conf
# ~/.config/hypr/UserConfigs/WindowRules.conf
windowrule = match:class hyprvox-overlay, float on
windowrule = match:class hyprvox-overlay, pin on
windowrule = match:class hyprvox-overlay, no_focus on
windowrule = match:class hyprvox-overlay, no_shadow on
windowrule = match:class hyprvox-overlay, no_anim on
```

## Installation

### Dependencies

<details>
<summary>Click to expand</summary>

**Audio** — `alsa-utils`
- Arch: `sudo pacman -S alsa-utils`
- Ubuntu: `sudo apt install alsa-utils`
- Fedora: `sudo dnf install alsa-utils`

**Clipboard**
- Wayland: `wl-clipboard`
- X11: `xclip` or `xsel`

**Permissions**
```bash
sudo usermod -aG audio,input $USER
# Log out and back in
```

</details>

### API Keys

| Provider | Purpose | Link |
|----------|---------|------|
| Groq | Whisper V3 (fast) | [console.groq.com](https://console.groq.com/keys) |
| Deepgram | Nova-3 (accurate) | [console.deepgram.com](https://console.deepgram.com/) |

Run `bun run index.ts config init` to set them up.

## Usage

```bash
bun run index.ts status      # Check daemon
bun run index.ts health      # Test setup  
bun run index.ts history     # View past transcriptions
bun run index.ts config bind # Change hotkey
```

## Configuration

Config file: `~/.config/hypr/vox/config.json`

```json
{
  "apiKeys": { "groq": "...", "deepgram": "..." },
  "transcription": {
    "streaming": true,
    "boostWords": ["Hyprland", "WebSocket", "refactor"]
  }
}
```

**Streaming mode** — ~500ms latency, slightly lower accuracy.
**Batch mode** — 2-8 seconds, higher accuracy.
**Boost words** — Improve recognition for technical terms.

Full options: [Configuration Guide](docs/CONFIGURATION.md)

## Hyprland Setup

Add keybind for global hotkey:

```conf
# ~/.config/hypr/hyprland.conf
bind = , code:105, exec, bun run /path/to/hyprvox/index.ts toggle
# code:105 = Right Control
```

Use `wev | grep -A5 "key event"` to find key codes.

This bypasses XWayland limitations.

Full guide: [Wayland Support](docs/WAYLAND.md)

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Hotkey not working | Add user to `input` group; use compositor binds on Wayland |
| No audio | Add user to `audio` group |
| Clipboard issues | Install `wl-clipboard` (Wayland) or `xclip` (X11) |
| Service won't start | Check logs: `journalctl --user -u hyprvox -f` |

Full guide: [Troubleshooting](docs/TROUBLESHOOTING.md)

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — How it works under the hood
- [Configuration](docs/CONFIGURATION.md) — All options explained
- [CLI Commands](docs/CLI_COMMANDS.md) — Every command and flag
- [Wayland Support](docs/WAYLAND.md) — Platform-specific setup

## License

MIT
