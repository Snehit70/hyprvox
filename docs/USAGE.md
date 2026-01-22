# Usage Guide

This guide covers everything you need to know about using `voice-cli` effectively. For practical examples and typical workflows, see the **[Examples & Workflows](EXAMPLES.md)** document.

## 1. Daemon Management

The `voice-cli` daemon runs in the background and listens for your hotkey to start recording.

### Starting the Daemon
If you've installed it as a systemd service (recommended):
```bash
systemctl --user start voice-cli
```

To run it manually in the foreground:
```bash
bun run index.ts start
```

### Stopping the Daemon
Systemd:
```bash
systemctl --user stop voice-cli
```

Manual:
```bash
bun run index.ts stop
```

### Checking Status
You can see if the daemon is running, its current state (idle, recording, processing), and basic statistics:
```bash
bun run index.ts status
```

Example output:
```text
Status: Running (PID: 12345)
State:  IDLE
Uptime: 3600s
Today:  15
Total:  142
Errors: 0
Last:   1/22/2026, 3:00:00 PM
```

---

## 2. Using the Hotkey

`voice-cli` uses a global hotkey to trigger transcription.

### Default Hotkey
The default hotkey is **Right Control**.

### Toggle Mode
The hotkey operates in **toggle mode**:
1. **Press Once**: Recording starts. You will receive a desktop notification.
2. **Speak**: Speak clearly into your microphone.
3. **Press Again**: Recording stops. Transcription begins automatically.

### Transcription Process
1. Audio is captured and processed in parallel using Groq (Whisper V3) and Deepgram (Nova-3).
2. The best transcript is generated (or merged if both succeed).
3. The result is **appended** to your clipboard.
4. You receive a success notification.

---

## 3. Clipboard Behavior

**CRITICAL:** `voice-cli` never overwrites your clipboard. It always **appends** the transcribed text to your existing clipboard content.

- If your clipboard contains "Previous text ", and you transcribe "Hello world", your clipboard will now contain "Previous text Hello world".
- This ensures you never lose important information when using the tool.

---

## 4. History Management

`voice-cli` keeps a local history of your transcriptions.

### Viewing History
List the last 10 transcriptions:
```bash
bun run index.ts history list
```

To see more items:
```bash
bun run index.ts history list -n 20
```

### Clearing History
```bash
bun run index.ts history clear
```

---

## 5. Health and Monitoring

### Health Check
Verify your configuration, API connectivity, and microphone access:
```bash
bun run index.ts health
```

### Viewing Logs
`voice-cli` stores logs in `~/.config/voice-cli/logs/`. You can view them via the CLI:
```bash
# See recent logs
bun run index.ts logs

# Follow logs in real-time
bun run index.ts logs --tail
```

### Viewing Errors
Specifically view recent errors:
```bash
bun run index.ts errors
```

---

## 6. Configuration

### Changing the Hotkey
You can rebind the hotkey using the interactive binder:
```bash
bun run index.ts config bind
```

### Managing API Keys
```bash
# List current keys (masked)
bun run index.ts config list

# Set a key directly
bun run index.ts config set apiKeys.groq gsk_your_key
```

### Boost Words
To improve accuracy for specific names or technical terms:
```bash
bun run index.ts boost add "Sisyphus" "voice-cli" "Hyprland"
```
*(Limit: 450 words. See [Configuration Guide](CONFIGURATION.md#boost-words-custom-vocabulary) for details.)*
