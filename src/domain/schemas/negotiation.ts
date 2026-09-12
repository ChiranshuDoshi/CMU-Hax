import { z } from "zod";
import { IsoDateTimeSchema, BillingPeriodSchema } from "./common.js";

/**
 * Disclosure policy — how much of the user's target the Negotiator may reveal
 * to the provider. Default is do_not_reveal_ceiling. (Spec §9.9)
 */
export const DisclosurePolicySchema = z.enum([
  "do_not_reveal_ceiling",
  "reveal_target_only",
  "reveal_range",
]);
export type DisclosurePolicy = z.infer<typeof DisclosurePolicySchema>;

/**
 * NegotiationGoal — created ONLY after quotes are ready and the user explicitly
 * selects one quote. The server keeps the full goal private; the Negotiator
 * only ever sees the fields allowed by `disclosurePolicy`. (Spec §9.9)
 */
export const NegotiationGoalSchema = z
  .object({
    goalId: z.string(),
    workflowId: z.string(),
    selectedQuoteId: z.string(),
    targetProviderId: z.string(),
    targetAmount: z.number().nullable().default(null),
    targetBillingPeriod: BillingPeriodSchema.nullable().default(null),
    targetRangeMin: z.number().nullable().default(null),
    targetRangeMax: z.number().nullable().default(null),
    desiredNonPriceImprovements: z.array(z.string()).default([]),
    allowedTradeoffs: z.array(z.string()).default([]),
    hardStops: z.array(z.string()).default([]),
    verifiedCompetingQuoteId: z.string().nullable().default(null),
    disclosurePolicy: DisclosurePolicySchema.default("do_not_reveal_ceiling"),
    confirmedAt: IsoDateTimeSchema,
  })
  .refine(
    (g) =>
      g.targetAmount !== null ||
      (g.targetRangeMin !== null && g.targetRangeMax !== null),
    { message: "Provide either a target amount or a target range (min & max)." }
  );
export type NegotiationGoal = z.infer<typeof NegotiationGoalSchema>;

/**
 * The provider-safe projection of a goal — what the Negotiator agent is
 * actually handed. Built by applyDisclosurePolicy() in src/domain/privacy.
 * Never contains an undisclosed ceiling.
 */
export const NegotiationGoalDisclosureSchema = z.object({
  goalId: z.string(),
  selectedQuoteId: z.string(),
  targetProviderId: z.string(),
  /** Present only if disclosurePolicy permits. */
  disclosedTargetAmount: z.number().nullable(),
  disclosedRangeMin: z.number().nullable(),
  disclosedRangeMax: z.number().nullable(),
  desiredNonPriceImprovements: z.array(z.string()),
  allowedTradeoffs: z.array(z.string()),
  hasVerifiedCompetingQuote: z.boolean(),
});
export type NegotiationGoalDisclosure = z.infer<
  typeof NegotiationGoalDisclosureSchema
>;

export const NegotiationOutcomeSchema = z.enum([
  "price_reduced",
  "fee_waived",
  "discount_applied",
  "payment_term_improved",
  "deductible_improved",
  "coverage_improved",
  "benefit_added",
  "quote_validity_extended",
  "bundle_option_added",
  "no_change_rates_fixed",
  "no_change_provider_declined",
  "human_handoff_required",
  "negotiation_failed",
]);
export type NegotiationOutcome = z.infer<typeof NegotiationOutcomeSchema>;

/** NegotiationEvent — the before/after record of one negotiation. (Spec §9.10) */
export const NegotiationEventSchema = z.object({
  eventId: z.string(),
  workflowId: z.string(),
  negotiationGoalId: z.string(),
  targetProviderId: z.string(),
  negotiationConversationId: z.string().nullable().default(null),
  originalQuoteId: z.string(),
  competingQuoteId: z.string().nullable().default(null),
  specificationHash: z.string(),
  verifiedLeverageStatement: z.string().nullable().default(null),
  requestedImprovement: z.string(),
  providerResponse: z.string().nullable().default(null),
  outcome: NegotiationOutcomeSchema,
  originalPrice: z.number().nullable().default(null),
  finalPrice: z.number().nullable().default(null),
  originalTerms: z.record(z.string(), z.unknown()).default({}),
  finalTerms: z.record(z.string(), z.unknown()).default({}),
  savingsAmount: z.number().nullable().default(null),
  changedCoverage: z.array(z.string()).default([]),
  changedFees: z.array(z.string()).default([]),
  changedDiscounts: z.array(z.string()).default([]),
  changedPaymentTerms: z.array(z.string()).default([]),
  changedNonPriceTerms: z.array(z.string()).default([]),
  targetMet: z.boolean().nullable().default(null),
  evidenceIds: z.array(z.string()).default([]),
  verificationStatus: z.enum(["verified", "unverified"]).default("unverified"),
  createdAt: IsoDateTimeSchema,
});
export type NegotiationEvent = z.infer<typeof NegotiationEventSchema>;
