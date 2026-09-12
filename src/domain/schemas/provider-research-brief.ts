import { z } from "zod";
import { InsuranceLineSchema } from "./insurance-line.js";
import { IsoDateTimeSchema } from "./common.js";

export const ProviderTypeSchema = z.enum([
  "carrier",
  "captive_agent",
  "independent_agent",
  "broker",
  "marketplace",
  "benefits_administrator",
  "demo_counterparty",
  "unknown",
]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const LicenseVerificationStatusSchema = z.enum([
  "verified",
  "unverified",
  "not_applicable",
  "conflicting",
]);
export type LicenseVerificationStatus = z.infer<
  typeof LicenseVerificationStatusSchema
>;

export const EligibilityStatusSchema = z.enum([
  "eligible",
  "ineligible",
  "unknown",
]);

/** One cited research claim backing a provider fact. (Spec §16) */
export const ResearchSourceSchema = z.object({
  title: z.string(),
  url: z.string().nullable().default(null),
  publisher: z.string().nullable().default(null),
  retrievedAt: IsoDateTimeSchema.nullable().default(null),
  excerpt: z.string().nullable().default(null),
  officialSource: z.boolean().default(false),
  confidence: z.number().min(0).max(1),
});
export type ResearchSource = z.infer<typeof ResearchSourceSchema>;

/** Transparent breakdown of the deterministic ranking score. (Spec §16 stage 2) */
export const RankingScoreBreakdownSchema = z.object({
  normalizedRating: z.number(),
  reviewVolumeConfidence: z.number(),
  ratingSourceQuality: z.number(),
  ratingRecency: z.number(),
  coverageFit: z.number(),
  contactability: z.number(),
  total: z.number(),
});
export type RankingScoreBreakdown = z.infer<typeof RankingScoreBreakdownSchema>;

/**
 * ProviderResearchBrief — everything known about one candidate provider,
 * source-backed. Person 4 produces these; Person 2 stores them. (Spec §9.6)
 */
export const ProviderResearchBriefSchema = z.object({
  providerId: z.string(),
  providerName: z.string(),
  providerType: ProviderTypeSchema,
  insuranceLinesOffered: z.array(InsuranceLineSchema).default([]),
  geographicAvailability: z.array(z.string()).default([]),
  website: z.string().nullable().default(null),
  publicContact: z.record(z.string(), z.unknown()).nullable().default(null),
  businessHours: z.record(z.string(), z.unknown()).nullable().default(null),
  officialSource: z.boolean().default(false),
  licenseVerificationStatus: LicenseVerificationStatusSchema.default("unverified"),
  publicDiscounts: z.array(z.string()).default([]),
  publicBundlePrograms: z.array(z.string()).default([]),
  publicCoverageOptions: z.array(z.string()).default([]),
  paymentOptions: z.array(z.string()).default([]),
  eligibilityNotes: z.array(z.string()).default([]),
  researchQuestions: z.array(z.string()).default([]),
  reputationSignals: z.array(z.string()).default([]),
  reviewCount: z.number().int().nullable().default(null),
  rating: z.number().nullable().default(null),
  ratingScale: z.number().nullable().default(null),
  ratingSource: z.string().nullable().default(null),
  ratingSourceUrl: z.string().nullable().default(null),
  normalizedRating: z.number().min(0).max(100).nullable().default(null),
  ratingRecency: z.string().nullable().default(null),
  ratingConfidence: z.number().min(0).max(1).nullable().default(null),
  eligibilityStatus: EligibilityStatusSchema.default("unknown"),
  exclusionReasons: z.array(z.string()).default([]),
  topFiveRank: z.number().int().nullable().default(null),
  rankingScoreBreakdown: RankingScoreBreakdownSchema.nullable().default(null),
  selectionExplanation: z.string().nullable().default(null),
  warnings: z.array(z.string()).default([]),
  researchSources: z.array(ResearchSourceSchema).default([]),
  retrievedAt: IsoDateTimeSchema.nullable().default(null),
  confidence: z.number().min(0).max(1).default(0.5),
  simulated: z.boolean().default(true),
});
export type ProviderResearchBrief = z.infer<typeof ProviderResearchBriefSchema>;

/**
 * ProviderRankingResult — the deterministic Top 5 outcome for a workflow.
 * Exactly five ranked providers when five eligible exist; otherwise all
 * eligible + a blocking warning (never invent companies). (Spec §16)
 */
export const ProviderRankingResultSchema = z.object({
  workflowId: z.string(),
  quoteRequestId: z.string(),
  rankedProviders: z.array(ProviderResearchBriefSchema),
  excludedProviders: z.array(ProviderResearchBriefSchema).default([]),
  hasFiveEligible: z.boolean(),
  warning: z.string().nullable().default(null),
  generatedAt: IsoDateTimeSchema,
});
export type ProviderRankingResult = z.infer<typeof ProviderRankingResultSchema>;
