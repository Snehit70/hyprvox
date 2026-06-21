# Native GTK Waveform Overlay

The primary Hyprvox overlay is a small PyGObject process using GTK 3 and
`gtk-layer-shell`. It connects directly to the daemon's Unix socket and renders
the recorder's live 24-bin voice spectrum.

The previous Electron/Web Audio renderer is retained as a guarded fallback.
The supervisor starts it only after GTK fails, forces it onto Wayland, disables
core dumps, and stops retrying after three failures.

## Requirements

- Python 3
- PyGObject (`python3-gobject` on Fedora)
- GTK 3
- `gtk-layer-shell`

Run it directly with:

```bash
python3 overlay/hyprvox-overlay.py
```

The daemon normally starts and supervises it automatically. Layer-shell places
the click-through window at the bottom center on Wayland, keeps it above normal
windows, and prevents it from taking keyboard focus. No compositor window rules
are required.

Build the Electron fallback with:

```bash
bun run build:overlay-fallback
```
