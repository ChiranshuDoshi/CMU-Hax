import { z } from "zod";

export const InsuranceLineSchema = z.enum([
  "auto",
  "homeowners",
  "renters",
  "condo",
  "landlord",
  "umbrella",
  "pet",
  "travel",
  "life",
  "health",
  "disability",
  "dental",
  "vision",
  "small_business",
  "commercial_auto",
  "general_liability",
  "professional_liability",
  "workers_compensation",
  "business_owners_policy",
  "cyber",
  "commercial_property",
  "other",
]);

export const MoneySchema = z.strictObject({
  amountCents: z.number().int().nonnegative(),
  currency: z.string().length(3).default("USD"),
});

export const BillingFrequencySchema = z.enum([
  "one_time",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
  "policy_term",
]);

export const EvidenceTypeSchema = z.enum([
  "document",
  "transcript",
  "audio",
  "provider_document",
  "web_source",
  "user_confirmation",
  "demo_fixture",
]);

export const VerificationStatusSchema = z.enum([
  "unverified",
  "user_confirmed",
  "provider_confirmed",
  "conflicting",
  "not_applicable",
]);

export const EvidenceSchema = z.strictObject({
  id: z.string().min(1),
  workflowId: z.string().min(1),
  type: EvidenceTypeSchema,
  sourceId: z.string().min(1),
  claimKey: z.string().min(1),
  claimValue: z.unknown(),
  pageNumber: z.number().int().positive().nullable().default(null),
  transcriptStartMs: z.number().int().nonnegative().nullable().default(null),
  transcriptEndMs: z.number().int().nonnegative().nullable().default(null),
  speaker: z.string().nullable().default(null),
  excerpt: z.string().nullable().default(null),
  url: z.string().url().nullable().default(null),
  retrievedAt: z.string().datetime(),
  confidence: z.number().min(0).max(1),
  verificationStatus: VerificationStatusSchema,
});

export const RequestedCoverageSchema = z.strictObject({
  coverageCode: z.string().min(1).max(80),
  insuredEntityIds: z.array(z.string().min(1).max(128)).min(1).max(50),
  required: z.boolean(),
  minimumLimitCents: z.number().int().nonnegative().nullable().default(null),
  maximumDeductibleCents: z.number().int().nonnegative().nullable().default(null),
});

export const ConfirmedQuoteRequestSchema = z.strictObject({
  id: z.string().min(1).max(128),
  workflowId: z.string().min(1).max(128),
  version: z.number().int().positive(),
  insuranceLines: z.array(InsuranceLineSchema).min(1).max(5),
  state: z.string().length(2).transform((value) => value.toUpperCase()),
  zipCode: z.string().regex(/^\d{5}(?:-\d{4})?$/),
  desiredEffectiveDate: z.string().date(),
  insuredEntityIds: z.array(z.string().min(1).max(128)).min(1).max(50),
  requestedCoverage: z.array(RequestedCoverageSchema).min(1).max(25),
  excludedProviderIds: z.array(z.string().min(1).max(128)).max(100).default([]),
  matchingMode: z.enum(["exact_match", "same_or_better", "minimum_confirmed_requirements", "user_approved_tradeoffs"]),
  specificationHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmedAt: z.string().datetime(),
});

export const ResearchSourceSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().url(),
  domain: z.string().min(1),
  publisher: z.string().min(1),
  retrievedAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable().default(null),
  excerpt: z.string().min(1),
  officialSource: z.boolean(),
  sourceKind: z.enum(["regulator", "recognized_consumer", "business_listing", "provider", "secondary", "search_snippet"]),
  confidence: z.number().min(0).max(1),
});

export const RawResearchCandidateSchema = z.strictObject({
  providerId: z.string().min(1),
  canonicalCarrierId: z.string().min(1),
  providerName: z.string().min(1),
  providerType: z.enum(["carrier", "captive_agent", "independent_agent", "broker", "marketplace", "benefits_administrator", "demo_counterparty", "unknown"]),
  insuranceLines: z.array(InsuranceLineSchema),
  nationwide: z.boolean().default(false),
  states: z.array(z.string().length(2)),
  excludedZipCodes: z.array(z.string()).default([]),
  preliminaryCoverageCodes: z.array(z.string()),
  website: z.string().url().nullable(),
  publicContact: z.string().nullable(),
  rating: z.number().nonnegative().nullable(),
  ratingScaleMaximum: z.number().positive().nullable(),
  reviewCount: z.number().int().nonnegative().nullable(),
  ratingSourceId: z.string().nullable(),
  ratingObservedAt: z.string().datetime().nullable(),
  licenseVerificationStatus: z.enum(["verified", "unverified", "not_applicable", "conflicting"]),
  publicDiscounts: z.array(z.string()).default([]),
  publicCoverageOptions: z.array(z.string()).default([]),
  sources: z.array(ResearchSourceSchema),
  simulated: z.boolean(),
});

export const RankingScoreBreakdownSchema = z.strictObject({
  normalizedRating: z.number().min(0).max(100),
  reviewConfidence: z.number().min(0).max(100),
  sourceQuality: z.number().min(0).max(100),
  recency: z.number().min(0).max(100),
  coverageFit: z.number().min(0).max(100),
  contactability: z.number().min(0).max(100),
  weightedTotal: z.number().min(0).max(100),
});

export const ProviderResearchBriefSchema = RawResearchCandidateSchema.extend({
  normalizedRating: z.number().min(0).max(100),
  ratingConfidence: z.number().min(0).max(100),
  eligibilityStatus: z.enum(["eligible", "ineligible"]),
  exclusionReasons: z.array(z.string()),
  topFiveRank: z.number().int().positive().nullable(),
  scoreBreakdown: RankingScoreBreakdownSchema,
  selectionExplanation: z.string(),
  warnings: z.array(z.string()),
});

export const ProviderRankingResultSchema = z.strictObject({
  workflowId: z.string().min(1),
  quoteRequestId: z.string().min(1),
  specificationHash: z.string().regex(/^[a-f0-9]{64}$/),
  evaluatedAt: z.string().datetime(),
  selected: z.array(ProviderResearchBriefSchema).max(5),
  eligibleAlternates: z.array(ProviderResearchBriefSchema),
  ineligible: z.array(ProviderResearchBriefSchema),
  warnings: z.array(z.string()),
});

export const RawResearchResultSchema = z.strictObject({
  candidates: z.array(RawResearchCandidateSchema),
  warnings: z.array(z.string()).default([]),
});

export const CostComponentSchema = z.strictObject({
  category: z.string().min(1),
  label: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  frequency: BillingFrequencySchema,
  termCount: z.number().int().positive(),
  required: z.boolean(),
  conditional: z.boolean(),
  refundable: z.boolean(),
  includedInQuotedTotal: z.boolean(),
  evidenceId: z.string().min(1),
});

export const DiscountSchema = z.strictObject({
  name: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  amountType: z.enum(["fixed", "percentage"]),
  applied: z.boolean(),
  conditional: z.boolean(),
  eligibilityConfirmed: z.boolean(),
  continuingEligibilityRequired: z.boolean(),
  conditions: z.array(z.string()),
  evidenceId: z.string().min(1),
});

export const CoverageItemSchema = z.strictObject({
  coverageCode: z.string().min(1),
  coverageName: z.string().min(1),
  insuredEntityIds: z.array(z.string().min(1)),
  limitCents: z.number().int().nonnegative().nullable(),
  deductibleCents: z.number().int().nonnegative().nullable(),
  included: z.boolean(),
  exclusions: z.array(z.string()),
  evidenceIds: z.array(z.string().min(1)),
});

export const RawQuoteOutcomeSchema = z.strictObject({
  quoteId: z.string().min(1),
  workflowId: z.string().min(1),
  providerId: z.string().min(1),
  sourceType: z.literal("conversation").optional(),
  sourceConversationId: z.string().min(1).nullable().optional(),
  sourceArtifactId: z.string().min(1).nullable().optional(),
  scenarioId: z.string().min(1).nullable().optional(),
  confirmedRequestId: z.string().min(1),
  specificationHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["complete", "incomplete", "declined", "failed"]),
  quoteType: z.enum(["indicative", "verbal", "written", "binding", "incomplete", "simulated"]),
  effectiveDate: z.string().date().nullable(),
  expirationDate: z.string().date().nullable(),
  quoteValidUntil: z.string().datetime().nullable().optional(),
  policyTermMonths: z.number().int().positive().nullable(),
  premiumComponents: z.array(CostComponentSchema),
  feeComponents: z.array(CostComponentSchema),
  taxComponents: z.array(CostComponentSchema),
  discounts: z.array(DiscountSchema),
  coverageItems: z.array(CoverageItemSchema),
  coveredEntityIds: z.array(z.string().min(1)),
  downPaymentCents: z.number().int().nonnegative().nullable(),
  paymentOptions: z.array(z.string()),
  exclusions: z.array(z.string()),
  conditions: z.array(z.string()),
  evidence: z.array(EvidenceSchema),
  currency: z.string().length(3).optional(),
  disclaimer: z.string().min(1).nullable().optional(),
  simulated: z.boolean(),
});

export const CoverageEquivalenceResultSchema = z.strictObject({
  status: z.enum(["equivalent", "better_than_requested", "worse_than_requested", "partially_comparable", "not_comparable", "missing_information"]),
  differences: z.array(z.string()),
});

export const RedFlagSchema = z.strictObject({
  code: z.string().min(1),
  severity: z.enum(["warning", "blocking"]),
  message: z.string().min(1),
});

export const NormalizedQuoteSchema = RawQuoteOutcomeSchema.omit({ evidence: true }).extend({
  quoteType: z.literal("simulated"),
  effectiveComparisonCostCents: z.number().int().nonnegative().nullable(),
  annualizedCostCents: z.number().int().nonnegative().nullable(),
  completenessScore: z.number().min(0).max(100),
  confidenceScore: z.number().min(0).max(100),
  coverageEquivalence: CoverageEquivalenceResultSchema,
  redFlags: z.array(RedFlagSchema),
  requiresHumanVerification: z.boolean(),
  evidenceIds: z.array(z.string().min(1)),
});

export const DisclosurePolicySchema = z.enum(["do_not_reveal_ceiling", "reveal_target_only", "reveal_range"]);

export const NegotiationGoalSchema = z.strictObject({
  id: z.string().min(1),
  workflowId: z.string().min(1),
  selectedQuoteId: z.string().min(1),
  targetProviderId: z.string().min(1),
  targetAmountCents: z.number().int().nonnegative().nullable(),
  targetRangeMinCents: z.number().int().nonnegative().nullable(),
  targetRangeMaxCents: z.number().int().nonnegative().nullable(),
  billingFrequency: BillingFrequencySchema,
  desiredNonPriceImprovements: z.array(z.string()),
  allowedTradeoffs: z.array(z.string()),
  hardStops: z.array(z.string()),
  verifiedCompetingQuoteId: z.string().nullable(),
  disclosurePolicy: DisclosurePolicySchema,
  confirmedAt: z.string().datetime(),
});

export const NegotiationEventSchema = z.strictObject({
  id: z.string().min(1),
  workflowId: z.string().min(1),
  negotiationGoalId: z.string().min(1),
  targetProviderId: z.string().min(1),
  negotiationConversationId: z.string().min(1),
  originalQuoteId: z.string().min(1),
  competingQuoteId: z.string().nullable(),
  specificationHash: z.string().regex(/^[a-f0-9]{64}$/),
  verifiedLeverageStatement: z.string().nullable(),
  requestedImprovement: z.string().min(1),
  providerResponse: z.string().min(1),
  originalCostCents: z.number().int().nonnegative(),
  finalCostCents: z.number().int().nonnegative(),
  changedCoverage: z.array(CoverageItemSchema),
  changedFees: z.array(CostComponentSchema),
  changedDiscounts: z.array(DiscountSchema),
  evidenceIds: z.array(z.string().min(1)).min(1),
  verificationStatus: VerificationStatusSchema,
});

export const NegotiatorGoalViewSchema = z.strictObject({
  goalId: z.string().min(1),
  workflowId: z.string().min(1),
  selectedQuoteId: z.string().min(1),
  targetProviderId: z.string().min(1),
  disclosedTargetAmountCents: z.number().int().nonnegative().nullable(),
  disclosedRangeMinCents: z.number().int().nonnegative().nullable(),
  disclosedRangeMaxCents: z.number().int().nonnegative().nullable(),
  billingFrequency: BillingFrequencySchema,
  desiredNonPriceImprovements: z.array(z.string()),
  allowedTradeoffs: z.array(z.string()),
  hardStopInstructions: z.array(z.string()),
});

export const LeverageSelectionSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("no_leverage_available"), reasons: z.array(z.string()) }),
  z.strictObject({
    status: z.literal("selected"),
    quoteId: z.string().min(1),
    providerId: z.string().min(1),
    effectiveComparisonCostCents: z.number().int().nonnegative(),
    specificationHash: z.string().regex(/^[a-f0-9]{64}$/),
    evidenceIds: z.array(z.string().min(1)).min(1),
    reason: z.string().min(1),
  }),
]);

export const RecommendationScoreBreakdownSchema = z.strictObject({
  cost: z.number().min(0).max(100),
  coverage: z.number().min(0).max(100),
  completeness: z.number().min(0).max(100),
  evidence: z.number().min(0).max(100),
  providerVerification: z.number().min(0).max(100),
  paymentFlexibility: z.number().min(0).max(100),
  weightedTotal: z.number().min(0).max(100),
});

export const RankedQuoteSchema = z.strictObject({
  rank: z.number().int().positive(),
  quoteId: z.string().min(1),
  providerId: z.string().min(1),
  negotiationEventId: z.string().nullable(),
  effectiveCostCents: z.number().int().nonnegative(),
  scoreBreakdown: RecommendationScoreBreakdownSchema,
  evidenceIds: z.array(z.string().min(1)),
  explanation: z.string().min(1),
});

export const RecommendationSchema = z.strictObject({
  workflowId: z.string().min(1),
  specificationHash: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.string().datetime(),
  rankedQualifyingQuotes: z.array(RankedQuoteSchema),
  disqualifiedQuotes: z.array(z.strictObject({ quoteId: z.string().min(1), reasons: z.array(z.string()).min(1) })),
  recommendedQuoteId: z.string().nullable(),
  lowestPriceEquivalentQuoteId: z.string().nullable(),
  bestCoverageQuoteId: z.string().nullable(),
  bestValueAlternativeQuoteId: z.string().nullable(),
  userSelectedNegotiationQuoteId: z.string().nullable(),
  selectionDiffersFromRecommendation: z.boolean(),
  savingsFromNegotiationCents: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  evidenceIds: z.array(z.string().min(1)),
  requiresHumanFollowUp: z.boolean(),
});

export const RecommendedDealSchema = z.strictObject({
  providerId: z.string().min(1),
  providerName: z.string().min(1),
  quoteId: z.string().min(1),
  scenarioId: z.string().min(1).nullable(),
  sourceConversationId: z.string().min(1).nullable().optional(),
  currency: z.string().length(3),
  effectiveComparisonCostCents: z.number().int().positive(),
  annualizedCostCents: z.number().int().positive().nullable(),
  policyTermMonths: z.number().int().positive(),
  quoteValidUntil: z.string().datetime(),
  coverageEquivalence: CoverageEquivalenceResultSchema,
  recommendationScore: z.number().min(0).max(100),
  selectionExplanation: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
  simulated: z.literal(true),
  requiresHumanVerification: z.literal(true),
  disclaimer: z.string().min(1),
});

export const NegotiationHandoffSchema = z.strictObject({
  workflowId: z.string().min(1),
  specificationHash: z.string().regex(/^[a-f0-9]{64}$/),
  target: RecommendedDealSchema,
  verifiedCompetingQuote: z
    .strictObject({
      providerId: z.string().min(1),
      providerName: z.string().min(1),
      quoteId: z.string().min(1),
      effectiveComparisonCostCents: z.number().int().positive(),
      coverageEquivalence: CoverageEquivalenceResultSchema,
      evidenceIds: z.array(z.string().min(1)).min(1),
    })
    .nullable(),
  requestedOutcome: z.literal("lower_price_with_same_or_better_coverage"),
  selectionSource: z.literal("system_recommendation"),
  generatedAt: z.string().datetime(),
});

export type ConfirmedQuoteRequest = z.infer<typeof ConfirmedQuoteRequestSchema>;
export type CoverageItem = z.infer<typeof CoverageItemSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type NegotiationEvent = z.infer<typeof NegotiationEventSchema>;
export type NegotiationGoal = z.infer<typeof NegotiationGoalSchema>;
export type NegotiatorGoalView = z.infer<typeof NegotiatorGoalViewSchema>;
export type LeverageSelection = z.infer<typeof LeverageSelectionSchema>;
export type NormalizedQuote = z.infer<typeof NormalizedQuoteSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type RecommendedDeal = z.infer<typeof RecommendedDealSchema>;
export type NegotiationHandoff = z.infer<typeof NegotiationHandoffSchema>;
export type ProviderRankingResult = z.infer<typeof ProviderRankingResultSchema>;
export type ProviderResearchBrief = z.infer<typeof ProviderResearchBriefSchema>;
export type RawQuoteOutcome = z.infer<typeof RawQuoteOutcomeSchema>;
export type RawResearchCandidate = z.infer<typeof RawResearchCandidateSchema>;
export type RawResearchResult = z.infer<typeof RawResearchResultSchema>;
export type ResearchSource = z.infer<typeof ResearchSourceSchema>;

export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
});
