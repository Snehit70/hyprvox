# CLI Command Reference

This document provides a comprehensive list of all commands available in the `voice-cli` tool.

## General Usage

```bash
bun run index.ts <command> [subcommand] [options]
```

## Main Commands

### `start`
Start the transcription daemon.
- **Options:**
  - `--no-supervisor`: Run the daemon directly without the auto-restarting supervisor.
  - `--daemon-worker`: (Internal) Used by the supervisor to spawn worker processes.

### `stop`
Stop the running transcription daemon.

### `restart`
Restart the transcription daemon.

### `status`
Display the current status of the daemon (PID, uptime, state, statistics).

### `install`
Install `voice-cli` as a systemd user service for the current user.

### `uninstall`
Remove the `voice-cli` systemd user service.

### `list-mics`
Scan and list available audio input devices (microphones). Use the IDs listed here in your configuration to select a specific device.

### `health`
Perform a comprehensive system health check, verifying:
- OS Environment (Wayland/X11)
- Clipboard tools availability
- Configuration validity and file permissions
- API connectivity (Groq and Deepgram)
- Audio device availability
- Daemon and systemd service status

---

## Subcommands

### `config`
Manage `voice-cli` configuration.

- **`config init`**
  - Interactively initialize a new configuration file.
  - **Options:**
    - `-f, --force`: Overwrite existing configuration file.
- **`config list`**
  - Display the current configuration (API keys are masked).
- **`config get <key>`**
  - Retrieve a specific configuration value (e.g., `apiKeys.groq`).
- **`config set <key> <value>`**
  - Update a specific configuration value.
- **`config bind`**
  - Interactively listen for a key press to set as the global hotkey.

### `boost`
Manage custom vocabulary (boost words) to improve transcription accuracy.

- **`boost list`**
  - List all currently configured boost words.
- **`boost add <words...>`**
  - Add one or more words to the boost list.
- **`boost remove <words...>`**
  - Remove one or more words from the boost list.
- **`boost clear`**
  - Remove all words from the boost list.

### `history`
Manage transcription history.

- **`history`**
  - Interactively browse transcription history with pagination.
- **`history list`**
  - List recent transcriptions.
  - **Options:**
    - `-n, --number <count>`: Number of items to display (default: 20).
- **`history search [keyword]`**
  - Search history by keyword or date.
  - **Options:**
    - `-d, --date <date>`: Search for a specific date (YYYY-MM-DD).
    - `-f, --from <date>`: Search from a specific date (YYYY-MM-DD).
    - `-t, --to <date>`: Search up to a specific date (YYYY-MM-DD).
- **`history clear`**
  - Clear all transcription history records.

### `logs`
View application logs.

- **`logs`**
  - Display recent logs.
  - **Options:**
    - `-f, --follow`: Tail the logs in real-time.
    - `-n, --number <lines>`: Number of recent lines to show (default: 20).

### `errors`
Quickly view recent errors from the logs.

- **`errors`**
  - Display the most recent error.
  - **Options:**
    - `-n, --number <count>`: Number of recent errors to display (default: 1).
