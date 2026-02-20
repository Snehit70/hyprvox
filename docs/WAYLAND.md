# Wayland Support Guide

This guide provides comprehensive information about using `hyprvox` on Wayland compositors, with special focus on Hyprland.

## Table of Contents

- [Overview](#overview)
- [Current Implementation Status](#current-implementation-status)
- [Hyprland Setup](#hyprland-setup)
- [Other Wayland Compositors](#other-wayland-compositors)
- [Troubleshooting](#troubleshooting)
- [Best Practices](#best-practices)

---

## Overview

`hyprvox` is designed to work on both X11 and Wayland environments. However, due to Wayland's security model and the underlying hotkey library's X11 dependency, there are important considerations for Wayland users.

### Key Points

- ✅ **Clipboard**: Fully supported via `wl-clipboard`
- ✅ **Audio Recording**: Fully supported (ALSA/PipeWire)
- ✅ **Notifications**: Fully supported via `libnotify`
- ⚠️ **Global Hotkeys**: Partial support via XWayland (see details below)

---

## Current Implementation Status

### How Hotkeys Work on Wayland

`hyprvox` uses the `node-global-key-listener` library, which relies on X11's XInput2 protocol for global hotkey detection. On Wayland, this has specific implications:

#### XWayland-Based Hotkeys

**What Works:**

- Hotkeys trigger when **XWayland windows** have focus
- Works with legacy X11 applications running under XWayland
- No additional configuration needed for basic functionality

**Limitations:**

- Hotkeys **do not trigger** when native Wayland windows have focus
- Unreliable for "transcribe-anywhere" use case on pure Wayland sessions
- Depends on XWayland being enabled in your compositor

**Example Scenario:**

```
✅ Works: Focus on Discord (XWayland) → Press hotkey → Recording starts
❌ Fails: Focus on Firefox (native Wayland) → Press hotkey → Nothing happens
```

### Recommended Solution: Native Compositor Bindings

For reliable, system-wide hotkey support on Wayland, we recommend binding the `hyprvox` toggle command directly in your compositor configuration. This bypasses the XWayland limitation entirely.

---

## Hyprland Setup

Hyprland is a dynamic tiling Wayland compositor with excellent keybinding support. Here's how to set up `hyprvox` with native Hyprland bindings.

### Prerequisites

1. **Install hyprvox** and ensure it works:

   ```bash
   cd /path/to/hyprvox
   bun install
   bun run index.ts health
   ```

2. **Install required dependencies**:

   ```bash
   # Arch Linux
   sudo pacman -S wl-clipboard libnotify alsa-utils

   # Ubuntu/Debian
   sudo apt install wl-clipboard libnotify-bin alsa-utils

   # Fedora
   sudo dnf install wl-clipboard libnotify alsa-utils
   ```

3. **Start the daemon**:

   ```bash
   # Option 1: Manual start
   bun run index.ts start

   # Option 2: Install as systemd service (recommended)
   bun run index.ts install
   ```

### Hyprland Configuration

Add the following to your `~/.config/hypr/hyprland.conf`:

#### Method 1: Toggle Command (Recommended)

This method uses the built-in toggle command, which handles start/stop automatically:

```conf
# Hyprvox: Toggle recording with Right Control
bind = , code:105, exec, bun run /path/to/hyprvox/index.ts toggle

# Alternative: Use a different key (e.g., Super+V)
bind = SUPER, V, exec, bun run /path/to/hyprvox/index.ts toggle
```

**Key Code Reference:**

- `code:105` = Right Control
- `code:37` = Left Control
- `code:64` = Left Alt
- `code:108` = Right Alt

To find key codes:

```bash
wev | grep -A5 "key event"
```

#### Method 2: Separate Start/Stop Bindings

If you prefer separate keys for start and stop:

```conf
# Start recording
bind = , code:105, exec, bun run /path/to/hyprvox/index.ts start-recording

# Stop recording (same key, or different)
bind = SHIFT, code:105, exec, bun run /path/to/hyprvox/index.ts stop-recording
```

#### Method 3: Using Absolute Paths

For systemd service or if `bun` is not in PATH:

```conf
bind = , code:105, exec, /home/yourusername/.bun/bin/bun run /home/yourusername/hyprvox/index.ts toggle
```

### Reload Hyprland Configuration

After editing `hyprland.conf`:

```bash
# Reload configuration
hyprctl reload

# Or restart Hyprland (logout/login)
```

### Verify Setup

1. **Check daemon status**:

   ```bash
   bun run index.ts status
   ```

2. **Test the binding**:
   - Press your configured hotkey
   - You should see a notification: "Recording started"
   - Speak something
   - Press the hotkey again
   - You should see: "Transcribing..." followed by the result

3. **Check logs if issues occur**:

   ```bash
   # Daemon logs
   journalctl --user -u hyprvox -f

   # Or direct log file
   tail -f ~/.config/hyprvox/logs/daemon.log
   ```

---

## Other Wayland Compositors

### Sway

Sway uses a similar configuration syntax to i3. Add to `~/.config/sway/config`:

```conf
# Toggle recording with Right Control
bindsym --no-repeat Control_R exec bun run /path/to/hyprvox/index.ts toggle

# Alternative: Use Mod+V
bindsym $mod+v exec bun run /path/to/hyprvox/index.ts toggle
```

Reload configuration:

```bash
swaymsg reload
```

### GNOME (Wayland)

GNOME uses the Settings app for custom keyboard shortcuts:

1. Open **Settings** → **Keyboard** → **Keyboard Shortcuts**
2. Scroll to **Custom Shortcuts**
3. Click **+** to add a new shortcut
4. **Name**: Hyprvox Toggle
5. **Command**: `bun run /path/to/hyprvox/index.ts toggle`
6. **Shortcut**: Press your desired key combination

**Note**: GNOME may not support single-key bindings like "Right Control" alone. Use combinations like `Ctrl+Alt+V`.

### KDE Plasma (Wayland)

1. Open **System Settings** → **Shortcuts** → **Custom Shortcuts**
2. Right-click → **New** → **Global Shortcut** → **Command/URL**
3. **Trigger**: Set your desired key
4. **Action**: `bun run /path/to/hyprvox/index.ts toggle`

### River

Add to `~/.config/river/init`:

```bash
riverctl map normal None XF86AudioRecord spawn "bun run /path/to/hyprvox/index.ts toggle"
```

---

## Troubleshooting

### Hotkey Not Working

**Symptom**: Pressing the configured key does nothing.

**Diagnosis**:

1. Check if daemon is running:

   ```bash
   bun run index.ts status
   ```

2. Test the command manually:

   ```bash
   bun run index.ts toggle
   ```

3. Check compositor logs:

   ```bash
   # Hyprland
   cat /tmp/hypr/$(ls -t /tmp/hypr/ | head -n 1)/hyprland.log | grep hyprvox

   # Sway
   journalctl --user -u sway -f
   ```

**Common Fixes**:

- Ensure `bun` is in PATH or use absolute path
- Verify the path to `hyprvox` is correct
- Check file permissions: `chmod +x index.ts`
- Reload compositor configuration

### XWayland Hotkeys Unreliable

**Symptom**: Built-in hotkey listener only works sometimes.

**Solution**: This is expected behavior on Wayland. Use native compositor bindings instead (see setup sections above).

### Clipboard Not Working

**Symptom**: Transcription succeeds but clipboard is not updated.

**Fix**:

```bash
# Install wl-clipboard
sudo pacman -S wl-clipboard  # Arch
sudo apt install wl-clipboard  # Ubuntu/Debian

# Verify it works
echo "test" | wl-copy
wl-paste
```

### Permission Denied Errors

**Symptom**: "Permission denied" when accessing audio device.

**Fix**:

```bash
# Add user to audio group
sudo usermod -aG audio $USER

# Log out and back in for changes to take effect
```

### Daemon Not Starting on Login

**Symptom**: Daemon not running after system boot.

**Fix**:

```bash
# Install systemd service
bun run index.ts install

# Enable and start
systemctl --user enable hyprvox
systemctl --user start hyprvox

# Check status
systemctl --user status hyprvox
```

---

## Best Practices

### 1. Use Native Compositor Bindings

For the most reliable experience on Wayland, always use native compositor bindings rather than relying on the XWayland-based hotkey listener.

### 2. Install as Systemd Service

This ensures the daemon starts automatically on login:

```bash
bun run index.ts install
```

### 3. Choose Non-Conflicting Keys

Avoid keys that are commonly used by other applications:

- ❌ Avoid: `Super+V` (may conflict with clipboard managers)
- ❌ Avoid: `Ctrl+C` (conflicts with copy)
- ✅ Good: `Right Control` (rarely used alone)
- ✅ Good: `Super+Shift+V` (unlikely to conflict)

### 4. Test Before Committing

Always test your keybinding configuration before relying on it:

```bash
# Test the command manually first
bun run index.ts toggle

# Then test the keybinding
# Press your configured key and verify it works
```

### 5. Monitor Logs During Setup

Keep logs open while testing:

```bash
# Terminal 1: Watch daemon logs
journalctl --user -u hyprvox -f

# Terminal 2: Test keybindings
# Press your configured keys
```

### 6. Disable Built-in Hotkey Listener (Optional)

If you're using native compositor bindings exclusively, you can disable the built-in hotkey listener to avoid XWayland dependency:

Edit `~/.config/hyprvox/config.json`:

```json
{
  "behavior": {
    "hotkey": "disabled"
  }
}
```

Then use only compositor bindings for control.

---

## Additional Resources

- [Hyprland Wiki: Binds](https://wiki.hyprland.org/Configuring/Binds/)
- [Sway Wiki: Key Bindings](https://github.com/swaywm/sway/wiki)
- [hyprvox Troubleshooting Guide](./TROUBLESHOOTING.md)
- [hyprvox Configuration Guide](./CONFIGURATION.md)

---

## Contributing

Found a better way to configure `hyprvox` on your Wayland compositor? Please contribute your configuration examples by opening a pull request!
