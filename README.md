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

_Note: You must log out and back in for these changes to take effect._

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

_Note: Using Bun is highly recommended for performance._

### 3. Using NPX

You can run the project directly without cloning if the repository is accessible:

```bash
npx git+https://github.com/snehit/voice-cli.git
```

---

## Usage

For a detailed guide, see [Usage Guide](docs/USAGE.md).
For typical workflows and examples, see [Examples & Workflows](docs/EXAMPLES.md).
For project structure and data flow, see [Architecture](docs/ARCHITECTURE.md).
For programmatic use, see [Programmatic API](docs/API.md).
For contributing guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).

### Quick Start

1. **Start the daemon**: `bun run index.ts start` (or use the systemd service).
2. **Trigger Recording**: Press the **Right Control** key once to start recording.
3. **Stop & Transcribe**: Press the **Right Control** key again to stop.
4. **Result**: The transcript will be **appended** to your clipboard.

For a deep dive into the underlying data flow, see [STT Flow Documentation](docs/STT_FLOW.md).

### Essential Commands

For a complete list of commands and options, see the **[CLI Command Reference](docs/CLI_COMMANDS.md)**.

- `bun run index.ts status`: Check if the daemon is running and see stats.
- `bun run index.ts health`: Verify API keys and microphone setup.
- `bun run index.ts list-mics`: List available audio input devices.
- `bun run index.ts history list`: View recent transcriptions.
- `bun run index.ts config bind`: Change the global hotkey.

---

## Exit Codes

For information on exit codes and scripting, see the **[Exit Codes Reference](docs/EXIT_CODES.md)**.

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

**Note: Only English (`en`) is supported for transcription in v1.0.**

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

### Language Support

For **v1.0**, `voice-cli` officially supports **English only**. While the configuration allows setting a language code, the internal processing is optimized for English (`en`).

For more details on formatting, token limits, and case sensitivity, see the **[Configuration Guide: Boost Words](docs/CONFIGURATION.md#boost-words-custom-vocabulary)**.

## Linux Compatibility

### Platform Compatibility Matrix

| Feature           | Wayland (Hyprland/GNOME/KDE) | X11 (GNOME/KDE/XFCE) | Required Packages / Notes                             |
| :---------------- | :--------------------------- | :------------------- | :---------------------------------------------------- |
| **Global Hotkey** | ⚠️ Partial (via XWayland)    | ✅ Native            | Wayland requires XWayland or native compositor binds. |
| **Clipboard**     | ✅ Native                    | ✅ Native            | `wl-clipboard` (Wayland) or `xclip/xsel` (X11).       |
| **Notifications** | ✅ Supported                 | ✅ Supported         | Requires `libnotify` / `notify-send`.                 |
| **Audio (ALSA)**  | ✅ Supported                 | ✅ Supported         | Works with PulseAudio and PipeWire via ALSA layer.    |

### Tested Distributions

The following distributions have been tested and verified:

- **Ubuntu 22.04+** (GNOME)
- **Fedora 39+** (GNOME, KDE)
- **Arch Linux** (Hyprland, Sway, GNOME)

### Wayland Support (Hyprland, GNOME, KDE)

`voice-cli` prioritizes Wayland support (specifically Hyprland) but relies on specific system packages and XWayland for global hotkeys.

**Important for Wayland Users:**

- **Global Hotkeys**: Since `node-global-key-listener` uses X11 XInput2, hotkeys may only trigger when an XWayland window has focus. For 100% reliability on Wayland, we recommend binding the `toggle` command directly in your compositor config (e.g., Hyprland `bind`).
- **Clipboard**: Ensure `wl-clipboard` is installed to allow the daemon to interact with the Wayland clipboard buffer.

**📖 For detailed Wayland setup instructions, see the [Wayland Support Guide](docs/WAYLAND.md).**

## Troubleshooting

For a comprehensive list of errors and solutions, see the **[Troubleshooting Guide](docs/TROUBLESHOOTING.md)**.

### Common Issues Quick-Fix

| Issue                  | Resolution                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hotkey not working** | Ensure user is in `input` group and check Wayland/XWayland status. See [Troubleshooting: Global Hotkey Issues](docs/TROUBLESHOOTING.md#global-hotkey-issues). |
| **No audio recorded**  | Ensure user is in `audio` group. See [Audio Device Selection](docs/AUDIO_DEVICES.md).                                                                         |
| **API Errors**         | Verify API keys in `config.json` (Groq starts with `gsk_`, Deepgram is a UUID).                                                                               |
| **Clipboard fail**     | Install `wl-clipboard` (Wayland) or `xclip` (X11).                                                                                                            |
| **Service fails**      | Check logs: `journalctl --user -u voice-cli -f`.                                                                                                              |

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
