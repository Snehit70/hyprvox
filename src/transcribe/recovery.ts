import type { MergeReason, MergeResult, MergeStrategy } from "./merger";
import {
	type TranscriptQualityReason,
	type TranscriptQualityResult,
	validateTranscript,
} from "./quality";

export interface TranscriptRecoveryInput {
	finalText: string;
	groqText: string;
	deepgramText: string;
	mergeStrategy: MergeStrategy | "skip_no_speech" | "skip_hallucination";
	mergeReason: MergeReason | null;
	accuracy?: MergeResult["accuracy"];
	repairMerge?: (
		groqText: string,
		deepgramText: string,
		failedText: string,
		reasons: TranscriptQualityReason[],
	) => Promise<MergeResult>;
}

export interface TranscriptRecoveryResult {
	finalText: string;
	initialValidation: TranscriptQualityResult;
	validation: TranscriptQualityResult;
	mergeStrategy: MergeStrategy | "skip_no_speech" | "skip_hallucination";
	mergeReason: MergeReason | null;
	accuracy?: MergeResult["accuracy"];
	validationRetryCount: number;
	validationFallbackSource: "none" | "groq" | "deepgram";
	repairAttempted: boolean;
	repairFailed: boolean;
}

export async function recoverTranscriptQuality({
	finalText,
	groqText,
	deepgramText,
	mergeStrategy,
	mergeReason,
	accuracy,
	repairMerge,
}: TranscriptRecoveryInput): Promise<TranscriptRecoveryResult> {
	let validation = validateTranscript(finalText);
	const initialValidation = validation;
	let recoveredText = validation.text;
	let recoveredStrategy = mergeStrategy;
	let recoveredReason = mergeReason;
	let recoveredAccuracy = accuracy;
	let validationRetryCount = 0;
	let validationFallbackSource: "none" | "groq" | "deepgram" = "none";
	let repairAttempted = false;
	let repairFailed = false;

	if (!validation.valid && groqText && deepgramText && repairMerge) {
		repairAttempted = true;
		validationRetryCount = 1;

		try {
			const repair = await repairMerge(
				groqText,
				deepgramText,
				recoveredText,
				validation.reasons,
			);
			recoveredText = repair.text;
			recoveredAccuracy = repair.accuracy;
			recoveredStrategy = repair.strategy;
			recoveredReason = repair.reason;
			validation = validateTranscript(recoveredText);
			recoveredText = validation.text;
		} catch {
			repairFailed = true;
		}
	}

	if (!validation.valid) {
		const deepgramValidation = deepgramText
			? validateTranscript(deepgramText)
			: null;
		const groqValidation = groqText ? validateTranscript(groqText) : null;

		if (deepgramValidation?.valid && deepgramValidation.text) {
			recoveredText = deepgramValidation.text;
			validation = deepgramValidation;
			validationFallbackSource = "deepgram";
			recoveredStrategy = "single_source";
			recoveredReason = "deepgram_only";
		} else if (groqValidation?.valid && groqValidation.text) {
			recoveredText = groqValidation.text;
			validation = groqValidation;
			validationFallbackSource = "groq";
			recoveredStrategy = "single_source";
			recoveredReason = "groq_only";
		}
	}

	return {
		finalText: recoveredText,
		initialValidation,
		validation,
		mergeStrategy: recoveredStrategy,
		mergeReason: recoveredReason,
		accuracy: recoveredAccuracy,
		validationRetryCount,
		validationFallbackSource,
		repairAttempted,
		repairFailed,
	};
}
