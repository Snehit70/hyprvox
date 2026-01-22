import { loadConfig } from "./src/config/loader";

try {
  console.log("Loading configuration...");
  const config = loadConfig();
  console.log("Config loaded successfully!");
  console.log("Active settings:");
  console.log(`- Hotkey: ${config.behavior.hotkey}`);
  console.log(`- Language: ${config.transcription.language}`);
  console.log(`- Logs: ${config.paths.logs}`);
} catch (error) {
  console.error("Startup failed:");
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
}
