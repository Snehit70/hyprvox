# Usage Guide

This guide covers everything you need to know about using `hyprvox` effectively. For practical examples and typical workflows, see the **[Examples & Workflows](EXAMPLES.md)** document.

## 1. Daemon Management

The `hyprvox` daemon runs in the background and listens for your hotkey to start recording.

Use the published CLI for normal installs:

```bash
bun add -g hyprvox
```

If you are running from a source checkout, replace `hyprvox` with `bun run index.ts` in the commands below.

### First-Time Setup

Run the interactive setup wizard:

```bash
hyprvox setup
```

For Docker, CI, or non-interactive diagnostics:

```bash
hyprvox setup --check --json
```

Manual fallback:

```bash
hyprvox config init
hyprvox setup --check
hyprvox install
```

If `hyprvox status` shows a manually started daemon before `hyprvox install`, stop it with `hyprvox stop` so systemd owns the daemon cleanly. In containers or headless sessions, setup reports audio, clipboard, and service checks as host-only follow-up work.

### Starting the Daemon
If you've installed it as a systemd service (recommended):
```bash
systemctl --user start hyprvox
```

To run it manually in the foreground:
```bash
hyprvox start
```

### Stopping the Daemon
Systemd:
```bash
systemctl --user stop hyprvox
```

Manual:
```bash
hyprvox stop
```

### Checking Status
You can see if the daemon is running, its current state (idle, recording, processing), and basic statistics:
```bash
hyprvox status
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
hyprvox history list
```

To see more items:
```bash
hyprvox history list -n 20
```

### Clearing History
```bash
hyprvox history clear
```

---

## 5. Health and Monitoring

### Health Check
Verify your configuration, API connectivity, and microphone access:
```bash
hyprvox health
```

### Stats Dashboard
Open the interactive terminal dashboard:
```bash
hyprvox stats
```

For non-interactive output:
```bash
hyprvox stats --summary
hyprvox stats --json
```

### Microphone Selection
If you have multiple microphones, you can list them and select the correct one:
```bash
hyprvox list-mics
```
For more information, see the **[Audio Device Selection Guide](AUDIO_DEVICES.md)**.

### Viewing Logs
`hyprvox` stores logs in `~/.config/hypr/vox/logs/` by default. You can view them via the CLI:
```bash
# See recent logs
hyprvox logs

# Follow logs in real-time
hyprvox logs --follow
```

### Viewing Errors
Specifically view recent errors:
```bash
hyprvox errors
```

---

## 6. Configuration

### Changing the Hotkey
You can rebind the hotkey using the interactive binder:
```bash
hyprvox config bind
```

### Interactive Config Updates
To revisit API keys, microphone selection, and session-specific behavior:
```bash
hyprvox config
```

Direct commands are still available for scripting. Run `hyprvox config --help` to list them.

### Managing API Keys
```bash
# List current keys (masked)
hyprvox config list

# Set a key directly
hyprvox config set apiKeys.groq gsk_your_key
```

### Boost Words
To improve accuracy for specific names or technical terms:
```bash
hyprvox boost add "Sisyphus" "hyprvox" "Hyprland"
```
*(Limit: 450 words. See [Configuration Guide](CONFIGURATION.md#boost-words-custom-vocabulary) for details.)*
