import { z } from "zod";

/**
 * Custom validator for boost words count.
 * Ensures the total number of words across all entries does not exceed 450.
 */
const boostWordsValidator = (words: string[] | undefined) => {
  if (!words) return true;
  const totalWords = words.reduce((count, entry) => {
    return count + entry.trim().split(/\s+/).filter((w) => w.length > 0).length;
  }, 0);
  return totalWords <= 450;
};

const defaultBehavior = {
  hotkey: "Right Control",
  toggleMode: true,
  notifications: true,
  clipboard: {
    append: true,
    minDuration: 0.6,
    maxDuration: 300,
  },
};

const defaultPaths = {
  logs: "~/.config/voice-cli/logs/",
};

const defaultTranscription = {
  language: "en",
};

export const ConfigSchema = z.object({
  apiKeys: z.object({
    groq: z
      .string()
      .startsWith("gsk_", { message: "Groq API key must start with 'gsk_'" })
      .min(10, { message: "Groq API key is too short" }),
    deepgram: z
      .string()
      .regex(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        { message: "Deepgram API key must be a valid UUID" }
      ),
  }),
  behavior: z.object({
    hotkey: z.string().default(defaultBehavior.hotkey),
    toggleMode: z.boolean().default(defaultBehavior.toggleMode),
    notifications: z.boolean().default(defaultBehavior.notifications),
    clipboard: z.object({
      append: z.boolean().default(defaultBehavior.clipboard.append),
      minDuration: z.number().min(0.6).default(defaultBehavior.clipboard.minDuration),
      maxDuration: z.number().max(300).default(defaultBehavior.clipboard.maxDuration), // 5 minutes in seconds
    }).default(defaultBehavior.clipboard),
  }).default(defaultBehavior),
  paths: z.object({
    logs: z.string().default(defaultPaths.logs),
  }).default(defaultPaths),
  transcription: z.object({
    boostWords: z
      .array(z.string())
      .optional()
      .refine(boostWordsValidator, {
        message: "Boost words limit exceeded: Maximum 450 words allowed.",
      }),
    language: z.string().default(defaultTranscription.language),
  }).default(defaultTranscription),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * interface representing the raw config file structure before default application
 * (Useful if we want to type the partial JSON read from disk)
 */
export type ConfigFile = z.input<typeof ConfigSchema>;
