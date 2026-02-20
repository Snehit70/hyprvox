# Hyprvox - Product Requirements Document

**Tagline:** "Speak, we will get it right"

## Overview

Hyprvox is a production-ready, system-wide speech-to-text daemon for Linux that runs in the background and transcribes voice to clipboard via a global hotkey. Built for developers and coders who need fast, accurate voice input for their workflows, agents, and tools.

## Tech Stack

- **Runtime**: Node.js >=20 (LTS)
- **Language**: TypeScript (strict mode, minimal `any` usage)
- **Package Manager**: Bun (primary), npm/npx compatible
- **Audio Capture**: TBD - research production-ready library for Linux
- **Global Hotkey**: `node-global-key-listener` (cross-platform, no root)
- **STT Engines**: Groq (Whisper Large V3) + Deepgram (Nova-3)
- **LLM**: Groq (Llama 3.3 70B) for transcript merging
- **Testing**: Vitest (80%+ coverage target)
- **Linting**: Biome (fast, all-in-one)
- **Logging**: Structured logging (for debugging user issues)

## Architecture

- **Pattern**: Feature-based structure (`/daemon`, `/audio`, `/transcribe`, `/output`, `/cli`, `/config`)
- **Code Style**: Mixed/pragmatic (use what fits best)
- **Configuration**: `~/.config/hyprvox/config.json` + environment variables
- **Daemon Management**: systemd service + built-in commands (start/stop/status/health)
- **Hotkey Behavior**: Toggle mode (press once to start, press again to stop)
- **Default Hotkey**: Right Control key

## Platform Support

- **Primary**: Linux with Wayland (Hyprland priority)
- **Secondary**: X11 support if possible
- **Distros**: All major Linux distributions (Ubuntu, Fedora, Arch, etc.)
- **Future**: WSL support (v2.0)

## Data Models

### Transcription History (User-Facing)

```typescript
interface HistoryEntry {
  timestamp: Date; // ISO 8601 format
  text: string; // Final merged transcription
}
```

### Transcription Log (Debugging)

```typescript
interface TranscriptionLog {
  id: string; // Unique ID (timestamp-based)
  timestamp: Date; // When recorded
  text: string; // Final merged text
  groqText?: string; // Raw Groq result
  deepgramText?: string; // Raw Deepgram result
  duration: number; // Recording length (seconds)
  model: string; // Models used (e.g., "groq+deepgram")
  boostWords?: string[]; // Custom vocabulary used
  processingTime: number; // Time to process (ms)
  error?: string; // Error message if failed
}
```

### Configuration Schema

```typescript
interface Config {
  apiKeys: {
    groq: string;
    deepgram: string;
  };
  hotkey: string; // e.g., "RightControl", "F8"
  boostWords: string[]; // Max 450 words
  audioDevice?: string; // Optional: specific mic device
  language: string; // Default: "en" (English only for v1.0)
}
```

### Daemon State

```typescript
interface DaemonState {
  status:
    | "idle"
    | "starting"
    | "recording"
    | "stopping"
    | "processing"
    | "error";
  pid: number;
  uptime: number; // Seconds since start
  lastTranscription?: Date;
  errorCount: number;
  restartCount: number;
  health: {
    groqApi: boolean;
    deepgramApi: boolean;
    microphone: boolean;
    clipboard: boolean;
  };
}
```

## Core Features (v1.0)

### 1. Daemon with Global Hotkey

- Background service that runs on system startup
- Listens for global hotkey (default: Right Control)
- Toggle mode: press to start recording, press again to stop
- Auto-restart on crash (max 3 crashes in 5 minutes, then stop + alert)
- systemd service integration for Linux

### 2. Audio Recording

- Capture microphone input on hotkey press
- Minimum recording length: 0.6 seconds (reject shorter)
- Maximum recording length: 5 minutes (auto-stop)
- Warnings at 4 minutes and 4.5 minutes (desktop notification)
- Silent audio detection (warn if no audio detected)

### 3. Dual STT Transcription

- Parallel execution: Groq (Whisper Large V3) + Deepgram (Nova-3)
- Groq: Word-level accuracy, technical vocabulary
- Deepgram: Superior formatting (punctuation, numbers, casing)
- Fallback: If one fails, use the other
- Retry logic: Max 2 attempts with short backoff (prioritize speed)

### 4. LLM Merger

- Use Groq (Llama 3.3 70B) to merge both transcripts
- Trust Groq for actual words
- Trust Deepgram for formatting and structure
- Post-processing: Remove hallucinations, fix grammar

### 5. Clipboard Output

- **CRITICAL**: APPEND to clipboard history (NEVER overwrite)
- Copy final transcription to clipboard
- Preserve previous clipboard content
- Desktop notification: "Transcription copied to clipboard"

### 6. CLI History

- Store unlimited text transcriptions
- Command: `hyprvox history` to view past transcriptions
- Format: timestamp + text
- No audio files stored (privacy)
- Logs stored separately with full details

### 7. Interactive CLI Setup

- Command: `hyprvox config` to open configuration
- Interactive prompts for API keys (Groq, Deepgram)
- Hotkey selection with validation
- Boost words management (max 450 words)
- Fallback: Manual config file editing if TUI fails

### 8. Health Monitoring

- Command: `hyprvox health` to check system status
- Check daemon status (running/stopped)
- Check API connectivity (Groq, Deepgram)
- Check microphone detection
- Check clipboard access
- Display uptime, transcription count, last error

### 9. Custom Vocabulary

- Boost words: User-provided terms (names, technical jargon)
- Max 450 words (~500 tokens at 4 chars/token)
- Passed to both Groq and Deepgram APIs
- Stored in config file

### 10. Desktop Notifications

- Recording started
- Recording stopped
- Transcription ready (copied to clipboard)
- Errors (API failures, microphone issues, etc.)
- Warnings (approaching 5-minute limit)

## Features & Tasks

### Phase 1: Project Foundation (Priority: Critical) ✅ COMPLETED

- [x] Initialize Bun project with TypeScript (strict mode)
- [x] Set up project structure (feature-based: `/daemon`, `/audio`, `/transcribe`, `/output`, `/cli`, `/config`)
- [x] Configure Biome for linting and formatting
- [x] Configure Vitest for testing
- [x] Create `package.json` with scripts (start, dev, test, lint, build)
- [x] Set up structured logging library (pino)
- [x] Create `.gitignore` (node_modules, logs, config files with secrets)
- [x] Create `tsconfig.json` with strict mode enabled

### Phase 2: Configuration Management (Priority: Critical)

- [x] Create config schema with TypeScript interfaces
- [x] Implement config file reader (`~/.config/hyprvox/config.json`)
- [x] Implement config file writer with validation
- [x] Add API key format validation (Groq, Deepgram)
- [x] Add hotkey validation (valid key combinations)
- [x] Add boost words validation (max 450 words)
- [x] Create default config template
- [x] Add environment variable support (fallback to env vars)
- [x] Create config directory on first run (`~/.config/hyprvox/`)
- [x] Set proper file permissions (chmod 600 for config file)

### Phase 3: Audio Capture (Priority: Critical)

- [x] Install node-record-lpcm16 package for audio recording
- [x] If node-record-lpcm16 fails, try sox-audio or mic package as fallback
- [x] Implement microphone detection and listing
- [x] Implement audio recording start/stop
- [x] Add minimum recording length validation (0.6 seconds)
- [x] Add maximum recording length limit (5 minutes)
- [x] Implement recording duration tracking
- [x] Add silent audio detection (warn if no audio)
- [x] Implement audio format conversion (to format required by STT APIs)
- [x] Add error handling for microphone permission denied
- [x] Add error handling for no microphone detected

### Phase 4: Global Hotkey System (Priority: Critical)

- [x] Install and configure `node-global-key-listener`
- [x] Implement hotkey registration (default: Right Control)
- [x] Implement toggle mode (press to start, press to stop)
- [x] Add hotkey state management (idle/recording)
- [x] Add hotkey configuration from config file
- [x] Document Wayland compatibility requirements in README
- [x] Document X11 compatibility requirements in README
- [x] Add error handling for hotkey registration failure
- [x] Add hotkey conflict detection (if key already in use)

### Phase 5: STT Integration - Groq (Priority: Critical)

- [x] Install Groq SDK
- [x] Implement Groq API client with authentication
- [x] Implement audio upload to Groq (Whisper Large V3)
- [x] Add boost words support (custom vocabulary)
- [x] Add language detection (English-only validation)
- [x] Implement retry logic (max 2 attempts, short backoff)
- [x] Add timeout handling (fail fast)
- [x] Add error handling for invalid API key
- [x] Add error handling for API timeout
- [x] Add error handling for rate limits

### Phase 6: STT Integration - Deepgram (Priority: Critical)

- [x] Install Deepgram SDK
- [x] Implement Deepgram API client with authentication
- [x] Implement audio upload to Deepgram (Nova-3)
- [x] Add boost words support (custom vocabulary)
- [x] Implement retry logic (max 2 attempts, short backoff)
- [x] Add timeout handling (fail fast)
- [x] Add error handling for invalid API key
- [x] Add error handling for API timeout
- [x] Add error handling for rate limits

### Phase 7: Dual STT Orchestration (Priority: Critical)

- [x] Implement parallel execution (Promise.all for Groq + Deepgram)
- [x] Add fallback logic (if one fails, use the other)
- [x] Add error handling for both APIs failing
- [x] Implement result aggregation (collect both transcripts)
- [x] Add processing time tracking
- [x] Log both raw transcripts for debugging

### Phase 8: LLM Merger (Priority: Critical)

- [x] Implement Groq LLM client (Llama 3.3 70B)
- [x] Create merge prompt (trust Groq for words, Deepgram for formatting)
- [x] Implement transcript merging logic
- [x] Add post-processing (remove hallucinations, fix grammar)
- [x] Add fallback (if LLM fails, use Groq transcript only)
- [x] Add error handling for LLM API failures
- [x] Test merge quality with sample transcripts

### Phase 9: Clipboard Integration (Priority: Critical) ✅ COMPLETED

- [x] Install clipboardy package for clipboard operations
- [x] Test with wl-clipboard fallback for Wayland compatibility
- [x] Implement clipboard write with APPEND mode (NEVER overwrite)
- [x] Add error handling for clipboard access denied
- [x] Add fallback (if clipboard fails, save to file)
- [x] Verify previous clipboard content is preserved
- [x] Document platform-specific clipboard behavior in README

### Phase 10: Desktop Notifications (Priority: High) ✅ COMPLETED

- [x] Install notification library (e.g., `node-notifier`)
- [x] Implement notification for recording started
- [x] Implement notification for recording stopped
- [x] Implement notification for transcription ready
- [x] Implement notification for errors (API failures, mic issues)
- [x] Implement notification for warnings (4min, 4.5min limits)
- [x] Document notification compatibility for GNOME/KDE/Hyprland in README
- [x] Add troubleshooting section for notification issues

### Phase 11: Daemon Core (Priority: Critical)

- [x] Implement daemon main loop (event-driven)
- [x] Add daemon state management (idle/recording/processing/error)
- [x] Implement daemon start command
- [x] Implement daemon stop command
- [x] Implement daemon restart command
- [x] Implement daemon status command
- [x] Add PID file management (~/.config/hyprvox/daemon.pid)
- [x] Add daemon already running detection
- [x] Implement graceful shutdown (cleanup resources)

### Phase 12: Daemon Auto-Restart (Priority: High)

- [x] Implement crash detection
- [x] Add restart counter (track crashes in 5-minute window)
- [x] Implement auto-restart logic (max 3 crashes in 5 minutes)
- [x] Add alert notification when restart limit reached
- [x] Stop daemon after max restarts (prevent infinite loops)
- [x] Log all crashes with stack traces

### Phase 13: systemd Integration (Priority: High)

- [x] Create systemd service file (`hyprvox.service`)
- [x] Add installation script for systemd service
- [x] Implement `hyprvox install` command (install systemd service)
- [x] Implement `hyprvox uninstall` command (remove systemd service)
- [x] Add systemd service enable on install
- [x] Add systemd service start on system boot
- [x] Document systemd setup instructions in README
- [x] Add troubleshooting section for systemd issues
- [x] Document tested distributions (Ubuntu, Fedora, Arch) in README

### Phase 14: Health Monitoring (Priority: High)

- [x] Implement `hyprvox health` command
- [x] Check daemon status (running/stopped, PID, uptime)
- [x] Check Groq API connectivity (ping with test request)
- [x] Check Deepgram API connectivity (ping with test request)
- [x] Check microphone detection (list available devices)
- [x] Check clipboard access (test write/read)
- [x] Display last error (if any)
- [x] Display transcription count (today/total)
- [x] Format health output (colored, user-friendly)

### Phase 15: History Management (Priority: High)

- [x] Implement history storage (`~/.config/hyprvox/history.json`)
- [x] Add history entry on each transcription (timestamp + text)
- [x] Implement `hyprvox history` command (display past transcriptions)
- [x] Add history pagination (show last 20, option to show more)
- [x] Add history search (filter by date, keyword)
- [x] Add history clear command (`hyprvox history clear`)
- [x] Format history output (readable timestamps, truncated text)

### Phase 16: Logging System (Priority: High)

- [x] Implement structured logging (JSON format)
- [x] Create log directory (`~/.config/hyprvox/logs/`)
- [x] Add log rotation (daily logs, keep last 7 days)
- [x] Log all transcriptions with full details (groqText, deepgramText, duration, etc.)
- [x] Log all errors with stack traces
- [x] Log daemon lifecycle events (start, stop, restart, crash)
- [x] Add log level configuration (debug, info, warn, error)
- [x] Implement `hyprvox logs` command (tail recent logs)

### Phase 17: CLI Interactive Setup (Priority: Medium)

- [x] Implement `hyprvox config` command
- [x] Create interactive prompts for API keys (Groq, Deepgram)
- [x] Add API key validation (format check)
  - [x] Create interactive hotkey selection
  - [x] Add hotkey validation (valid key combinations)
  - [x] Create boost words management (add/remove/list)
  - [x] Add boost words validation (max 450 words)
  - [x] Save config to file after setup

- [x] Display success message with next steps

### Phase 18: Error Handling & User-Friendly Messages (Priority: High)

- [x] Create error message templates (user-friendly, actionable)
- [x] Add error for invalid Groq API key (show setup instructions)
- [x] Add error for invalid Deepgram API key (show setup instructions)
- [x] Add error for no microphone detected (show troubleshooting steps)
- [x] Add error for microphone permission denied (show how to grant)
- [x] Add error for clipboard access denied (show fallback option)
- [x] Add error for daemon already running (show how to stop)
- [x] Add error for config file corrupted (show how to reset)
- [x] Add error for both APIs failing (show retry instructions)
- [x] Log all errors to file for debugging

### Phase 19: Testing - Unit Tests (Priority: High)

- [x] Write unit tests for config file reader/writer
- [x] Write unit tests for API key validation
- [x] Write unit tests for boost words validation
- [x] Write unit tests for hotkey validation
- [x] Write unit tests for audio duration validation
- [x] Write unit tests for transcript merging logic
- [x] Write unit tests for error handling paths
- [x] Write unit tests for daemon state management
- [x] Achieve 80%+ test coverage

### Phase 20: Testing - Integration Tests (Priority: High)

- [x] Write integration test for Groq API (with test API key)
- [x] Write integration test for Deepgram API (with test API key)
- [x] Write integration test for LLM merger (with sample transcripts)
- [x] Write integration test for clipboard write (verify append mode)
- [x] Write integration test for daemon lifecycle (start/stop/restart)
- [x] Write integration test for config file operations

- [x] Write integration test for history storage

### Phase 21: Documentation - README (Priority: High)

- [x] Write project description and tagline
- [x] Document prerequisites (Node.js, Bun, Linux)
- [x] Write installation instructions (npm/bun/npx)
- [x] Document API key setup (Groq, Deepgram)
- [x] Write usage guide (daemon start, hotkey, history, health)
- [x] Document configuration options (config file format)
- [x] Add troubleshooting section (common errors)
- [x] Add examples (typical workflows)
- [x] Add contributing guidelines

### Phase 22: Documentation - Configuration Reference (Priority: Medium)

- [x] Document all config file options
- [x] Document API key format and where to get them
- [x] Document hotkey options (valid key combinations)
- [x] Document boost words format and limits
- [x] Document audio device selection
- [x] Document language options (English only for v1.0)
- [x] Provide example config file with comments

### Phase 23: Documentation - Troubleshooting Guide (Priority: Medium)

- [x] Document "Daemon won't start" (common causes and fixes)
- [x] Document "Hotkey not working" (Wayland vs X11 issues)
- [x] Document "No microphone detected" (permission issues)
- [x] Document "API key invalid" (how to verify keys)
- [x] Document "Clipboard not working" (Wayland clipboard issues)
- [x] Document "Transcription quality poor" (boost words, audio quality)
- [x] Document "Daemon crashes frequently" (check logs, report issue)

### Phase 24: Documentation - Architecture (Priority: Low)

- [x] Document project structure (feature-based layout)
- [x] Document daemon architecture (event loop, state machine)
- [x] Document STT flow (audio → Groq/Deepgram → LLM → clipboard)
- [x] Document error handling strategy
- [x] Document testing strategy
- [x] Create architecture diagram showing daemon flow and component interactions

### Phase 25: Documentation - API Documentation (Priority: Low)

- [x] Document programmatic API (if exposing for other tools)
- [x] Document CLI commands (all available commands)
- [x] Document command options and flags
- [x] Document exit codes (for scripting)
- [x] Provide API usage examples

### Phase 26: Polish & Final Testing (Priority: High)

- [x] Run full test suite (unit + integration)
- [x] Verify clipboard APPEND mode (critical test)
- [x] Verify daemon auto-restart (crash recovery)
- [x] Verify all error messages are user-friendly
- [x] Document platform compatibility matrix in README (Wayland/X11, tested distros)
- [x] Add platform-specific troubleshooting guide
- [x] Document known issues and workarounds for different environments
- [x] Fix any remaining bugs
- [x] Optimize performance (if time permits)

## Validation Rules

### API Keys

- Groq API key: Must start with `gsk_` (format validation)
- Deepgram API key: Must be valid 40-character hex string (format validation)
- Both keys required before daemon can start

### Boost Words

- Maximum: 450 words (~500 tokens at 4 chars/token)
- Validation: Count words, reject if > 450
- Format: Array of strings in config file

### Audio Recording

- Minimum length: 0.6 seconds (reject shorter recordings)
- Maximum length: 5 minutes (auto-stop at 5:00)
- Warnings: Desktop notifications at 4:00 and 4:30
- Silent audio: Warn user if no audio detected

### Hotkey

- Must be a valid key combination
- Default: Right Control
- Validation: Check if key exists in `node-global-key-listener` key map
- Conflict detection: Warn if key already in use by system

### Configuration File

- Must be valid JSON
- Required fields: apiKeys.groq, apiKeys.deepgram
- Optional fields: hotkey, boostWords, audioDevice, language
- Corrupted file: Reset to defaults with user confirmation

## Error Handling Strategy

### Logging

- [x] All errors logged to file (`~/.config/hyprvox/logs/hyprvox-YYYY-MM-DD.log`)
- [x] Structured format (JSON) for easy parsing
- [x] Include timestamp, error type, stack trace, context

### User Notifications

- Critical errors: Desktop notification + log
- Non-critical errors: Log only
- User-friendly messages: Actionable, explain what went wrong and how to fix

### API Errors

- Groq timeout: Retry once, then fallback to Deepgram only
- Deepgram timeout: Retry once, then fallback to Groq only
- Both fail: Show error notification, log details, suggest checking API keys
- Invalid API key: Show setup instructions, link to API key pages

### Audio Errors

- No microphone: Show error notification, list troubleshooting steps
- Permission denied: Show error notification, explain how to grant permission
- Recording fails mid-recording: Abort, show error, suggest trying again

### System Errors

- Clipboard access denied: Fallback to file output (`~/.config/hyprvox/last-transcription.txt`)
- Daemon already running: Show error, suggest `hyprvox stop` first
- Config file corrupted: Offer to reset to defaults

### Retry Logic

- API calls: Max 2 attempts with short backoff (100ms, 200ms)
- Philosophy: Fail fast, let user retry manually
- No exponential backoff (prioritize speed over exhaustive retries)

## Security Considerations (v2.0)

For v1.0, security is deferred to v2.0:

- API keys stored in plain text in config file
- File permissions: chmod 600 for config file (basic protection)
- No encryption of sensitive data
- SSL certificate validation: Use library defaults

## Performance Considerations (v2.0)

For v1.0, performance optimization is deferred to v2.0:

- No specific latency targets
- No memory footprint limits
- Focus on functionality and correctness first
- Performance improvements in future versions

## Success Criteria

- [x] Daemon starts on system boot via systemd
- [x] Global hotkey (Right Control) triggers recording
- [x] Audio recording works (0.6s min, 5min max with warnings)
- [x] Dual STT transcription works (Groq + Deepgram in parallel)
- [x] LLM merger produces high-quality transcriptions
- [x] Transcription copied to clipboard (APPEND mode, never overwrite)
- [x] Desktop notifications work (recording start/stop, transcription ready, errors)
- [x] CLI commands work (config, history, health, daemon start/stop/status)
- [x] Error handling is robust (user-friendly messages, proper logging)
- [x] Tests pass with 80%+ coverage
- [x] Documentation is complete (README, config reference, troubleshooting, architecture, API)
- [x] Works on Hyprland (Wayland) - primary target
- [x] Works on other Linux distros (Ubuntu, Fedora, Arch)
- [x] No clipboard overwrites (critical requirement verified)
- [x] Daemon auto-restarts on crash (max 3 in 5 minutes)
- [x] All validation rules enforced (API keys, boost words, audio, hotkey)

## Out of Scope (v2.0)

- WSL support (Windows hotkey forwarding)
- Performance optimization (latency, memory)
- Security hardening (encrypted API keys, secure storage)
- Multi-language support (English only for v1.0)
- Local STT fallback (whisper.cpp)
- Web UI (CLI/TUI only for v1.0)
- Cross-platform support (macOS, Windows)
- Plugin system (custom STT providers)

## Notes for Ralphy

- **Critical Requirement**: Clipboard APPEND mode (never overwrite) - test thoroughly
- **Wayland Priority**: Focus on Hyprland first, then other Wayland compositors
- **Error Messages**: Must be user-friendly and actionable
- **Code Quality**: TypeScript strict mode, minimal `any`, self-documenting code
- **Testing**: 80%+ coverage, focus on error handling and core logic
- **Documentation**: All 5 types required (README, config, troubleshooting, architecture, API)
- **Audio Library**: Research needed - choose production-ready library for Linux
- **Hotkey Library**: Use `node-global-key-listener` (confirmed)
- **Logging**: Structured format (JSON) for debugging user issues
- **Daemon**: systemd integration required for Linux
