# Voice CLI - Phase 11-26 (Daemon, Testing, Documentation)

**Tagline:** "Speak, we will get it right"

## Overview

This PRD covers Phase 11-26: Daemon management, systemd integration, testing, and documentation.

**Prerequisites:** Phase 1-10 must be completed first (core functionality).

## Tasks - Phase 11-26 Only

### Phase 11: Daemon Core (Priority: Critical)
- [ ] Implement daemon main loop (event-driven)
- [ ] Add daemon state management (idle/recording/processing/error)
- [ ] Implement daemon start command
- [ ] Implement daemon stop command
- [ ] Implement daemon restart command
- [ ] Implement daemon status command
- [ ] Add PID file management (`~/.config/voice-cli/daemon.pid`)
- [ ] Add daemon already running detection
- [ ] Implement graceful shutdown (cleanup resources)

### Phase 12: Daemon Auto-Restart (Priority: High)
- [ ] Implement crash detection
- [ ] Add restart counter (track crashes in 5-minute window)
- [ ] Implement auto-restart logic (max 3 crashes in 5 minutes)
- [ ] Add alert notification when restart limit reached
- [ ] Stop daemon after max restarts (prevent infinite loops)
- [ ] Log all crashes with stack traces

### Phase 13: systemd Integration (Priority: High)
- [ ] Create systemd service file (`voice-cli.service`)
- [ ] Add installation script for systemd service
- [ ] Implement `voice-cli install` command (install systemd service)
- [ ] Implement `voice-cli uninstall` command (remove systemd service)
- [ ] Add systemd service enable on install
- [ ] Add systemd service start on system boot
- [ ] Test systemd integration on Ubuntu
- [ ] Test systemd integration on Fedora
- [ ] Test systemd integration on Arch

### Phase 14: Health Monitoring (Priority: High)
- [ ] Implement `voice-cli health` command
- [ ] Check daemon status (running/stopped, PID, uptime)
- [ ] Check Groq API connectivity (ping with test request)
- [ ] Check Deepgram API connectivity (ping with test request)
- [ ] Check microphone detection (list available devices)
- [ ] Check clipboard access (test write/read)
- [ ] Display last error (if any)
- [ ] Display transcription count (today/total)
- [ ] Format health output (colored, user-friendly)

### Phase 15: History Management (Priority: High)
- [ ] Implement history storage (`~/.config/voice-cli/history.json`)
- [ ] Add history entry on each transcription (timestamp + text)
- [ ] Implement `voice-cli history` command (display past transcriptions)
- [ ] Add history pagination (show last 20, option to show more)
- [ ] Add history search (filter by date, keyword)
- [ ] Add history clear command (`voice-cli history clear`)
- [ ] Format history output (readable timestamps, truncated text)

### Phase 16: Logging System (Priority: High)
- [ ] Implement structured logging (JSON format)
- [ ] Create log directory (`~/.config/voice-cli/logs/`)
- [ ] Add log rotation (daily logs, keep last 7 days)
- [ ] Log all transcriptions with full details (groqText, deepgramText, duration, etc.)
- [ ] Log all errors with stack traces
- [ ] Log daemon lifecycle events (start, stop, restart, crash)
- [ ] Add log level configuration (debug, info, warn, error)
- [ ] Implement `voice-cli logs` command (tail recent logs)

### Phase 17: CLI Interactive Setup (Priority: Medium)
- [ ] Implement `voice-cli config` command
- [ ] Create interactive prompts for API keys (Groq, Deepgram)
- [ ] Add API key validation (format check)
- [ ] Create interactive hotkey selection
- [ ] Add hotkey validation (valid key combinations)
- [ ] Create boost words management (add/remove/list)
- [ ] Add boost words validation (max 450 words)
- [ ] Save config to file after setup
- [ ] Display success message with next steps

### Phase 18: Error Handling & User-Friendly Messages (Priority: High)
- [ ] Create error message templates (user-friendly, actionable)
- [ ] Add error for invalid Groq API key (show setup instructions)
- [ ] Add error for invalid Deepgram API key (show setup instructions)
- [ ] Add error for no microphone detected (show troubleshooting steps)
- [ ] Add error for microphone permission denied (show how to grant)
- [ ] Add error for clipboard access denied (show fallback option)
- [ ] Add error for daemon already running (show how to stop)
- [ ] Add error for config file corrupted (show how to reset)
- [ ] Add error for both APIs failing (show retry instructions)
- [ ] Log all errors to file for debugging

### Phase 19: Testing - Unit Tests (Priority: High)
- [ ] Write unit tests for config file reader/writer
- [ ] Write unit tests for API key validation
- [ ] Write unit tests for boost words validation
- [ ] Write unit tests for hotkey validation
- [ ] Write unit tests for audio duration validation
- [ ] Write unit tests for transcript merging logic
- [ ] Write unit tests for error handling paths
- [ ] Write unit tests for daemon state management
- [ ] Achieve 80%+ test coverage

### Phase 20: Testing - Integration Tests (Priority: High)
- [ ] Write integration test for Groq API (with test API key)
- [ ] Write integration test for Deepgram API (with test API key)
- [ ] Write integration test for LLM merger (with sample transcripts)
- [ ] Write integration test for clipboard write (verify append mode)
- [ ] Write integration test for daemon lifecycle (start/stop/restart)
- [ ] Write integration test for config file operations
- [ ] Write integration test for history storage

### Phase 21: Documentation - README (Priority: High)
- [ ] Write project description and tagline
- [ ] Document prerequisites (Node.js, Bun, Linux)
- [ ] Write installation instructions (npm/bun/npx)
- [ ] Document API key setup (Groq, Deepgram)
- [ ] Write usage guide (daemon start, hotkey, history, health)
- [ ] Document configuration options (config file format)
- [ ] Add troubleshooting section (common errors)
- [ ] Add examples (typical workflows)
- [ ] Add contributing guidelines

### Phase 22: Documentation - Configuration Reference (Priority: Medium)
- [ ] Document all config file options
- [ ] Document API key format and where to get them
- [ ] Document hotkey options (valid key combinations)
- [ ] Document boost words format and limits
- [ ] Document audio device selection
- [ ] Document language options (English only for v1.0)
- [ ] Provide example config file with comments

### Phase 23: Documentation - Troubleshooting Guide (Priority: Medium)
- [ ] Document "Daemon won't start" (common causes and fixes)
- [ ] Document "Hotkey not working" (Wayland vs X11 issues)
- [ ] Document "No microphone detected" (permission issues)
- [ ] Document "API key invalid" (how to verify keys)
- [ ] Document "Clipboard not working" (Wayland clipboard issues)
- [ ] Document "Transcription quality poor" (boost words, audio quality)
- [ ] Document "Daemon crashes frequently" (check logs, report issue)

### Phase 24: Documentation - Architecture (Priority: Low)
- [ ] Document project structure (feature-based layout)
- [ ] Document daemon architecture (event loop, state machine)
- [ ] Document STT flow (audio → Groq/Deepgram → LLM → clipboard)
- [ ] Document error handling strategy
- [ ] Document testing strategy
- [ ] Create architecture diagrams (if helpful)

### Phase 25: Documentation - API Documentation (Priority: Low)
- [ ] Document programmatic API (if exposing for other tools)
- [ ] Document CLI commands (all available commands)
- [ ] Document command options and flags
- [ ] Document exit codes (for scripting)
- [ ] Provide API usage examples

### Phase 26: Polish & Final Testing (Priority: High)
- [ ] Test full workflow on Hyprland (Wayland)
- [ ] Test full workflow on GNOME (Wayland)
- [ ] Test full workflow on KDE (Wayland)
- [ ] Test full workflow on X11 (if supported)
- [ ] Test on Ubuntu (latest LTS)
- [ ] Test on Fedora (latest)
- [ ] Test on Arch (latest)
- [ ] Verify clipboard APPEND mode (critical test)
- [ ] Verify daemon auto-restart (crash recovery)
- [ ] Verify all error messages are user-friendly
- [ ] Run full test suite (unit + integration)
- [ ] Fix any remaining bugs
- [ ] Optimize performance (if time permits)

## Success Criteria for Phase 11-26

- [ ] Daemon starts on system boot via systemd
- [ ] Daemon commands work (start/stop/restart/status)
- [ ] Daemon auto-restarts on crash (max 3 in 5 minutes)
- [ ] Health monitoring works (check daemon, APIs, mic, clipboard)
- [ ] History management works (store, view, search, clear)
- [ ] Logging system works (structured logs, rotation)
- [ ] CLI interactive setup works (config command)
- [ ] Error messages are user-friendly and actionable
- [ ] Tests pass with 80%+ coverage (unit + integration)
- [ ] Documentation is complete (README, config reference, troubleshooting, architecture, API)
- [ ] Works on Hyprland (Wayland) - primary target
- [ ] Works on other Linux distros (Ubuntu, Fedora, Arch)
- [ ] systemd integration works (install/uninstall/enable/start)

## Notes for Ralphy

- **Prerequisites**: Phase 1-10 must be completed and working
- **Daemon Focus**: This phase adds daemon management on top of core functionality
- **systemd Required**: Linux daemon management via systemd
- **Testing Critical**: 80%+ coverage required
- **Documentation Complete**: All 5 types of docs required
- **Code Quality**: TypeScript strict mode, minimal `any`, self-documenting code
