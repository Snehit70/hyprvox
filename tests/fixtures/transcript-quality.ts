import type { TranscriptQualityReason } from "../../src/transcribe/quality";

export interface QualityFixture {
	name: string;
	input: string;
	expectedValid: boolean;
	expectedReasons: TranscriptQualityReason[];
	expectedText?: string;
}

export const promptArtifactFixtures: QualityFixture[] = [
	{
		name: "preserve terms order",
		input:
			"We need to update the merge prompt. Preserve the following terms in the following order.",
		expectedValid: false,
		expectedReasons: ["prompt_artifact"],
	},
	{
		name: "preserve commands app",
		input:
			"The CLI should expose status and health checks. Preserve the following commands for the app.",
		expectedValid: false,
		expectedReasons: ["prompt_artifact"],
	},
	{
		name: "preserve commands format",
		input:
			"Let's clean the docs and examples. Preserve the following commands in a good format.",
		expectedValid: false,
		expectedReasons: ["prompt_artifact"],
	},
	{
		name: "preserve first terms leaked",
		input: "The timer issue is still fragile. Preserve the first two terms.",
		expectedValid: false,
		expectedReasons: ["prompt_artifact"],
	},
	{
		name: "preserve whole layer leaked",
		input:
			"Preserve the whole threatened layer and then also improve the whole performance of it.",
		expectedValid: false,
		expectedReasons: ["prompt_artifact"],
	},
	{
		name: "preserve min max wording leaked",
		input:
			"Preserve the minimum of words and sentences in the language. Preserve the maximum of words and sentences in the language.",
		expectedValid: false,
		expectedReasons: ["prompt_artifact"],
	},
	{
		name: "merge instruction leaked",
		input:
			"Use the Deepgram version for the first sentence. Merge the two transcripts.",
		expectedValid: false,
		expectedReasons: ["prompt_artifact"],
	},
	{
		name: "transcript labels leaked",
		input:
			"Transcript 1 has the right file name. Transcript 2 has the right command.",
		expectedValid: false,
		expectedReasons: ["prompt_artifact"],
	},
	{
		name: "multiline transcript labels leaked",
		input: "Transcript 1:\nUse AGENTS.md.\n\nTranscript 2:\nUse agents dot MD.",
		expectedValid: false,
		expectedReasons: ["prompt_artifact"],
	},
];

export const promptArtifactFalsePositiveFixtures: QualityFixture[] = [
	{
		name: "ordinary preserve request",
		input:
			"We should preserve the user's original wording as much as possible.",
		expectedValid: true,
		expectedReasons: [],
	},
	{
		name: "literal transcript discussion",
		input: "Add a section explaining how transcript history is stored locally.",
		expectedValid: true,
		expectedReasons: [],
	},
];

export const suffixFixtures: QualityFixture[] = [
	{
		name: "thank you for watching suffix",
		input: "We should improve the navigation bar. Thank you for watching.",
		expectedValid: true,
		expectedReasons: ["hallucination_suffix"],
		expectedText: "We should improve the navigation bar.",
	},
	{
		name: "thanks for watching suffix",
		input:
			"The daemon should keep recording state consistent. Thanks for watching.",
		expectedValid: true,
		expectedReasons: ["hallucination_suffix"],
		expectedText: "The daemon should keep recording state consistent.",
	},
	{
		name: "link in description suffix",
		input:
			"Let's test the crash recovery flow. If you want to know more about the software development process, please visit the link in the description.",
		expectedValid: true,
		expectedReasons: ["hallucination_suffix"],
		expectedText: "Let's test the crash recovery flow.",
	},
	{
		name: "subscribe suffix",
		input: "Update the health command output. Please subscribe.",
		expectedValid: true,
		expectedReasons: ["hallucination_suffix"],
		expectedText: "Update the health command output.",
	},
];

export const mixedScriptFixtures: QualityFixture[] = [
	{
		name: "hangul fragment",
		input: "The response format should remain the same 녹 complaint and edit.",
		expectedValid: false,
		expectedReasons: ["mixed_script"],
	},
	{
		name: "arabic fragment",
		input: "Keep the admin console wording but remove the مشكله fragment.",
		expectedValid: false,
		expectedReasons: ["mixed_script"],
	},
	{
		name: "thai fragment",
		input: "The fallback path should not include random สวัสดี characters.",
		expectedValid: false,
		expectedReasons: ["mixed_script"],
	},
	{
		name: "cyrillic fragment",
		input: "The replay output should not keep странный garbage in English mode.",
		expectedValid: false,
		expectedReasons: ["mixed_script"],
	},
];

export const garbageFixtures: QualityFixture[] = [
	{
		name: "pseudo english word salad",
		input:
			"For people like me whose transcription go up to 5-10 minutes. unters Puighmmbrquy, Loy Gotta W olla!",
		expectedValid: false,
		expectedReasons: ["garbage"],
	},
];

export const exactTokenFixtures = [
	{
		name: "filename split",
		groqText: "Open AGENTS.md and update the workflow notes.",
		deepgramText: "Open agents dot MD and update the workflow notes.",
	},
	{
		name: "acronym corruption",
		groqText: "The API should expose CRUD operations over SSE.",
		deepgramText: "The API should expose cred operations over essay.",
	},
	{
		name: "tool name corruption",
		groqText: "Ask CodeRabbit to recheck the pull request.",
		deepgramText: "Ask code rabbit to recheck the pull request.",
	},
];
