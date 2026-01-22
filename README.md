# voice-cli

**Production-ready STT daemon for Linux with global hotkeys and clipboard history.**

`voice-cli` is a high-performance speech-to-text daemon for Linux (Wayland/X11) that provides global transcription via Groq (Whisper V3) and Deepgram (Nova-3). It features low-latency parallel execution, automatic clipboard history appending, and systemd integration for a seamless "transcribe-anywhere" experience.

## Prerequisites

Before installing `voice-cli`, ensure your system meets the following requirements:

### 1. Runtime Environment
- **Node.js**: >= 20.0.0 (LTS recommended)
- **Bun**: Latest version (used for package management and as the runtime)

### 2. Linux System Dependencies
The tool requires several system-level packages to handle audio recording, global hotkeys, and clipboard operations.

#### **Audio Recording**
- `alsa-utils` (specifically `arecord`)
  - **Arch**: `sudo pacman -S alsa-utils`
  - **Ubuntu/Debian**: `sudo apt install alsa-utils`
  - **Fedora**: `sudo dnf install alsa-utils`

#### **Clipboard Support**
- **Wayland**: `wl-clipboard`
- **X11**: `xclip` or `xsel`

#### **Global Hotkey Support**
Requires X11 development libraries (even on Wayland via XWayland):
- **Ubuntu/Debian**: `sudo apt install libx11-dev libxtst-dev libxi-dev`
- **Fedora**: `sudo dnf install libX11-devel libXtst-devel libXi-devel`
- **Arch**: `sudo pacman -S libx11 libxtst libxi`

#### **Notifications**
- `libnotify`
  - **Arch**: `sudo pacman -S libnotify`
  - **Ubuntu/Debian**: `sudo apt install libnotify-bin`
  - **Fedora**: `sudo dnf install libnotify`

### 3. User Permissions
Your user must have permission to access audio devices and input events. Add your user to the `audio` and `input` groups:

```bash
sudo usermod -aG audio,input $USER
```
*Note: You must log out and back in for these changes to take effect.*

## Getting Started

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

## Installation

To install as a systemd user service:

```bash
bun run index.ts install
```

This will create a systemd service, enable it to start on boot, and start it immediately.

To uninstall:

```bash
bun run index.ts uninstall
```

## Configuration

The configuration file is located at `~/.config/voice-cli/config.json`.

### Boost Words (Custom Vocabulary)

You can improve transcription accuracy for specific terms (names, technical jargon, acronyms) by adding them to the `boostWords` array in the `transcription` section.

- **Limit**: Maximum 450 words total.
- **Usage**:
  ```json
  "transcription": {
    "language": "en",
    "boostWords": [
      "Sisyphus",
      "voice-cli",
      "Groq",
      "Deepgram",
      "Wayland",
      "Hyprland"
    ]
  }
  ```

## Linux Compatibility

### Tested Distributions

The following distributions have been tested and verified:

- **Ubuntu** (GNOME)
- **Fedora** (GNOME, KDE)
- **Arch Linux** (Hyprland, Sway)

### Wayland Support (Hyprland, GNOME, KDE)

This tool prioritizes Wayland support but relies on specific system packages to function correctly. Ensure you have installed the dependencies listed in the [Prerequisites](#prerequisites) section.

#### Troubleshooting
If hotkeys are not detected:
- Verify XWayland is running.
- Check if you have permissions to access input devices (try adding your user to the `input` group):
  ```bash
  sudo usermod -aG input $USER
  ```
  *Note: Log out and back in for group changes to take effect.*

If notifications are not appearing:
- Verify a notification daemon is running (e.g., `pgrep dunst`).
- Test manually with `notify-send "test"`.

### systemd Troubleshooting

If you encounter issues when running `voice-cli` as a systemd service:

#### 1. Check Service Status
Verify if the service is active and running:
```bash
systemctl --user status voice-cli
```

#### 2. View Service Logs
If the service fails to start or behaves unexpectedly, check the logs:
```bash
# View recent logs
journalctl --user -u voice-cli -n 50

# Tail logs in real-time
journalctl --user -u voice-cli -f
```

#### 3. Common Issues & Fixes

- **`bun` not found**: Ensure `bun` is in your PATH. The installation script attempts to detect your bun path, but if it fails, you may need to manually edit the service file at `~/.config/systemd/user/voice-cli.service` and set the correct `ExecStart` path.
- **Environment Variables**: The service requires `DISPLAY` or `WAYLAND_DISPLAY` to send notifications and detect hotkeys. If these change (e.g., after a logout), you may need to restart the service:
  ```bash
  systemctl --user restart voice-cli
  ```
- **Audio/Input Permissions**: If the daemon cannot access your microphone or detect hotkeys, ensure your user is in the `audio` and `input` groups:
  ```bash
  sudo usermod -aG audio,input $USER
  ```
  *Note: Log out and back in for group changes to take effect.*

#### 4. Application Logs
In addition to systemd logs, `voice-cli` maintains its own structured logs in `~/.config/voice-cli/logs/`. These contain detailed information about transcriptions and internal errors.

### Transcription History

All successful transcriptions are stored in `~/.config/voice-cli/history.json`. You can view or clear the history using the CLI:

```bash
# List last 10 transcriptions
bun run index.ts history list

# List last 20 transcriptions
bun run index.ts history list -n 20

# Clear history
bun run index.ts history clear
```

This project was created using `bun init` in bun v1.3.3. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
