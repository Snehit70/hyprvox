import { writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { ConfigFileSchema, type ConfigFile } from "./schema";
import { resolvePath, DEFAULT_CONFIG_FILE } from "./loader";
import { AppError } from "../utils/errors";
import { ErrorTemplates, formatUserError } from "../utils/error-templates";

/**
 * Saves the configuration to disk.
 * Validates the config before writing.
 * Creates the directory if it doesn't exist.
 * Sets file permissions to 600 (read/write only for owner).
 * 
 * @param config The configuration object to save
 * @param path Optional path to save to (defaults to ~/.config/voice-cli/config.json)
 */
export const saveConfig = (config: ConfigFile, path: string = DEFAULT_CONFIG_FILE): void => {
  const result = ConfigFileSchema.safeParse(config);
  
  if (!result.success) {
    const errorMessages = result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("\n");
    throw new AppError("VALIDATION_FAILED", `Config validation failed:\n${errorMessages}`);
  }
  
  const dataToWrite = result.data;
  const resolvedPath = resolvePath(path);
  
  const dir = dirname(resolvedPath);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (error: any) {
      throw new AppError("WRITE_FAILED", formatUserError(ErrorTemplates.CONFIG.WRITE_FAILED), { 
        originalError: error,
        message: error?.message || String(error)
      });
    }
  }
  
  try {
    writeFileSync(resolvedPath, JSON.stringify(dataToWrite, null, 2));
    
    chmodSync(resolvedPath, 0o600);
  } catch (error: any) {
    throw new AppError("WRITE_FAILED", formatUserError(ErrorTemplates.CONFIG.WRITE_FAILED), { 
      originalError: error,
      message: error?.message || String(error)
    });
  }
};
