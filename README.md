# hyprvox

[![Build Status](https://github.com/Snehit70/hyprvox/actions/workflows/test.yml/badge.svg)](https://github.com/Snehit70/hyprvox/actions)

**Press a key. Speak. Paste.**  
Voice-to-text for Linux, built for AI workflows.

<!-- DEMO PLACEHOLDER: Add a GIF showing the full workflow -->

---

## Why

You're deep in a session with a coding agent. You know exactly what to say — a complex refactor, a debugging question, a long feature spec. But now you have to type it all out.

By the time you finish, the thought is gone.

Typing at 40 WPM when you speak at 150 WPM is a bottleneck you don't need. `hyprvox` closes that gap.

---

## How It Works

`hyprvox` is a background daemon. Hold a key, speak, release — your words land on the clipboard, ready to paste into Claude, Copilot, or any agent.

Under the hood:

| Engine | Model | Role |
|--------|-------|------|
| Groq | Whisper V3 | Speed |
| Deepgram | Nova-3 | Accuracy |
| LLM merge | Llama 3.3 70B | Best-of-both result |

Both engines run **in parallel**. Results merge with an LLM. If one fails, the other carries on. The merged text is validated before it ever reaches your clipboard: hallucinated outros are trimmed, prompt artifacts and reasoning leakage are blocked, injected filename/command bursts are rejected, and technical terms are preserved.

**Median latency: 882ms.** 39× faster than real-time.

---

## Quick Start

### 1 — Install system dependencies

```bash
# Fedora / RHEL
sudo dnf install -y unzip ffmpeg alsa-utils wl-clipboard libnotify

# Arch
sudo pacman -S ffmpeg alsa-utils wl-clipboard libnotify

# Ubuntu / Debian
sudo apt install ffmpeg alsa-utils unzip wl-clipboard libnotify-bin
```

On X11, install `xclip` instead of `wl-clipboard`.

### 2 — Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
```

Confirm Bun is available:

```bash
bun --version
```

### 3 — Install hyprvox

Use the published CLI for normal installs:

```bash
bun add -g hyprvox
hyprvox --help
```

Or run from a source checkout:

```bash
git clone https://github.com/Snehit70/hyprvox.git
cd hyprvox
bun install
bun run index.ts --help
```

### 4 — Configure

Run the setup wizard:

```bash
hyprvox setup
```

The wizard detects your distro, desktop session, missing commands, config state, microphone, Wayland hotkey strategy, and systemd service state. It keeps reporting the remaining next step until setup is complete.

For source checkouts, use:

```bash
bun run index.ts setup
```

For Docker, CI, or non-interactive diagnosis:

```bash
hyprvox setup --check --json
```

Manual config-only setup is still available:

```bash
hyprvox config init   # Enter your Groq + Deepgram API keys
```

Source checkout equivalent: `bun run index.ts config init`.

| Key | Get one at |
|-----|-----------|
| Groq | [console.groq.com](https://console.groq.com/keys) |
| Deepgram | [console.deepgram.com](https://console.deepgram.com) |

### 5 — Verify the setup before installing the service

```bash
hyprvox setup --check
hyprvox list-mics
hyprvox health
```

Source checkout equivalents:

```bash
bun run index.ts setup --check
bun run index.ts list-mics
bun run index.ts health
```

`health` should confirm the config, API keys, microphone, clipboard command, and notification support. On headless servers, clipboard, notification, and microphone checks can fail by design.

To change config later, run the interactive editor:

```bash
hyprvox config
```

For direct commands and scripting, run `hyprvox config --help`.

### 6 — Install and start the user service

Check whether the daemon is already running before installing the service:

```bash
hyprvox status
```

If it is already running manually, stop it first:

```bash
hyprvox stop
```

Then install the systemd user service:

```bash
hyprvox install   # Installs as a systemd user service
hyprvox status
```

Source checkout equivalents: `bun run index.ts install` and `bun run index.ts status`.

---

## Keybinds

### Hyprland / Wayland

Add to `~/.config/hypr/hyprland.conf`:

```conf
bind = , code:105, exec, hyprvox toggle
# code:105 = Right Control — use `wev | grep -A5 "key event"` to find others
```

### X11 / GNOME / KDE

The built-in Right Ctrl hotkey works out of the box.

---

## The Overlay

A waveform appears at the bottom of your screen while recording — visible confirmation it's listening.

![Overlay showing waveform during recording](assets/overlay.png)

For Hyprland, add to `~/.config/hypr/UserConfigs/WindowRules.conf`:

```conf
windowrule = match:class hyprvox-overlay, float on
windowrule = match:class hyprvox-overlay, pin on
windowrule = match:class hyprvox-overlay, no_focus on
windowrule = match:class hyprvox-overlay, no_shadow on
windowrule = match:class hyprvox-overlay, no_anim on
windowrule = match:class hyprvox-overlay, move ((monitor_w-window_w)*0.5) (monitor_h-window_h-50)
```

---

## Commands

```bash
hyprvox toggle       # Start / stop recording
hyprvox status       # Daemon status
hyprvox health       # Full system check
hyprvox stats        # Interactive stats dashboard
hyprvox stats --summary  # Plain stats summary
hyprvox history      # Past transcriptions
hyprvox logs         # Tail daemon logs
hyprvox errors       # Last error
hyprvox boost add    # Add custom vocabulary
hyprvox config init  # Reconfigure API keys
```

---

## Configuration

Config lives at `~/.config/hypr/vox/config.json`:

```json
{
  "apiKeys": { "groq": "...", "groqFallback": "...", "deepgram": "..." },
  "transcription": {
    "streaming": true,
    "formattingMode": "clean",
    "boostWords": ["Hyprland", "WebSocket", "refactor"]
  }
}
```

| Option | Values | Effect |
|--------|--------|--------|
| `streaming` | `true` / `false` | Stream Deepgram during recording for lower latency |
| `mergeModel` | Groq model ID | LLM used for transcript merge; default is `llama-3.3-70b-versatile` |
| `formattingMode` | `verbatim` `clean` `structured` | How the merged output is shaped |
| `boostWords` | string list | Improves recognition of technical terms |

Full reference → [docs/CONFIGURATION.md](docs/CONFIGURATION.md)

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Hotkey not firing (Wayland) | Use compositor bind — see [Hyprland Setup](#keybinds) |
| Hotkey not firing (X11) | Add user to `input` group, re-login |
| No audio captured | `sudo usermod -aG audio $USER` then re-login |
| Empty recording after restart | Run one more recording; if it repeats, test with `arecord -D default -f S16_LE -r 16000 -c 1 -d 1 /tmp/mic.wav` |
| Clipboard not updating | Install `wl-clipboard` (Wayland) or `xclip` (X11) |
| Service won't start | `journalctl --user -u hyprvox -f` |

> **Headless servers (EC2, etc.):** health checks for clipboard, notifications, and mic will fail by design. The install is valid if `hyprvox --help` works — full transcription needs a machine with audio input.

Full guide → [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

---

## For AI Agents

<details>
<summary>Setup prompt — click to expand</summary>

```
Install and configure hyprvox on this Linux system:

1. Install deps: sudo dnf install -y unzip ffmpeg alsa-utils wl-clipboard libnotify
2. Install Bun: curl -fsSL https://bun.sh/install | bash && export BUN_INSTALL="$HOME/.bun" && export PATH="$BUN_INSTALL/bin:$PATH"
3. Clone: git clone https://github.com/Snehit70/hyprvox.git && cd hyprvox && bun install
4. Configure: bun run index.ts config init  (I'll provide Groq + Deepgram keys when prompted)
5. Run the setup wizard: bun run index.ts setup
6. Verify non-interactively: bun run index.ts setup --check
7. If needed, install service manually: bun run index.ts install
8. For Hyprland, add to ~/.config/hypr/hyprland.conf:
     bind = , code:105, exec, bun run /path/to/hyprvox/index.ts toggle
9. Add overlay window rules to ~/.config/hypr/UserConfigs/WindowRules.conf (see README)
10. Reload: hyprctl reload
11. Verify: bun run index.ts status && bun run index.ts health
```

</details>

---

## Docs

- [Architecture](docs/ARCHITECTURE.md) — internals and data flow
- [STT Flow](docs/STT_FLOW.md) — transcription and quality pipeline end-to-end
- [Configuration](docs/CONFIGURATION.md) — every option
- [CLI Commands](docs/CLI_COMMANDS.md) — every command and flag
- [Wayland Support](docs/WAYLAND.md) — platform-specific setup

---

## License

MIT
