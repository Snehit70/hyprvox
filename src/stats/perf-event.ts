import { z } from "zod";

export const QualityReasonSchema = z.enum([
	"prompt_artifact",
	"cot_meta",
	"token_injection",
	"hallucination_suffix",
	"mixed_script",
	"garbage",
]);

export type QualityReason = z.infer<typeof QualityReasonSchema>;

const FallbackSourceSchema = z.enum(["none", "groq", "deepgram"]);

function timestampFrom(raw: Record<string, unknown>): string {
	if (typeof raw.timestamp === "string") return raw.timestamp;
	if (typeof raw.time === "string") return raw.time;
	if (typeof raw.time === "number" && Number.isFinite(raw.time)) {
		return new Date(raw.time).toISOString();
	}
	return new Date().toISOString();
}

export const PerfEventSchema = z
	.object({
		timestamp: z.string(),
		processingMs: z.number().finite().nonnegative(),
		engine: z.string().optional(),
		mergeStrategy: z.string().default("unknown"),
		mergeReason: z.string().nullable().default(null),
		validationReasons: z.array(QualityReasonSchema).default([]),
		validationRetryCount: z.number().int().nonnegative().default(0),
		validationFallbackSource: FallbackSourceSchema.default("none"),
		groqSttModel: z.string().optional(),
		deepgramModel: z.string().optional(),
		mergeModel: z.string().optional(),
		groqChunkingEnabled: z.boolean().optional(),
		groqChunkingUsed: z.boolean().optional(),
		groqChunkCount: z.number().int().nonnegative().optional(),
		groqChunkDurationSeconds: z.number().nonnegative().optional(),
		groqChunkOverlapSeconds: z.number().nonnegative().optional(),
		groqChunkFallback: z.boolean().optional(),
		groqChunkFailureReason: z.string().nullable().optional(),
		groqChunkMode: z.literal("live").optional(),
		groqLiveCompletedBeforeStop: z.boolean().optional(),
		groqLivePreStopCompletedChunks: z.number().int().nonnegative().optional(),
		groqLivePostStopWaitMs: z.number().optional(),
		groqLiveFinalizeTimedOut: z.boolean().optional(),
		groqLiveFinalTailMs: z.number().optional(),
		groqLiveBackgroundRequestMs: z.number().optional(),
	})
	.passthrough();

export type PerfEvent = z.infer<typeof PerfEventSchema>;

export function parsePerfEvent(raw: unknown): PerfEvent | null {
	if (typeof raw !== "object" || raw === null) return null;
	const record = raw as Record<string, unknown>;
	const parsed = PerfEventSchema.safeParse({
		...record,
		timestamp: timestampFrom(record),
	});
	return parsed.success ? parsed.data : null;
}
