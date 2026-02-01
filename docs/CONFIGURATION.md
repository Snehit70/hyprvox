# Configuration Guide

This document provides a detailed overview of the configuration options available for `voice-cli`.

## Configuration File

The default configuration file is located at:
`~/.config/voice-cli/config.json`

### Security Requirement
Since the configuration file contains sensitive API keys, it **must** have restricted file permissions.
```bash
chmod 600 ~/.config/voice-cli/config.json
```

## Environment Variables

The application supports the following environment variables:

### API Key Fallbacks
If an API key is missing from `config.json`, the application will fall back to these:
- `GROQ_API_KEY`: Fallback for `apiKeys.groq`
- `DEEPGRAM_API_KEY`: Fallback for `apiKeys.deepgram`

### Logging
- `LOG_LEVEL`: Sets the minimum logging level. Options: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`. Default: `info`.

### Systemd / Desktop Environments
These are typically handled automatically by your desktop environment or the systemd service:
- `DISPLAY`: Required for X11 notifications and clipboard.
- `WAYLAND_DISPLAY`: Required for Wayland notifications and clipboard.
- `XAUTHORITY`: Required for X11 authentication.
- `XDG_RUNTIME_DIR`: Required for systemd and communication.

## Configuration Format

The configuration is a JSON file structured into several sections.

### Example Configuration

```json
{
  "apiKeys": {
    "groq": "gsk_...",
    "deepgram": "00000000-0000-0000-0000-000000000000"
  },
  "behavior": {
    "hotkey": "Right Control",
    "toggleMode": true,
    "notifications": true,
    "clipboard": {
      "append": true,
      "minDuration": 0.6,
      "maxDuration": 300
    },
    "audioDevice": "default"
  },
  "paths": {
    "logs": "~/.config/voice-cli/logs/",
    "history": "~/.config/voice-cli/history.json"
  },
  "transcription": {
    "language": "en",
    "boostWords": [
      "voice-cli",
      "Groq",
      "Deepgram"
    ]
  }
}
```

---

## Configuration Sections

### 1. API Keys (`apiKeys`)

Authentication credentials for the transcription services.

| Option | Type | Default | Description | Validation Rules | Acquisition URL |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `groq` | String | N/A | API key for Groq (Whisper V3). | Must start with `gsk_`. | [Groq Console](https://console.groq.com/keys) |
| `deepgram` | String | N/A | API key for Deepgram (Nova-3). | 40-char hex string or UUID. | [Deepgram Console](https://console.deepgram.com/) |

#### How to obtain API Keys

1. **Groq API Key**:
   - Go to the [Groq Cloud Console](https://console.groq.com/keys).
   - Create a new API key.
   - **Format**: The key starts with `gsk_` (e.g., `gsk_xxxxxxxxxxxxxxxxxxxx`).

2. **Deepgram API Key**:
   - Go to the [Deepgram Console](https://console.deepgram.com/).
   - Navigate to **API Keys** and create a new key.
   - **Format**: The key is typically a **40-character hexadecimal string** (e.g., `abcdef1234567890abcdef1234567890abcdef12`). Legacy keys or specific project IDs might use a UUID format, both are supported.

---

### 2. Behavior (`behavior`)

Controls the core functionality and user interaction of the daemon.

| Option | Type | Default | Description | Validation Rules |
| :--- | :--- | :--- | :--- | :--- |
| `hotkey` | String | `"Right Control"` | Global hotkey to trigger recording. Set to `"disabled"` to disable the built-in listener (useful for Wayland users using compositor bindings). | Supports `Modifier+Key` format or `"disabled"`. See **[Hotkey Troubleshooting](TROUBLESHOOTING.md#global-hotkey-issues)** for Linux/Wayland issues. |
| `toggleMode` | Boolean | `true` | If `true`, press once to start and again to stop. If `false`, recording duration is fixed. | N/A |
| `notifications` | Boolean | `true` | Enable/disable desktop notifications for recording status. | N/A |
| `audioDevice` | String | Optional | Specify a custom ALSA audio device name (e.g., `"hw:0,0"`). See **[Audio Device Selection](AUDIO_DEVICES.md)** for details. | N/A |

#### Clipboard Settings (`behavior.clipboard`)

| Option | Type | Default | Description | Validation Rules |
| :--- | :--- | :--- | :--- | :--- |
| `append` | Boolean | `true` | If `true`, appends the transcript to the current clipboard. If `false`, overwrites it. | N/A |
| `minDuration` | Number | `0.6` | Minimum recording duration in seconds. | Min: `0.6` |
| `maxDuration` | Number | `300` | Maximum recording duration in seconds (5 minutes). | Max: `300` |

#### Hotkey Format
The `hotkey` option supports both single keys and combinations using the `+` separator, or the special value `"disabled"`.
- **Examples**: `"Right Control"`, `"Ctrl+Space"`, `"Alt+Shift+V"`, `"F10"`, `"disabled"`.
- **Special Value**: `"disabled"` - Disables the built-in hotkey listener. Useful on Wayland when using native compositor bindings. See **[Wayland Support Guide](WAYLAND.md)** for details.
- **Supported Modifiers**:
  - `Ctrl`, `Control` (maps to `LEFT CTRL` or `RIGHT CTRL`)
  - `Alt` (maps to `LEFT ALT` or `RIGHT ALT`)
  - `Shift` (maps to `LEFT SHIFT` or `RIGHT SHIFT`)
  - `Meta`, `Super`, `Win` (maps to `LEFT META` or `RIGHT META`)
  - `Command`, `Cmd`, `Option` (Mac-style aliases)
- **Specific Modifiers**: `LEFT CTRL`, `RIGHT CTRL`, `LEFT ALT`, `RIGHT ALT`, `LEFT SHIFT`, `RIGHT SHIFT`, `LEFT META`, `RIGHT META`.
- **Supported Keys**:
  - **Alphanumeric**: `A-Z`, `0-9`
  - **Function Keys**: `F1` through `F24`
  - **Navigation**: `UP`, `DOWN`, `LEFT`, `RIGHT` (or `UP ARROW`, etc.), `HOME`, `END`, `PAGE UP`, `PAGE DOWN`
  - **Editing**: `ENTER`, `RETURN`, `TAB`, `ESC`, `ESCAPE`, `BACKSPACE`, `DELETE`, `INSERT`, `SPACE`
  - **System**: `PRINTSCREEN`, `SCROLL LOCK`, `PAUSE`, `BREAK`, `CAPS LOCK`, `NUM LOCK`
  - **Symbols**: `MINUS`, `EQUAL`, `SEMICOLON`, `QUOTE`, `BACKQUOTE`, `BACKSLASH`, `COMMA`, `PERIOD`, `SLASH`, `GRAVE`, `TILDE`, `BACKTICK`, `DOT`
  - **Numpad**: `NUMPAD 0`-`9`, `NUMPAD DIVIDE`, `NUMPAD MULTIPLY`, `NUMPAD SUBTRACT`, `NUMPAD ADD`, `NUMPAD ENTER`, `NUMPAD DECIMAL`, `NUMPAD DOT`

> **Note**: On Linux, global hotkeys require XWayland support when running under Wayland compositors. ensure your user is in the `input` group.

---

### 3. Paths (`paths`)

File system locations for logs and history. Supports `~` for home directory expansion.

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `logs` | String | `"~/.config/voice-cli/logs/"` | Directory where structured log files are stored. |
| `history` | String | `"~/.config/voice-cli/history.json"` | Path to the transcription history JSON file. |

---

### 4. Transcription (`transcription`)

Settings related to the speech-to-text engine.

| Option | Type | Default | Description | Validation Rules |
| :--- | :--- | :--- | :--- | :--- |
| `language` | String | `"en"` | ISO 639-1 language code for transcription. **Only English (`en`) is supported in v1.0.** | N/A |
| `streaming` | Boolean | `false` | Enable real-time streaming transcription during recording. | N/A |
| `boostWords` | Array | `[]` | List of words to prioritize for better accuracy (e.g., names, jargon). | Max 450 words total. |

#### Streaming Mode

The `streaming` option controls whether transcription happens in real-time during recording or after you stop.

**Batch Mode (streaming: false) - DEFAULT**
- Processes audio after you stop recording
- Higher accuracy (Deepgram has full context)
- Latency: 2-8 seconds after stop
- Best for: Accuracy-critical use cases

**Streaming Mode (streaming: true) - EXPERIMENTAL**
- Processes audio in real-time while you speak
- Slightly lower accuracy (chunked processing)
- Latency: 0.5-1 second after stop (75% faster!)
- Best for: Speed-critical workflows

**How It Works:**
- In streaming mode, audio chunks are sent to Deepgram via WebSocket as you speak
- Groq still processes the full audio file after recording stops
- The LLM merger combines both transcripts, compensating for streaming accuracy loss
- Final result typically matches batch mode quality with significantly reduced latency

**When to Use Streaming:**
- You prioritize speed over absolute accuracy
- You're transcribing conversational speech (not technical jargon)
- You want near-instant results after stopping

**When to Use Batch:**
- You need maximum accuracy
- You're transcribing technical content with specialized vocabulary
- A few extra seconds of latency is acceptable

#### Boost Words (Custom Vocabulary)

The `boostWords` array is used to improve the detection of specific terms like names, acronyms, or technical jargon.

**Format and Limits:**
- **Data Type**: Array of strings. Each entry can be a single word or a phrase.
- **Word Limit**: The total number of words across all entries must not exceed **450 words**. 
    - *Example*: `"Sisyphus tool"` counts as 2 words towards the limit.
- **Token Constraints**: 
    - **Groq (Whisper V3)**: Supports up to **224 tokens**. If your list is long, terms at the end may be truncated.
    - **Deepgram (Nova-3)**: Supports up to **500 tokens**.
- **Case Sensitivity**: 
    - Use capitalization for proper nouns (e.g., `"Deepgram"`, `"Linux"`, `"Snehit"`).
    - Use lowercase for generic terms unless they are typically capitalized.
- **Weights**: Numerical weighting (e.g., `word:2`) is **not supported** by the current engines. The presence of the word in the list provides the necessary bias.

**Pro-Tip**: Keep your list focused. Adding too many common words can actually decrease accuracy for those terms. Focus on unique terms that the models frequently miss.

#### Language Options

For **v1.0**, `voice-cli` is optimized for and officially supports **English only**.

- **Option**: `transcription.language`
- **Supported Value**: `"en"` (default)
- **Note**: While the underlying APIs (Groq and Deepgram) support multiple languages, the internal post-processing and LLM-based merging logic are currently tuned for English. Support for additional languages is planned for v2.0.

---

## Validation
`voice-cli` uses **Zod** to validate the configuration file on startup. If the configuration is invalid, the daemon will log a detailed error message and fail to start. You can use `bun run index.ts health` to verify if your configuration and API keys are working correctly.
