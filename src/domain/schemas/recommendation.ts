import { z } from "zod";
import { IsoDateTimeSchema } from "./common.js";

/** One ranked line in the final recommendation. */
export const RankedResultSchema = z.object({
  quoteId: z.string(),
  providerId: z.string(),
  rank: z.number().int(),
  score: z.number(),
  qualifies: z.boolean(),
  disqualificationReasons: z.array(z.string()).default([]),
});
export type RankedResult = z.infer<typeof RankedResultSchema>;

/**
 * Recommendation — deterministic ranking + explanation. An LLM may write the
 * wording but must not change the ranking. The user's selection is tracked
 * separately from the system recommendation. (Spec §9.11, §28)
 */
export const RecommendationSchema = z.object({
  workflowId: z.string(),
  comparableQuoteIds: z.array(z.string()).default([]),
  nonComparableQuoteIds: z.array(z.string()).default([]),
  rankedResults: z.array(RankedResultSchema).default([]),
  recommendedQuoteId: z.string().nullable().default(null),
  userSelectedNegotiationQuoteId: z.string().nullable().default(null),
  selectionDiffersFromRecommendation: z.boolean().default(false),
  alternativeQuoteIds: z.array(z.string()).default([]),
  privateConstraintEvaluation: z.record(z.string(), z.unknown()).default({}),
  coverageComparison: z.record(z.string(), z.unknown()).default({}),
  costComparison: z.record(z.string(), z.unknown()).default({}),
  riskWarnings: z.array(z.string()).default([]),
  explanation: z.string().nullable().default(null),
  savingsVsCurrentPolicy: z.number().nullable().default(null),
  savingsFromNegotiation: z.number().nullable().default(null),
  evidenceIds: z.array(z.string()).default([]),
  requiredHumanFollowUp: z.array(z.string()).default([]),
  generatedAt: IsoDateTimeSchema,
});
export type Recommendation = z.infer<typeof RecommendationSchema>;
