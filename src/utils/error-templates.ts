export interface ErrorTemplate {
  message: string;
  action: string;
}

export const ErrorTemplates = {
  // API Errors
  API: {
    GROQ_INVALID_KEY: {
      message: "Groq API key is invalid or missing.",
      action: "Please check your Groq API key in ~/.config/voice-cli/config.json. It should start with 'gsk_'.\n\nYou can get a key at: https://console.groq.com/keys"
    },
    DEEPGRAM_INVALID_KEY: {
      message: "Deepgram API key is invalid or missing.",
      action: "Please check your Deepgram API key in ~/.config/voice-cli/config.json. It should be a valid UUID.\n\nYou can get a key at: https://console.deepgram.com/signup"
    },
    RATE_LIMIT_EXCEEDED: (provider: string) => ({
      message: `${provider} rate limit exceeded.`,
      action: "Please wait a moment before trying again or check your API usage limits."
    }),
    TIMEOUT: (provider: string) => ({
      message: `${provider} transcription request timed out.`,
      action: "Check your internet connection or try again. The service might be under heavy load."
    }),
    BOTH_SERVICES_FAILED: {
      message: "Both Groq and Deepgram transcription services failed.",
      action: "Check your internet connection and verify that both API keys are correct and active."
    }
  },

  // Validation Errors
  VALIDATION: {
    INVALID_API_KEY_FORMAT: (provider: string) => ({
      message: `Invalid ${provider} API key format.`,
      action: provider === "Groq" 
        ? "Groq keys must start with 'gsk_'." 
        : "Deepgram keys must be a valid UUID."
    }),
    BOOST_WORDS_LIMIT: {
      message: "Boost words limit exceeded (max 450 words).",
      action: "Reduce the number of words in the 'boostWords' array in your config.json."
    },
    INVALID_HOTKEY: {
      message: "Invalid hotkey configuration.",
      action: "Ensure the 'hotkey' in config.json is a valid key name (e.g., 'Right Control')."
    }
  },

  // Audio Errors
  AUDIO: {
    RECORDING_TOO_SHORT: {
      message: "Recording was too short (less than 0.6 seconds).",
      action: "Hold the hotkey a bit longer to record your speech."
    },
    MAX_DURATION_REACHED: {
      message: "Maximum recording duration reached (5 minutes).",
      action: "Recording stopped automatically. For longer transcriptions, please split your speech into multiple recordings."
    },
    NO_MICROPHONE: {
      message: "No microphone detected or could not be opened.",
      action: "1. Check if your microphone is physically connected.\n2. Ensure your user is in the 'audio' group: 'sudo usermod -aG audio $USER'.\n3. Verify the correct device is selected in ~/.config/voice-cli/config.json.\n4. Check if another application is using the microphone (e.g., 'Device busy').\n5. Run 'arecord -l' to list available hardware devices."
    },
    SILENT_AUDIO: {
      message: "No audio detected in the recording.",
      action: "Check your microphone settings and ensure the correct input device is selected."
    },
    FFMPEG_FAILURE: {
      message: "Failed to process audio file.",
      action: "Ensure FFmpeg is installed and accessible in your system PATH."
    }
  },

  // Daemon Errors
  DAEMON: {
    ALREADY_RECORDING: {
      message: "A recording is already in progress.",
      action: "Wait for the current recording to finish before starting a new one."
    },
    CRASH_LIMIT_REACHED: {
      message: "Daemon has crashed too many times and will not auto-restart.",
      action: "Check the logs in ~/.config/voice-cli/logs/ to identify the root cause, then restart the daemon manually."
    }
  },

  // Clipboard Errors
  CLIPBOARD: {
    APPEND_FAILED: {
      message: "Failed to append transcription to clipboard history.",
      action: "Ensure you have 'wl-clipboard' (Wayland) or 'xclip'/'xsel' (X11) installed."
    }
  },

  // Configuration Errors
  CONFIG: {
    VALIDATION_FAILED: {
      message: "Configuration validation failed.",
      action: "Review the error details and fix the invalid fields in ~/.config/voice-cli/config.json."
    },
    FILE_PERMISSIONS: {
      message: "Config file has insecure permissions.",
      action: "Run 'chmod 600 ~/.config/voice-cli/config.json' to restrict access to the current user only."
    },
    WRITE_FAILED: {
      message: "Failed to save configuration.",
      action: "Ensure the daemon has write permissions for ~/.config/voice-cli/."
    }
  }
};

export const formatUserError = (template: ErrorTemplate): string => {
  return `${template.message}\n\nAction: ${template.action}`;
};
