# Usage Guide

This guide covers everything you need to know about using `hyprvox` effectively. For practical examples and typical workflows, see the **[Examples & Workflows](EXAMPLES.md)** document.

## 1. Daemon Management

The `hyprvox` daemon runs in the background and listens for your hotkey to start recording.

### Starting the Daemon
If you've installed it as a systemd service (recommended):
```bash
systemctl --user start hyprvox
```

To run it manually in the foreground:
```bash
bun run index.ts start
```

### Stopping the Daemon
Systemd:
```bash
systemctl --user stop hyprvox
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

`hyprvox` uses a global hotkey to trigger transcription.

### Default Hotkey
The default hotkey is **Right Control**.

### Toggle Mode
The hotkey operates in **toggle mode**:
1. **Press Once**: Recording starts. You will receive a desktop notification.
2. **Speak**: Speak clearly into your microphone.
3. **Press Again**: Recording stops. Transcription begins automatically.

### Transcription Process
1. Audio is captured and processed in parallel using Groq (Whisper V3) and Deepgram (Nova-3).
2. The best transcript is generated via an LLM merger (Llama 3.3 70B). See **[STT Flow Documentation](STT_FLOW.md)** for details.
3. The result is **appended** to your clipboard.
4. You receive a success notification.

---

## 3. Clipboard Behavior

**CRITICAL:** `hyprvox` never overwrites your clipboard. It always **appends** the transcribed text to your existing clipboard content.

- If your clipboard contains "Previous text ", and you transcribe "Hello world", your clipboard will now contain "Previous text Hello world".
- This ensures you never lose important information when using the tool.

---

## 4. History Management

`hyprvox` keeps a local history of your transcriptions.

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

### Microphone Selection
If you have multiple microphones, you can list them and select the correct one:
```bash
bun run index.ts list-mics
```
For more information, see the **[Audio Device Selection Guide](AUDIO_DEVICES.md)**.

### Viewing Logs
`hyprvox` stores logs in `~/.config/hyprvox/logs/`. You can view them via the CLI:
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
bun run index.ts boost add "Sisyphus" "hyprvox" "Hyprland"
```
*(Limit: 450 words. See [Configuration Guide](CONFIGURATION.md#boost-words-custom-vocabulary) for details.)*
