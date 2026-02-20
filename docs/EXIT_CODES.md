# Exit Codes

This document lists the exit codes used by the `hyprvox` tool. These codes can be used for scripting and automation to determine the outcome of a command.

## Summary Table

| Code | Status | Description |
|------|--------|-------------|
| **0** | Success | Command completed successfully or daemon stopped cleanly. |
| **1** | Failure | General error, initialization failure, or critical daemon crash. |

---

## Exit Code Details

### 0 - Success
The command executed as expected.

- **Normal Completion**: Commands like `config list`, `history list`, `status`, etc., exit with `0` upon displaying the requested information.
- **Clean Shutdown**: When the daemon process receives a `SIGINT` (Ctrl+C) or `SIGTERM` signal, it shuts down gracefully and exits with `0`.
- **User Cancellation**: If a user cancels an interactive prompt (like `config bind`) using `Ctrl+C`, the process exits with `0`.

### 1 - General Error
The command failed due to an error or environmental issue.

- **Daemon Already Running**: Attempting to `start` the daemon when a PID file already exists and the process is active.
- **Initialization Failure**: The daemon failed to start because of a missing configuration, invalid API keys, or audio device errors.
- **Installation Error**: The `install` command failed to create systemd service files or necessary directories (usually due to permission issues).
- **Critical Failure (Supervisor)**: The daemon supervisor stops and exits with `1` if the worker process crashes more than 3 times within a 5-minute window.
- **Validation Errors**: Providing invalid arguments or failing internal validation checks.

---

## Scripting Examples

### Checking Status in a Script
```bash
if hyprvox status > /dev/null 2>&1; then
    echo "Daemon is running"
else
    echo "Daemon is stopped or dead"
fi
```

### Handling Start Failures
```bash
hyprvox start
if [ $? -ne 0 ]; then
    echo "Failed to start hyprvox. Check logs for details."
    exit 1
fi
```
