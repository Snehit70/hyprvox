# Configuration Guide

This document provides a detailed overview of the configuration options available for `hyprvox`.

## Configuration File

The default configuration file is located at:
`~/.config/hypr/vox/config.json`

### Security Requirement
Since the configuration file contains sensitive API keys, it **must** have restricted file permissions.
```bash
chmod 600 ~/.config/hypr/vox/config.json
```

## Environment Variables

The application supports the following environment variables:

### API Key Fallbacks
If an API key is missing from `config.json`, the application will fall back to these:
- `GROQ_API_KEY`: Fallback for `apiKeys.groq`
- `GROQ_FALLBACK_API_KEY`: Fallback for `apiKeys.groqFallback`
- `DEEPGRAM_API_KEY`: Fallback for `apiKeys.deepgram`
- `SONIOX_API_KEY`: Fallback for `apiKeys.soniox` when Soniox live dictation is enabled

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
    "groqFallback": "gsk_...",
    "deepgram": "00000000-0000-0000-0000-000000000000",
    "soniox": "soniox_..."
  },
  "behavior": {
    "hotkey": "Right Control",
    "toggleMode": true,
    "notifications": true,
    "clipboard": {
      "append": true,
      "minDuration": 0.6,
      "maxDuration": 600
    },
    "audioDevice": "default"
  },
  "paths": {
    "logs": "~/.config/hypr/vox/logs/",
    "history": "~/.config/hypr/vox/history.json"
  },
  "transcription": {
    "language": "en",
    "formattingMode": "clean",
    "groqChunking": {
      "enabled": false,
      "mode": "live",
      "minDurationSeconds": 45,
      "chunkSeconds": 20,
      "overlapSeconds": 1.5,
      "maxConcurrency": 3,
      "chunkMaxRetries": 1,
      "chunkRetryBackoffMs": 250,
      "liveFinalizeTimeoutMs": 2500,
      "fallbackToFullAudio": true,
      "logChunkTranscripts": true
    },
    "debugAudio": {
      "enabled": true,
      "keepLast": 5,
      "directory": "~/.config/hypr/vox/debug-audio"
    },
    "boostWords": [
      "hyprvox",
      "Groq",
      "Deepgram"
    ]
  },
  "liveDictation": {
    "enabled": false,
    "insertionCommand": "auto",
    "soniox": {
      "enabled": false,
      "triggerKey": "Right Alt"
    }
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
| `groqFallback` | String | Optional | Secondary Groq API key used only when the primary merge key is rate-limited/quota-limited. | Must start with `gsk_` if provided. | [Groq Console](https://console.groq.com/keys) |
| `deepgram` | String | N/A | API key for Deepgram (Nova-3). | 40-char hex string or UUID. | [Deepgram Console](https://console.deepgram.com/) |
| `soniox` | String | Optional | API key for Soniox real-time STT. Required only when `liveDictation.soniox.enabled` is used. | Non-empty string. | [Soniox Console](https://console.soniox.com/) |

#### How to obtain API Keys

1. **Groq API Key**:
   - Go to the [Groq Cloud Console](https://console.groq.com/keys).
   - Create a new API key.
   - **Format**: The key starts with `gsk_` (e.g., `gsk_xxxxxxxxxxxxxxxxxxxx`).

2. **Deepgram API Key**:
   - Go to the [Deepgram Console](https://console.deepgram.com/).
   - Navigate to **API Keys** and create a new key.
   - **Format**: The key is typically a **40-character hexadecimal string** (e.g., `abcdef1234567890abcdef1234567890abcdef12`). Legacy keys or specific project IDs might use a UUID format, both are supported.

3. **Soniox API Key**:
   - Go to the [Soniox Console](https://console.soniox.com/).
   - Create an API key for real-time speech-to-text.
   - Hyprvox reads it from `apiKeys.soniox` or `SONIOX_API_KEY`.

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
| `maxDuration` | Number | `600` | Maximum recording duration in seconds (10 minutes). | Max: `600` |

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
| `logs` | String | `"~/.config/hypr/vox/logs/"` | Directory where structured log files are stored. |
| `history` | String | `"~/.config/hypr/vox/history.json"` | Path to the transcription history JSON file. |

---

### 4. Transcription (`transcription`)

Settings related to the speech-to-text engine.

| Option | Type | Default | Description | Validation Rules |
| :--- | :--- | :--- | :--- | :--- |
| `language` | String | `"en"` | ISO 639-1 language code for transcription. **Only English (`en`) is supported in v1.0.** | N/A |
| `streaming` | Boolean | `false` | Enable real-time streaming transcription during recording. | N/A |
| `groqChunking.enabled` | Boolean | `false` | Split longer recordings for Groq Whisper only. Deepgram still uses the full audio. | N/A |
| `groqChunking.mode` | String | `"live"` | Dispatch Groq chunks while recording, then finalize quickly on stop. | Must be `"live"` |
| `groqChunking.minDurationSeconds` | Number | `45` | Minimum recording duration before Groq chunking is considered. | `>= 1` |
| `groqChunking.chunkSeconds` | Number | `20` | Target duration for each Groq WAV chunk. | `>= 1` |
| `groqChunking.overlapSeconds` | Number | `1.5` | Audio overlap between adjacent Groq chunks. | `>= 0` and less than `chunkSeconds` |
| `groqChunking.maxConcurrency` | Number | `3` | Maximum parallel Groq chunk requests. | Integer `1`-`8` |
| `groqChunking.chunkMaxRetries` | Number | `1` | Retries per failed live chunk before marking chunking failed. | Integer `0`-`3` |
| `groqChunking.chunkRetryBackoffMs` | Number | `250` | Backoff between live chunk retries. | Integer `50`-`5000` |
| `groqChunking.liveFinalizeTimeoutMs` | Number | `2500` | Max wait after stop for in-flight live chunk requests before fallback. | Integer `500`-`10000` |
| `groqChunking.fallbackToFullAudio` | Boolean | `true` | Fall back to the existing full-audio Groq request if chunking fails. | N/A |
| `groqChunking.logChunkTranscripts` | Boolean | `true` | Log per-chunk Groq source text for quality debugging. | N/A |
| `debugAudio.enabled` | Boolean | `true` | Asynchronously save raw recorder WAV files for replay/debugging. | N/A |
| `debugAudio.keepLast` | Number | `5` | Keep only the newest N saved recordings in the debug audio directory. | Integer `1`-`100` |
| `debugAudio.directory` | String | `"~/.config/hypr/vox/debug-audio"` | Directory where saved raw WAV captures are written. | Must be a valid writable path |
| `boostWords` | Array | `[]` | List of words to prioritize for better accuracy (e.g., names, jargon). | Max 450 words total. |
| `mergeModel` | String | `"llama-3.3-70b-versatile"` | Groq model used to merge transcripts from Groq Whisper and Deepgram. | Must be a valid Groq model ID. |
| `formattingMode` | String | `"clean"` | Controls how aggressively the merger formats dictated text. | `"verbatim"`, `"clean"`, or `"structured"`. |

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
- If `groqChunking.enabled` is false, Groq processes the full audio file after recording stops
- If `groqChunking.enabled` is true, Groq dispatches overlapping live chunks during recording and only falls back to full audio on live chunk failure/timeout
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

#### Groq Chunking

`groqChunking` is an opt-in Groq-only path for longer recordings. In `mode: "live"`, Hyprvox starts dispatching Groq chunk requests while recording is still in progress (once `minDurationSeconds` is crossed), then does a short finalize wait on stop and joins ordered chunk text before the normal Groq + Deepgram merge pipeline. Deepgram, history, clipboard, and validation behavior are unchanged.

Live chunk transcripts are validated before stitching. Prompt-artifact chunks, mixed-script garbage, obvious word-salad, and very short low-value tails are dropped. Dropped chunks can be repaired once with neighboring accepted chunk context; perf logs expose this as `groqLiveDroppedChunks` and `groqLiveRecoveredChunks`. If the stitched live Groq transcript is clean but materially shorter than a valid Deepgram transcript, Hyprvox can run one full-audio Groq quality fallback before merge; perf logs expose this as `groqLiveQualityFallback` and `groqLiveQualityFallbackReason`.

`debugAudio` stores the original raw recorder WAV asynchronously after each processed recording. This is intended for replaying the exact same audio through later builds or settings changes without having to re-dictate the sample.

Keep this disabled unless you are collecting timing and quality logs. If WAV preparation or a chunk request fails and `fallbackToFullAudio` is true, Hyprvox logs the reason and runs the existing full-audio Groq request.

For replay-driven tuning, run:

```bash
bun run scripts/replay-debug-audio.ts ~/.config/hypr/vox/debug-audio/<capture>.wav 2
```

The replay script reuses the saved WAV and prints:
- `results`: raw `liveGroq`, `fullGroq`, `deepgram`, and merged `finalText` for each run
- `report.runs[*]`: compact per-run compare data including `liveStatus`, fallback reason, merge-source selection, live-quality fallback reason, text lengths, candidate issues per source, completeness flags, verdict flags, and normalized edit distances
- `report.summary`: average chunk count, replay fallback count, live-quality fallback count, merge strategies, average normalized distances, aggregated issue counts by source, and verdict totals

#### Boost Words (Custom Vocabulary)

The `boostWords` array is used to improve the detection of specific terms like names, acronyms, or technical jargon. Hyprvox also builds a computed project lexicon from boost words, common technical terms, and local repo filenames. Provider transcription hints preserve configured boost words and add lexicon terms; the merge prompt receives a smaller capped lexicon plus exact tokens found in the source transcripts.

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

You can inspect the computed lexicon with:

```bash
hyprvox boost lexicon
```

#### Formatting Mode

`formattingMode` controls output shape during the merge step:

- `verbatim`: Minimal punctuation cleanup. Preserves sentence flow and avoids adding bullets/headings unless they were explicitly dictated.
- `clean`: Default. Improves punctuation and sentence boundaries while using normal prose unless multiple list items are clearly dictated.
- `structured`: Formats clearly dictated steps, issues, tasks, or points as readable lists while preserving spoken wording.

#### Quality And Observability Notes

Transcript quality checks are not currently configurable. The daemon always validates candidate output for prompt artifacts, CoT/meta leakage, injected filename/command token bursts, detachable hallucination suffixes, mixed-script garbage in English mode, and obvious garbage fragments before saving text to clipboard/history.

In streaming mode, performance logs include Deepgram finalization observability:

- `deepgramStopReason`
- `deepgramFinalizeWaitMs`
- `deepgramCloseWaitMs`
- `deepgramEndpointingMs`
- `deepgramReceivedFinalChunk`
- `deepgramHadSpeechFinal`

These fields are for analysis and future tuning. Do not treat a frequent `finalize_timeout` by itself as proof that endpointing should change; compare the final transcript quality and late finalization signals first.

### 5. Live Dictation (`liveDictation`)

Live Dictation controls focused-text insertion while recording. It is disabled by default.

| Option | Type | Default | Description | Validation Rules |
| :--- | :--- | :--- | :--- | :--- |
| `enabled` | Boolean | `false` | Type stable live transcript text into the currently focused input during the normal streaming path. | Requires `transcription.streaming: true` to receive Deepgram live transcript events. |
| `insertionCommand` | String | `"auto"` | Command used for focused text insertion. | `"auto"`, `"wtype"`, or `"xdotool"`. |
| `soniox.enabled` | Boolean | `false` | Enable the separate Soniox provider-bypass hotkey. | Requires `apiKeys.soniox` or `SONIOX_API_KEY` when used. |
| `soniox.triggerKey` | String | `"Right Alt"` | Separate hotkey for Soniox live dictation. | Same hotkey format as `behavior.hotkey`. |

#### Normal Live Dictation

When `liveDictation.enabled` and `transcription.streaming` are both enabled, Hyprvox types committed Deepgram streaming transcript chunks into the focused input as they arrive. The final transcript still follows the normal Groq plus Deepgram merge, clipboard, history, and validation path after recording stops.

#### Soniox Provider Bypass

When `liveDictation.soniox.enabled` is enabled, pressing `liveDictation.soniox.triggerKey` starts a Soniox real-time STT session. Recorder PCM is sent directly to Soniox, stable final tokens are typed into the focused input, and the final Soniox transcript is copied to clipboard and appended to history when recording stops.

This path intentionally skips Groq, Deepgram batch transcription, merge, repair, and quality recovery. Use it when low-latency live dictation is more important than the normal multi-provider quality pipeline.

#### Language Options

For **v1.0**, `hyprvox` is optimized for and officially supports **English only**.

- **Option**: `transcription.language`
- **Supported Value**: `"en"` (default)
- **Note**: While the underlying APIs (Groq and Deepgram) support multiple languages, the internal post-processing and LLM-based merging logic are currently tuned for English. Support for additional languages is planned for v2.0.

---

## Validation
`hyprvox` uses **Zod** to validate the configuration file on startup. If the configuration is invalid, the daemon will log a detailed error message and fail to start. You can use `bun run index.ts health` to verify if your configuration and API keys are working correctly.
