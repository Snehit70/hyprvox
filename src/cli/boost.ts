import { Command } from "commander";
import { loadConfig, DEFAULT_CONFIG_FILE } from "../config/loader";
import { saveConfig } from "../config/writer";
import { logger } from "../utils/logger";

export const boostCommand = new Command("boost")
  .description("Manage boost words (custom vocabulary)")
  .summary("manage boost words");

boostCommand
  .command("list")
  .description("List all boost words")
  .action(() => {
    try {
      const config = loadConfig();
      const words = config.transcription.boostWords || [];
      
      if (words.length === 0) {
        console.log("No boost words configured.");
        return;
      }
      
      console.log(`Boost Words (${words.length}/450):`);
      console.log("------------------------");
      words.forEach((word) => console.log(`- ${word}`));
      console.log("------------------------");
    } catch (error) {
      console.error("Failed to list boost words:", (error as Error).message);
    }
  });

boostCommand
  .command("add <words...>")
  .description("Add one or more boost words")
  .action((words: string[]) => {
    try {
      const config = loadConfig();
      const currentWords = config.transcription.boostWords || [];
      
      const newWords = words.filter(w => !currentWords.includes(w));
      
      if (newWords.length === 0) {
        console.log("All words already exist in the list.");
        return;
      }
      
      const updatedWords = [...currentWords, ...newWords];
      
      const configToSave = {
        apiKeys: config.apiKeys,
        behavior: config.behavior,
        paths: config.paths,
        transcription: {
            ...config.transcription,
            boostWords: updatedWords
        }
      };
      
      saveConfig(configToSave);
      console.log(`Added ${newWords.length} words.`);
      console.log(`Total: ${updatedWords.length}/450`);
    } catch (error) {
      console.error("Failed to add boost words:", (error as Error).message);
    }
  });

boostCommand
  .command("remove <words...>")
  .description("Remove one or more boost words")
  .action((words: string[]) => {
    try {
      const config = loadConfig();
      const currentWords = config.transcription.boostWords || [];
      
      const wordsToRemove = new Set(words);
      const updatedWords = currentWords.filter(w => !wordsToRemove.has(w));
      
      if (updatedWords.length === currentWords.length) {
        console.log("No matching words found to remove.");
        return;
      }
      
      const configToSave = {
        apiKeys: config.apiKeys,
        behavior: config.behavior,
        paths: config.paths,
        transcription: {
            ...config.transcription,
            boostWords: updatedWords
        }
      };
      
      saveConfig(configToSave);
      console.log(`Removed ${currentWords.length - updatedWords.length} words.`);
      console.log(`Total: ${updatedWords.length}/450`);
    } catch (error) {
      console.error("Failed to remove boost words:", (error as Error).message);
    }
  });

boostCommand
  .command("clear")
  .description("Remove all boost words")
  .action(() => {
    try {
      const config = loadConfig();
      
      if ((config.transcription.boostWords || []).length === 0) {
        console.log("List is already empty.");
        return;
      }
      
      const configToSave = {
        apiKeys: config.apiKeys,
        behavior: config.behavior,
        paths: config.paths,
        transcription: {
            ...config.transcription,
            boostWords: []
        }
      };
      
      saveConfig(configToSave);
      console.log("All boost words cleared.");
    } catch (error) {
      console.error("Failed to clear boost words:", (error as Error).message);
    }
  });
