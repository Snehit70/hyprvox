# voice-cli

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

### Wayland Support (Hyprland, GNOME, KDE)

This tool prioritizes Wayland support but relies on specific system packages to function correctly.

#### 1. Clipboard Support
For clipboard operations to work on Wayland, you **must** have `wl-clipboard` installed.

- **Arch/Hyprland**: `sudo pacman -S wl-clipboard`
- **Ubuntu/Debian**: `sudo apt install wl-clipboard`
- **Fedora**: `sudo dnf install wl-clipboard`

#### 2. Global Hotkeys & Dependencies
The daemon utilizes X11 compatibility layers for global hotkeys. Ensure **XWayland** is installed and enabled (default on most modern compositors like Hyprland).

You may also need basic X11 development libraries installed for the hotkey listener to bind correctly:

- **Ubuntu/Debian**:
  ```bash
  sudo apt install libx11-dev libxtst-dev libxi-dev
  ```
- **Fedora**:
  ```bash
  sudo dnf install libX11-devel libXtst-devel libXi-devel
  ```
- **Arch**:
  ```bash
  sudo pacman -S libx11 libxtst libxi
  ```

#### 3. Desktop Notifications
Desktop notifications are supported via `node-notifier`. On most Linux environments (GNOME, KDE), this works out of the box. For minimal environments (like Hyprland or Sway), you may need to install a notification daemon.

- **Recommended Daemons**: `dunst`, `mako`, or `swaync`.
- **Requirements**: Ensure `libnotify` is installed.
  - **Arch**: `sudo pacman -S libnotify`
  - **Ubuntu/Debian**: `sudo apt install libnotify-bin`
  - **Fedora**: `sudo dnf install libnotify`

#### 4. Troubleshooting
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

### X11 Support

For pure X11 environments, this tool requires specific system libraries for clipboard access and global hotkey detection.

#### 1. Clipboard Support
You **must** have `xclip` or `xsel` installed.

- **Ubuntu/Debian**: `sudo apt install xclip`
- **Fedora**: `sudo dnf install xclip`
- **Arch**: `sudo pacman -S xclip`

#### 2. Global Hotkeys & Dependencies
To detect global hotkeys, the following X11 development libraries are required:

- **Ubuntu/Debian**:
  ```bash
  sudo apt install libx11-dev libxtst-dev libxi-dev
  ```
- **Fedora**:
  ```bash
  sudo dnf install libX11-devel libXtst-devel libXi-devel
  ```
- **Arch**:
  ```bash
  sudo pacman -S libx11 libxtst libxi
  ```

This project was created using `bun init` in bun v1.3.3. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
