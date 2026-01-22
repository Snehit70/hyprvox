import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ConfigSchema, type Config, type ConfigFile } from "./schema";
import { ErrorTemplates, formatUserError } from "../utils/error-templates";
import { AppError } from "../utils/errors";

export const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "voice-cli");
export const DEFAULT_CONFIG_FILE = join(DEFAULT_CONFIG_DIR, "config.json");

/**
 * Resolves the path with ~ expansion.
 * Essential for handling user-friendly paths in config.
 */
export const resolvePath = (path: string): string => {
  if (path.startsWith("~")) {
    return join(homedir(), path.slice(1));
  }
  return resolve(path);
};

let cachedConfig: Config | null = null;

/**
 * Loads and validates the configuration.
 * Prioritizes config file, falls back to environment variables for API keys.
 * Handles permission checks and path resolution.
 * @throws {AppError} if config is corrupted or validation fails
 */
export const loadConfig = (configPath: string = DEFAULT_CONFIG_FILE, forceReload: boolean = false): Config => {
  if (cachedConfig && !forceReload && configPath === DEFAULT_CONFIG_FILE) {
    return cachedConfig;
  }

  let fileConfig: unknown = {};

  if (existsSync(configPath)) {
    // Check permissions
    const stats = statSync(configPath);
    const mode = stats.mode & 0o777;
    if (mode !== 0o600) {
      console.warn(
        `WARNING: Config file permissions are ${mode.toString(8)}. ` +
          `It is recommended to set them to 600 (chmod 600 ${configPath}).`
      );
    }

    try {
      const content = readFileSync(configPath, "utf-8");
      fileConfig = JSON.parse(content);
    } catch (error) {
      throw new AppError("CORRUPTED", formatUserError(ErrorTemplates.CONFIG.CORRUPTED));
    }
  }

  // Environment variable fallback
  const envConfig = {
    apiKeys: {
      groq: process.env.GROQ_API_KEY,
      deepgram: process.env.DEEPGRAM_API_KEY,
    },
  };

  // Merge logic: File config > Env config
  // We explicitly handle the merge to ensure deep merging of API keys
  const parsedFileConfig = fileConfig as Partial<ConfigFile>;
  
  const mergedConfig = {
    ...parsedFileConfig,
    apiKeys: {
      groq: parsedFileConfig.apiKeys?.groq ?? envConfig.apiKeys.groq,
      deepgram: parsedFileConfig.apiKeys?.deepgram ?? envConfig.apiKeys.deepgram,
    },
    // Other sections are handled by Zod defaults if missing
  };

  const result = ConfigSchema.safeParse(mergedConfig);

  if (!result.success) {
    const errorMessages = result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("\n");
    throw new AppError("VALIDATION_FAILED", `Config validation failed:\n${errorMessages}`);
  }

  // Post-processing: Resolve paths
  const config = result.data;
  config.paths.logs = resolvePath(config.paths.logs);
  config.paths.history = resolvePath(config.paths.history);

  if (configPath === DEFAULT_CONFIG_FILE) {
    cachedConfig = config;
  }

  return config;
};
