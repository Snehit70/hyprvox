import { Command } from "commander";
import * as colors from "yoctocolors";
import { loadConfig } from "../config/loader";
import { saveConfig } from "../config/writer";
import { buildContextLexicon } from "../transcribe/lexicon";
import { ErrorTemplates, formatUserError } from "../utils/error-templates";

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
				console.log(colors.yellow("No boost words configured."));
				return;
			}

			console.log(
				`${colors.bold("Boost Words")} (${colors.cyan(words.length.toString())}/450):`,
			);
			console.log(colors.dim("------------------------"));
			for (const word of words) {
				console.log(`${colors.green("-")} ${word}`);
			}
			console.log(colors.dim("------------------------"));
		} catch (error) {
			console.error(
				colors.red("Failed to list boost words:"),
				(error as Error).message,
			);
		}
	});

boostCommand
	.command("lexicon")
	.description("Show computed project lexicon terms")
	.action(() => {
		try {
			const config = loadConfig();
			const terms = buildContextLexicon({
				boostWords: config.transcription.boostWords || [],
			});

			if (terms.length === 0) {
				console.log(colors.yellow("No lexicon terms found."));
				return;
			}

			console.log(
				`${colors.bold("Project Lexicon")} (${colors.cyan(terms.length.toString())} terms):`,
			);
			console.log(colors.dim("------------------------"));
			for (const term of terms) {
				console.log(`${colors.green("-")} ${term}`);
			}
			console.log(colors.dim("------------------------"));
		} catch (error) {
			console.error(
				colors.red("Failed to build project lexicon:"),
				(error as Error).message,
			);
		}
	});

boostCommand
	.command("add <words...>")
	.description("Add one or more boost words")
	.action((words: string[]) => {
		try {
			const config = loadConfig();
			const currentWords = config.transcription.boostWords || [];

			const newWords = words.filter((w) => !currentWords.includes(w));

			if (newWords.length === 0) {
				console.log(colors.yellow("All words already exist in the list."));
				return;
			}

			const updatedWords = [...currentWords, ...newWords];

			if (updatedWords.length > 450) {
				const error = formatUserError(
					ErrorTemplates.VALIDATION.BOOST_WORDS_LIMIT,
				);
				console.error(colors.red(error));
				return;
			}

			const configToSave = {
				apiKeys: config.apiKeys,
				behavior: config.behavior,
				paths: config.paths,
				transcription: {
					...config.transcription,
					boostWords: updatedWords,
				},
			};

			saveConfig(configToSave);
			console.log(
				`${colors.green("✅")} Added ${colors.bold(newWords.length.toString())} words.`,
			);
			console.log(
				`${colors.dim("Total:")} ${colors.cyan(updatedWords.length.toString())}/450`,
			);
		} catch (error) {
			console.error(
				colors.red("Failed to add boost words:"),
				(error as Error).message,
			);
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
			const updatedWords = currentWords.filter((w) => !wordsToRemove.has(w));

			if (updatedWords.length === currentWords.length) {
				console.log(colors.yellow("No matching words found to remove."));
				return;
			}

			const configToSave = {
				apiKeys: config.apiKeys,
				behavior: config.behavior,
				paths: config.paths,
				transcription: {
					...config.transcription,
					boostWords: updatedWords,
				},
			};

			saveConfig(configToSave);
			console.log(
				`${colors.green("✅")} Removed ${colors.bold((currentWords.length - updatedWords.length).toString())} words.`,
			);
			console.log(
				`${colors.dim("Total:")} ${colors.cyan(updatedWords.length.toString())}/450`,
			);
		} catch (error) {
			console.error(
				colors.red("Failed to remove boost words:"),
				(error as Error).message,
			);
		}
	});

boostCommand
	.command("clear")
	.description("Remove all boost words")
	.action(() => {
		try {
			const config = loadConfig();

			if ((config.transcription.boostWords || []).length === 0) {
				console.log(colors.yellow("List is already empty."));
				return;
			}

			const configToSave = {
				apiKeys: config.apiKeys,
				behavior: config.behavior,
				paths: config.paths,
				transcription: {
					...config.transcription,
					boostWords: [],
				},
			};

			saveConfig(configToSave);
			console.log(`${colors.green("✅")} All boost words cleared.`);
		} catch (error) {
			console.error(
				colors.red("Failed to clear boost words:"),
				(error as Error).message,
			);
		}
	});
