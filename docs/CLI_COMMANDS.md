# CLI Command Reference

This document provides a comprehensive list of all commands available in the `hyprvox` tool.

## General Usage

For a published/global install:

```bash
hyprvox <command> [subcommand] [options]
```

For a source checkout:

```bash
bun run index.ts <command> [subcommand] [options]
```

## First-Time Setup

```bash
# Interactive setup wizard.
hyprvox setup

# Non-interactive setup diagnosis for Docker/CI.
hyprvox setup --check --json

# Manual fallback.
hyprvox config init
hyprvox setup --check
```

If `hyprvox status` shows a manually started daemon before service installation, stop it with `hyprvox stop` first. For a source checkout, replace `hyprvox` with `bun run index.ts`.

## Main Commands

### `start`
Start the transcription daemon.
- **Options:**
  - `--no-supervisor`: Run the daemon directly without the auto-restarting supervisor.
  - `--daemon-worker`: (Internal) Used by the supervisor to spawn worker processes.
  - `--help`: Display help for the start command.

### `stop`
Stop the running transcription daemon.
- **Options:**
  - `--help`: Display help for the stop command.

### `restart`
Restart the transcription daemon.
- **Options:**
  - `--help`: Display help for the restart command.

### `status`
Display the current status of the daemon (PID, uptime, state, statistics).
- **Options:**
  - `--help`: Display help for the status command.

### `install`
Install `hyprvox` as a systemd user service for the current user.

Recommended after `config init`, `list-mics`, and `health` have passed. The command writes `~/.config/systemd/user/hyprvox.service`, runs `systemctl --user daemon-reload`, enables the service, and starts it.

- **Options:**
  - `--help`: Display help for the install command.

### `setup`
Interactively set up `hyprvox` and diagnose the host environment.

The setup command detects Linux distro, Wayland/X11/headless session, container state, required commands, config validity, daemon status, and service installation. In interactive mode it can create/update config, select a microphone, recommend Wayland compositor binding behavior, and install the service.

- **Options:**
  - `--check`: Run setup checks without changing anything.
  - `--json`: Print setup check output as JSON. Implies check mode.
  - `--dry-run`: Show what setup would change without writing.
  - `--skip-service`: Do not install or start the systemd user service.
  - `--help`: Display help for the setup command.

### `uninstall`
Remove the `hyprvox` systemd user service.
- **Options:**
  - `--help`: Display help for the uninstall command.

### `list-mics`
Scan and list available audio input devices (microphones). Use the IDs listed here in your configuration to select a specific device.
- **Options:**
  - `--help`: Display help for the list-mics command.

### `health`
Perform a comprehensive system health check.
- **Options:**
  - `--help`: Display help for the health command.

### `stats`
Show transcription usage, latency, duration, engine, daemon, and recent-history stats.

By default, this opens an interactive OpenTUI dashboard when stdout is a TTY. Use direct output modes for scripts or remote sessions.

- **Options:**
  - `--summary`: Print a plain text summary.
  - `--json`: Print the full stats summary as JSON.
  - `--help`: Display help for the stats command.

---

## Subcommands

### `config`
Manage `hyprvox` configuration.

- **`config`**
  - Launch the interactive configuration flow. Use this by default when changing setup after installation.
  - **Options:**
    - `--help`: Display direct config subcommands.
- **`config init`**
  - Interactively initialize a new configuration file.
  - **Options:**
    - `-f, --force`: Overwrite existing configuration file.
    - `--help`: Display help for this subcommand.
- **`config list`**
  - Display the current configuration (API keys are masked).
  - **Options:**
    - `--help`: Display help for this subcommand.
- **`config get <key>`**
  - Retrieve a specific configuration value (e.g., `apiKeys.groq`).
  - **Options:**
    - `--help`: Display help for this subcommand.
- **`config set <key> <value>`**
  - Update a specific configuration value.
  - **Options:**
    - `--help`: Display help for this subcommand.
- **`config setup`**
  - Interactively update API keys, microphone selection, and session-specific behavior without reinstalling the service.
  - **Options:**
    - `--help`: Display help for this subcommand.
- **`config bind`**
  - Interactively listen for a key press to set as the global hotkey.
  - **Options:**
    - `--help`: Display help for this subcommand.

### `boost`
Manage custom vocabulary (boost words) to improve transcription accuracy.

- **`boost list`**
  - List all currently configured boost words.
  - **Options:**
    - `--help`: Display help for this subcommand.
- **`boost lexicon`**
  - Show the computed project lexicon used for technical term preservation.
  - **Options:**
    - `--help`: Display help for this subcommand.
- **`boost add <words...>`**
  - Add one or more words to the boost list.
  - **Options:**
    - `--help`: Display help for this subcommand.
- **`boost remove <words...>`**
  - Remove one or more words from the boost list.
  - **Options:**
    - `--help`: Display help for this subcommand.
- **`boost clear`**
  - Remove all words from the boost list.
  - **Options:**
    - `--help`: Display help for this subcommand.

### `history`
Manage transcription history.

- **`history`**
  - Interactively browse transcription history with pagination.
  - **Options:**
    - `--help`: Display help for this subcommand.
- **`history list`**
  - List recent transcriptions.
  - **Options:**
    - `-n, --number <count>`: Number of items to display (default: 20).
    - `--help`: Display help for this subcommand.
- **`history search [keyword]`**
  - Search history by keyword or date.
  - **Options:**
    - `-d, --date <date>`: Search for a specific date (YYYY-MM-DD).
    - `-f, --from <date>`: Search from a specific date (YYYY-MM-DD).
    - `-t, --to <date>`: Search up to a specific date (YYYY-MM-DD).
    - `--help`: Display help for this subcommand.
- **`history clear`**
  - Clear all transcription history records.
  - **Options:**
    - `--help`: Display help for this subcommand.

### `logs`
View application logs.

- **`logs`**
  - Display recent logs.
  - **Options:**
    - `-f, --follow`: Tail the logs in real-time.
    - `-n, --number <lines>`: Number of recent lines to show (default: 20).
    - `--help`: Display help for this subcommand.

### `errors`
Quickly view recent errors from the logs.

- **`errors`**
  - Display the most recent error.
  - **Options:**
    - `-n, --number <count>`: Number of recent errors to display (default: 1).
    - `--help`: Display help for this subcommand.
