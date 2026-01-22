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

## Installation

Since this is a private project, you can install and run it locally using the following methods.

### 1. Using Bun (Recommended)

Clone the repository and install dependencies using [Bun](https://bun.sh):

```bash
git clone https://github.com/snehit/voice-cli.git
cd voice-cli
bun install
```

To run the daemon:
```bash
bun run index.ts
```

### 2. Using NPM

If you prefer using Node.js and NPM:

```bash
git clone https://github.com/snehit/voice-cli.git
cd voice-cli
npm install
```

To run the daemon:
```bash
npm start # or node index.ts (requires ts-node/esm or similar)
```
*Note: Using Bun is highly recommended for performance.*

### 3. Using NPX

You can run the project directly without cloning if the repository is accessible:

```bash
npx git+https://github.com/snehit/voice-cli.git
```

---

## Usage

For a detailed guide, see [Usage Guide](docs/USAGE.md).
For typical workflows and examples, see [Examples & Workflows](docs/EXAMPLES.md).
For contributing guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).

### Quick Start
1. **Start the daemon**: `bun run index.ts start` (or use the systemd service).
2. **Trigger Recording**: Press the **Right Control** key once to start recording.
3. **Stop & Transcribe**: Press the **Right Control** key again to stop.
4. **Result**: The transcript will be **appended** to your clipboard.

### Essential Commands
- `bun run index.ts status`: Check if the daemon is running and see stats.
- `bun run index.ts health`: Verify API keys and microphone setup.
- `bun run index.ts list-mics`: List available audio input devices.
- `bun run index.ts history list`: View recent transcriptions.
- `bun run index.ts config bind`: Change the global hotkey.

---

## System-wide Installation (Daemon Setup)

For a seamless "transcribe-anywhere" experience, you should install `voice-cli` as a systemd user service. This ensures the daemon starts automatically on login and runs in the background.

```bash
bun run index.ts install
```

This command will:
1. Create a systemd user service file at `~/.config/systemd/user/voice-cli.service`.
2. Enable the service to start on boot.
3. Start the service immediately.

To uninstall the service:
```bash
bun run index.ts uninstall
```

## Configuration

The configuration file is located at `~/.config/voice-cli/config.json`. For a complete reference of all available options, see the **[Configuration Guide](docs/CONFIGURATION.md)**.

### API Key Setup

`voice-cli` requires API keys from both **Groq** and **Deepgram** to function. These keys must be added to your configuration file.

#### 1. Groq API Key (Whisper V3)
Used for high-speed Whisper-based transcription.
- **Obtain Key**: [Groq Cloud Console](https://console.groq.com/keys)
- **Validation**: Must start with `gsk_`.

#### 2. Deepgram API Key (Nova-3)
Used in parallel with Groq for increased reliability and fallback support.
- **Obtain Key**: [Deepgram Console](https://console.deepgram.com/)
- **Validation**: 40-character hex string (standard) or UUID.

#### Example Configuration
```json
{
  "apiKeys": {
    "groq": "gsk_...",
    "deepgram": "00000000-0000-0000-0000-000000000000"
  }
}
```

### Environment Variables

If the configuration file is missing or keys are not provided in `config.json`, `voice-cli` will fall back to the following environment variables:

- `GROQ_API_KEY`
- `DEEPGRAM_API_KEY`

### Setup Commands

You can use the CLI to initialize or update your configuration:

```bash
# Interactive setup (prompts for keys)
bun run index.ts config init

# Set keys directly
bun run index.ts config set apiKeys.groq gsk_...
bun run index.ts config set apiKeys.deepgram 0000...

# Verify connectivity
bun run index.ts health
```

### Boost Words (Custom Vocabulary)

Improve transcription accuracy for specific terms (names, technical jargon, acronyms) by adding them to the `boostWords` array in the `transcription` section of your `config.json`.

- **Limit**: Maximum **450 words** total (calculated by splitting each entry into individual words).
- **Format**: A JSON array of strings. Phrases are supported.
- **Example**:
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

For more details on formatting, token limits, and case sensitivity, see the **[Configuration Guide: Boost Words](docs/CONFIGURATION.md#boost-words-custom-vocabulary)**.

## Linux Compatibility

### Tested Distributions

The following distributions have been tested and verified:

- **Ubuntu** (GNOME)
- **Fedora** (GNOME, KDE)
- **Arch Linux** (Hyprland, Sway)

### Wayland Support (Hyprland, GNOME, KDE)

This tool prioritizes Wayland support but relies on specific system packages to function correctly. Ensure you have installed the dependencies listed in the [Prerequisites](#prerequisites) section.

## Troubleshooting

For a comprehensive list of errors and solutions, see the **[Troubleshooting Guide](docs/TROUBLESHOOTING.md)**.

### Common Issues Quick-Fix

| Issue | Resolution |
|-------|------------|
| **Hotkey not working** | Ensure user is in `input` group: `sudo usermod -aG input $USER` (re-login required). |
| **No audio recorded** | Ensure user is in `audio` group. See [Audio Device Selection](docs/AUDIO_DEVICES.md). |
| **API Errors** | Verify API keys in `config.json` (Groq starts with `gsk_`, Deepgram is a UUID). |
| **Clipboard fail** | Install `wl-clipboard` (Wayland) or `xclip` (X11). |
| **Service fails** | Check logs: `journalctl --user -u voice-cli -f`. |

---

## Transcription History

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
