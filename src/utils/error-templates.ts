export interface ErrorTemplate {
	message: string;
	action: string;
}

export const ErrorTemplates = {
	// API Errors
	API: {
		GROQ_INVALID_KEY: {
			message: "Groq API key is invalid or missing.",
			action:
				"Please check your Groq API key in ~/.config/hypr/vox/config.json. It should start with 'gsk_'.\n\nYou can get a key at: https://console.groq.com/keys",
		},
		DEEPGRAM_INVALID_KEY: {
			message: "Deepgram API key is invalid or missing.",
			action:
				"Please check your Deepgram API key in ~/.config/hypr/vox/config.json. It should be a valid UUID.\n\nYou can get a key at: https://console.deepgram.com/signup",
		},
		RATE_LIMIT_EXCEEDED: (provider: string) => ({
			message: `${provider} rate limit exceeded.`,
			action:
				"Please wait a moment before trying again or check your API usage limits.",
		}),
		TIMEOUT: (provider: string) => ({
			message: `${provider} transcription request timed out.`,
			action:
				"Check your internet connection or try again. The service might be under heavy load.",
		}),
		BOTH_SERVICES_FAILED: {
			message: "Both Groq and Deepgram transcription services failed.",
			action:
				"1. Check your internet connection.\n2. Verify both API keys in ~/.config/hypr/vox/config.json.\n3. Try again in a few seconds (retry instructions).",
		},
	},

	// Validation Errors
	VALIDATION: {
		INVALID_API_KEY_FORMAT: (provider: string) => ({
			message: `Invalid ${provider} API key format.`,
			action:
				provider === "Groq"
					? "Groq keys must start with 'gsk_'."
					: "Deepgram keys must be a valid UUID.",
		}),
		BOOST_WORDS_LIMIT: {
			message: "Boost words limit exceeded (max 450 words).",
			action:
				"Reduce the number of words in the 'boostWords' array in your config.json.",
		},
		INVALID_HOTKEY: {
			message: "Invalid hotkey configuration.",
			action:
				"Ensure the 'hotkey' in config.json is a valid key name (e.g., 'Right Control').",
		},
	},

	// Audio Errors
	AUDIO: {
		RECORDING_TOO_SHORT: {
			message: "Recording was too short (less than 0.6 seconds).",
			action: "Hold the hotkey a bit longer to record your speech.",
		},
		MAX_DURATION_REACHED: {
			message: "Maximum recording duration reached (5 minutes).",
			action:
				"Recording stopped automatically. For longer transcriptions, please split your speech into multiple recordings.",
		},
		AUDIO_BACKEND_MISSING: {
			message: "Audio recording backend 'arecord' is not installed.",
			action:
				"Please install 'alsa-utils' using your package manager (e.g., 'sudo apt install alsa-utils' or 'sudo pacman -S alsa-utils').",
		},
		NO_MICROPHONE: {
			message: "No microphone detected or could not be opened.",
			action:
				"1. Check if your microphone is physically connected.\n2. Ensure your user is in the 'audio' group: 'sudo usermod -aG audio $USER'.\n3. Verify the correct device is selected in ~/.config/hypr/vox/config.json.\n4. Check if another application is using the microphone (e.g., 'Device busy').\n5. Run 'arecord -l' to list available hardware devices.",
		},
		PERMISSION_DENIED: {
			message: "Microphone permission denied.",
			action:
				"1. Ensure your user is in the 'audio' and 'input' groups: 'sudo usermod -aG audio,input $USER'.\n2. Log out and back in for group changes to take effect.\n3. Check if your desktop environment (GNOME/KDE/Hyprland) is blocking microphone access in Privacy settings.",
		},
		DEVICE_BUSY: {
			message: "Microphone is busy or already in use.",
			action:
				"1. Close other applications that might be using the microphone (e.g., Discord, Zoom, Browser).\n2. Run 'fuser /dev/snd/*' to see which processes are using audio devices.\n3. Try restarting the audio service: 'systemctl --user restart pipewire' or 'pulseaudio -k'.",
		},
		SILENT_AUDIO: {
			message: "No audio detected in the recording.",
			action:
				"1. Check your microphone settings and ensure the correct input device is selected.\n2. Ensure the microphone is not muted hardware-wise.\n3. Verify your user is in the 'audio' group.",
		},
		CONVERSION_FAILED: {
			message: "Failed to process audio file (conversion failed).",
			action:
				"1. Ensure FFmpeg is installed and accessible in your system PATH.\n2. Check if your system has enough disk space in /tmp.",
		},
		FFMPEG_FAILURE: {
			message: "Audio processing failed (FFmpeg).",
			action:
				"Ensure FFmpeg is installed: 'sudo apt install ffmpeg' or 'sudo pacman -S ffmpeg'.",
		},
	},

	// Daemon Errors
	DAEMON: {
		ALREADY_RECORDING: {
			message: "A recording is already in progress.",
			action:
				"Wait for the current recording to finish before starting a new one.",
		},
		CRASH_LIMIT_REACHED: {
			message: "Daemon has crashed too many times and will not auto-restart.",
			action:
				"Check the logs in ~/.config/hypr/vox/logs/ to identify the root cause, then restart the daemon manually.",
		},
	},

	// Clipboard Errors
	CLIPBOARD: {
		APPEND_FAILED: {
			message: "Failed to append transcription to clipboard history.",
			action:
				"Ensure you have 'wl-clipboard' (Wayland) or 'xclip'/'xsel' (X11) installed.",
		},
		ACCESS_DENIED: {
			message: "Clipboard access denied or tool missing.",
			action:
				"1. Ensure 'wl-clipboard' (Wayland) or 'xclip' (X11) is installed.\n2. Check if you have permissions to access the clipboard.\n3. The transcription has been saved to the fallback file: ~/.config/hypr/vox/transcriptions.txt",
		},
	},

	// Configuration Errors
	CONFIG: {
		VALIDATION_FAILED: {
			message: "Configuration validation failed.",
			action:
				"Review the error details and fix the invalid fields in ~/.config/hypr/vox/config.json.",
		},
		FILE_PERMISSIONS: {
			message: "Config file has insecure permissions.",
			action:
				"Run 'chmod 600 ~/.config/hypr/vox/config.json' to restrict access to the current user only.",
		},
		CORRUPTED: {
			message: "Configuration file is corrupted (invalid JSON).",
			action:
				"To reset, delete the file: rm ~/.config/hypr/vox/config.json or run 'hyprvox config init --force'",
		},
		WRITE_FAILED: {
			message: "Failed to save configuration.",
			action:
				"Ensure the daemon has write permissions for ~/.config/hypr/vox/.",
		},
	},
};

export const formatUserError = (template: ErrorTemplate): string => {
	return `${template.message}\n\nAction: ${template.action}`;
};
