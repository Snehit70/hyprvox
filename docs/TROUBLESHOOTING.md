# Troubleshooting Guide

This guide covers common issues and their solutions for `hyprvox`.

## Table of Contents
- [Daemon Startup Issues](#daemon-startup-issues)
- [API Key Issues](#api-key-issues)
- [Microphone & Audio Issues](#microphone--audio-issues)
- [Global Hotkey Issues](#global-hotkey-issues)
- [Clipboard Issues](#clipboard-issues)
- [Systemd & Service Issues](#systemd--service-issues)
- [Transcription Issues](#transcription-issues)

---

## Daemon Startup Issues

### Daemon Already Running
- **Symptom**: `Error: Daemon is already running (PID: XXXX)`
- **Fix**: 
  - Stop the existing daemon: `hyprvox stop`.
  - If the PID file is stale (process is dead), delete it: `rm ~/.config/hyprvox/daemon.pid`.

### Configuration Validation Failed
- **Symptom**: `Config validation failed: ...`
- **Fix**: 
  - Ensure API keys are present and correctly formatted (Groq starts with `gsk_`, Deepgram is a UUID).
  - Check `~/.config/hyprvox/config.json` for syntax errors.
  - Reset config if needed: `rm ~/.config/hyprvox/config.json && hyprvox config init`.

### Permission Denied (Input/Hotkey)
- **Symptom**: "Failed to bind global hotkey" or native errors related to `/dev/input/`.
- **Fix**: 
  - Add user to `input` group: `sudo usermod -aG input $USER` and **log out/in**.
  - Ensure XWayland is available if using a Wayland compositor.

### Crash Loop Protection
- **Symptom**: `Daemon has crashed too many times and will not auto-restart.`
- **Fix**: 
  - This happens if the daemon crashes 3 times in 5 minutes.
  - Check logs for the root cause: `journalctl --user -u hyprvox -f` or `cat ~/.config/hyprvox/logs/daemon.log`.
  - Fix the underlying issue and restart manually.

---

## API Key Issues

### Groq API Key Invalid
- **Symptom**: "Groq API key is invalid or missing" or "Groq: Invalid API Key" in logs.
- **Fix**: 
  - Ensure your key starts with `gsk_`.
  - Obtain a new key at the [Groq Cloud Console](https://console.groq.com/keys).
  - Verify it is correctly placed in `~/.config/hyprvox/config.json`.

### Deepgram API Key Invalid
- **Symptom**: "Deepgram API key is invalid or missing" or "Deepgram: Invalid API Key" in logs.
- **Fix**:
  - Ensure your key is a valid UUID (e.g., `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
  - Obtain a new key at the [Deepgram Console](https://console.deepgram.com/).

### Rate Limit Exceeded
- **Symptom**: "Rate limit exceeded" notification.
- **Fix**: Wait a few seconds before trying again. If you frequently hit limits, consider upgrading your API tier or checking for runaway processes.

---

## Microphone & Audio Issues

### No Microphone Detected
- **Symptom**: "No microphone detected or could not be opened".
- **Fix**:
  - Check physical connection.
  - Ensure your user is in the `audio` group: `sudo usermod -aG audio $USER` (re-login required).
  - Run `arecord -l` to see available hardware devices.
  - Verify the correct device index is set in your config.

### Microphone Busy (Device Busy)
- **Symptom**: "Microphone is busy or already in use" or `EBUSY` error.
- **Fix**:
  - Close other apps using the mic (Discord, Zoom, Browser tabs).
  - Use `fuser /dev/snd/*` to identify the process using the audio device.
  - Restart audio services: `systemctl --user restart pipewire` or `pulseaudio -k`.

### Silent Audio / No Sound
- **Symptom**: "No audio detected in the recording" or empty transcripts.
- **Fix**:
  - Check system settings to ensure the microphone isn't muted.
  - Verify the input gain in your sound settings (GNOME/KDE/Pavucontrol).

---

## Global Hotkey Issues

### Hotkey Not Detected (General)
- **Symptom**: Pressing the hotkey does nothing.
- **Fixes**:
  - **Permissions**: Ensure your user is in the `input` group: `sudo usermod -aG input $USER` (re-login required).
  - **Conflicting Keys**: Ensure no other application (like your window manager or Discord) is globally intercepting the same key.
  - **Binary Permissions**: The underlying listener binary might lack execution permissions. Run:
    ```bash
    chmod +x ./node_modules/node-global-key-listener/bin/X11KeyServer
    ```

### Wayland vs X11 Issues
`hyprvox` uses `node-global-key-listener`, which relies on the X11 XInput2 protocol. This has specific implications for Wayland users.

#### Wayland (Hyprland, GNOME Wayland, KDE Wayland)
- **Problem**: Global hotkeys may only work when an XWayland window is focused. They will **not** trigger while a native Wayland window is active.
- **Workarounds**:
  - **Focus XWayland**: Click on an XWayland-compatible application (like Discord or older apps) before using the hotkey.
  - **Native Keybinds**: If `hyprvox` hotkeys are unreliable on your compositor, you can bind a key natively in your WM/DE to trigger the daemon via CLI:
    - **Hyprland**: Add `bind = , code:105, exec, bun run /path/to/hyprvox/index.ts toggle` to your config.
    - **GNOME**: Use Settings -> Keyboard -> Keyboard Shortcuts -> Custom Shortcuts.
- **XWayland Requirement**: Ensure XWayland is enabled in your compositor settings.

#### X11
- **Problem**: The hotkey works but sometimes stops after a system update.
- **Fix**: Reinstall dependencies and ensure `libx11-dev`, `libxtst-dev`, and `libxi-dev` are installed.

### Failed to Bind Hotkey
- **Symptom**: "Failed to bind global hotkey" error on startup.
- **Fix**:
  - Verify the hotkey name in `config.json` is correct (e.g., `Right Control`).
  - Use `bun run index.ts config bind` to interactively set a valid key.
  - Ensure the `DISPLAY` environment variable is set if running as a systemd service.

---

## Clipboard Issues

### Transcription Not Appending
- **Symptom**: Transcript is generated but not added to clipboard.
- **Fix**:
  - **Wayland**: Install `wl-clipboard`.
  - **X11**: Install `xclip` or `xsel`.
  - Check the fallback file at `~/.config/hyprvox/transcriptions.txt` to see if the transcript was saved there.

### Clipboard Access Denied
- **Symptom**: "Clipboard access denied" notification.
- **Fix**: Ensure the required clipboard utilities are in your `PATH`.

---

## Systemd & Service Issues

### Bun Not Found
- **Symptom**: Service fails with "command not found: bun".
- **Fix**: The installation script attempts to find `bun`. If it fails, manually edit `~/.config/systemd/user/hyprvox.service` and provide the absolute path to `bun` in `ExecStart`.

### Service Fails to Start
- **Symptom**: `systemctl --user status hyprvox` shows "failed".
- **Fix**:
  - Check logs: `journalctl --user -u hyprvox -f`.
  - Ensure `DISPLAY` or `WAYLAND_DISPLAY` environment variables are available to the service.

---

## Transcription Issues

### Recording Too Short
- **Symptom**: "Recording was too short (less than 0.6 seconds)".
- **Fix**: Speak for at least one second. The system rejects extremely short clips to avoid accidental triggers.

### Accuracy is Poor
- **Symptom**: Transcripts contain errors for specific names or terms.
- **Fix**: Add those terms to the `boostWords` array in `~/.config/hyprvox/config.json`. Note the 450-word limit.
