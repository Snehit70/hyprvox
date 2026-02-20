# Electron Waveform Overlay

Transparent, always-on-top waveform overlay for voice-cli using Electron.

## Features

- **Transparent window** - Blends with desktop
- **Always on top** - Stays above all windows
- **Center-bottom positioning** - Like Google Assistant/Siri
- **Live microphone input** - Real-time audio visualization
- **Static mode** - Mirrored bars from center
- **Fade edges** - Smooth gradient at edges
- **Strict TypeScript** - Full type safety

## Requirements

```bash
# Install dependencies
npm install
# or
bun install
```

## Hyprland Configuration (REQUIRED for Wayland)

For the overlay to work properly on Hyprland, add these window rules to your config:

**Edit `~/.config/hypr/hyprland.conf` or `~/.config/hypr/UserConfigs/WindowRules.conf`:**

```conf
# Voice CLI Overlay - Electron
windowrulev2 = float, class:^(voice-cli-overlay)$
windowrulev2 = pin, class:^(voice-cli-overlay)$
windowrulev2 = nofocus, class:^(voice-cli-overlay)$
windowrulev2 = noborder, class:^(voice-cli-overlay)$
windowrulev2 = noshadow, class:^(voice-cli-overlay)$
windowrulev2 = noanim, class:^(voice-cli-overlay)$
windowrulev2 = noinitialfocus, class:^(voice-cli-overlay)$
windowrulev2 = move 50% 100%, class:^(voice-cli-overlay)$
windowrulev2 = size 400 60, class:^(voice-cli-overlay)$
windowrulev2 = opacity 0.95, class:^(voice-cli-overlay)$
```

After adding the rules, reload Hyprland:
```bash
hyprctl reload
```

**Rule explanations:**

| Rule | Purpose |
|------|---------|
| `float` | Make it a floating window |
| `pin` | Show on all workspaces |
| `nofocus` | Prevent overlay from receiving focus |
| `noborder` | Remove window borders |
| `noshadow` | Remove drop shadow |
| `noanim` | Disable open/close animations |
| `noinitialfocus` | Don't steal focus on launch |
| `move 50% 100%` | Center-bottom position |
| `size 400 60` | Fixed window size |

## Build & Run

```bash
# Build TypeScript
npm run build

# Start overlay
npm start
```

## Project Structure

```text
overlay/
├── src/
│   ├── main.ts          # Electron main process
│   ├── preload.ts       # Context bridge for IPC
│   └── renderer/
│       ├── index.html   # Overlay UI
│       ├── App.tsx      # Main React component
│       └── LiveWaveform.tsx  # Canvas waveform with mic input
├── package.json
└── tsconfig.json        # Strict TypeScript config
```

## Configuration

Edit `src/main.ts` to change:

| Setting | Default | Description |
|---------|---------|-------------|
| `width` | 400 | Overlay width in pixels |
| `height` | 60 | Overlay height in pixels |
| `marginBottom` | 80 | Distance from bottom of screen |

## Waveform Options

Edit `src/renderer/App.tsx` to change:

| Option | Default | Description |
|--------|---------|-------------|
| `barWidth` | 3 | Width of each bar |
| `barGap` | 2 | Gap between bars |
| `barRadius` | 1.5 | Corner radius of bars |
| `barColor` | white | Color of bars |
| `fadeEdges` | true | Fade effect at edges |
| `mode` | static | "static" or "scrolling" |

## Notes

- Uses Web Audio API for real-time microphone visualization
- IPC integration with voice-cli daemon is built-in (daemon broadcasts state via Unix socket)
- Wayland support requires Hyprland window rules (see above)
