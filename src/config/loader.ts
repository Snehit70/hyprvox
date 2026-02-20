import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ErrorTemplates, formatUserError } from "../utils/error-templates";
import { AppError } from "../utils/errors";
import { type Config, type ConfigFile, ConfigSchema } from "./schema";

export const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "hypr", "vox");
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
let reloadInProgress = false;

/**
 * Clears the cached config, forcing next loadConfig() to read from file.
 * Useful for config reload scenarios.
 */
export const clearConfigCache = (): void => {
	cachedConfig = null;
};

/**
 * Result of a config load attempt.
 * Used by reloadConfig() to return success/failure without throwing.
 */
export interface ConfigLoadResult {
	success: boolean;
	config?: Config;
	error?: string;
}

/**
 * Attempts to load config without throwing.
 * Returns a result object indicating success/failure.
 * Used internally by reloadConfig() for safe config reloading.
 */
export const tryLoadConfig = (
	configPath: string = DEFAULT_CONFIG_FILE,
): ConfigLoadResult => {
	try {
		const config = loadConfig(configPath, true);
		return { success: true, config };
	} catch (error) {
		const message = error instanceof AppError ? error.message : String(error);
		return { success: false, error: message };
	}
};

/**
 * Reloads config from file with validation.
 * Thread-safe: concurrent calls return false if a reload is already in progress.
 * On failure, retains the previous config and logs the error.
 * @returns true if reload succeeded, false if failed or another reload is in progress
 */
export const reloadConfig = (
	configPath: string = DEFAULT_CONFIG_FILE,
): ConfigLoadResult => {
	if (reloadInProgress) {
		return { success: false, error: "Reload already in progress" };
	}

	reloadInProgress = true;
	try {
		const result = tryLoadConfig(configPath);
		if (result.success && result.config) {
			if (configPath === DEFAULT_CONFIG_FILE) {
				cachedConfig = result.config;
			}
		}
		return result;
	} finally {
		reloadInProgress = false;
	}
};

/**
 * Loads and validates the configuration.
 * Prioritizes config file, falls back to environment variables for API keys.
 * Handles permission checks and path resolution.
 * @throws {AppError} if config is corrupted or validation fails
 */
export const loadConfig = (
	configPath: string = DEFAULT_CONFIG_FILE,
	forceReload: boolean = false,
): Config => {
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
					`It is recommended to set them to 600 (chmod 600 ${configPath}).`,
			);
		}

		try {
			const content = readFileSync(configPath, "utf-8");
			fileConfig = JSON.parse(content);
		} catch (_error) {
			throw new AppError(
				"CORRUPTED",
				formatUserError(ErrorTemplates.CONFIG.CORRUPTED),
			);
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
			deepgram:
				parsedFileConfig.apiKeys?.deepgram ?? envConfig.apiKeys.deepgram,
		},
		// Other sections are handled by Zod defaults if missing
	};

	const result = ConfigSchema.safeParse(mergedConfig);

	if (!result.success) {
		const errorMessages = result.error.issues
			.map((e) => `${e.path.join(".")}: ${e.message}`)
			.join("\n");
		throw new AppError(
			"VALIDATION_FAILED",
			`Config validation failed:\n${errorMessages}`,
		);
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
