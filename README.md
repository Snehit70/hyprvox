# voice-cli

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
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

#### 3. Troubleshooting
If hotkeys are not detected:
- Verify XWayland is running.
- Check if you have permissions to access input devices (try adding your user to the `input` group):
  ```bash
  sudo usermod -aG input $USER
  ```
  *Note: Log out and back in for group changes to take effect.*

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
