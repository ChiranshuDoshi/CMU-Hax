import { z } from "zod";
import { InsuranceLineSchema } from "./insurance-line.js";
import { IsoDateTimeSchema, BillingPeriodSchema } from "./common.js";

export const QuoteStatusSchema = z.enum([
  "quote_received",
  "incomplete_quote",
  "provider_declined",
  "human_handoff_required",
  "unsupported_insurance_line",
  "geographic_mismatch",
  "conversation_failed",
]);
export type QuoteStatus = z.infer<typeof QuoteStatusSchema>;

export const QuoteTypeSchema = z.enum([
  "indicative",
  "verbal",
  "written",
  "binding",
  "incomplete",
  "simulated",
]);
export type QuoteType = z.infer<typeof QuoteTypeSchema>;

export const EquivalenceStatusSchema = z.enum([
  "equivalent",
  "better_than_requested",
  "worse_than_requested",
  "partially_comparable",
  "not_comparable",
  "missing_information",
]);
export type EquivalenceStatus = z.infer<typeof EquivalenceStatusSchema>;

/** A premium / fee / tax line item. (Spec §9.7) */
export const CostComponentSchema = z.object({
  category: z.string(),
  label: z.string(),
  amount: z.number(),
  frequency: BillingPeriodSchema,
  termCount: z.number().nullable().default(null),
  required: z.boolean().default(true),
  conditional: z.boolean().default(false),
  refundable: z.boolean().nullable().default(null),
  includedInQuotedTotal: z.boolean().default(true),
  evidenceId: z.string().nullable().default(null),
});
export type CostComponent = z.infer<typeof CostComponentSchema>;

export const QuoteDiscountSchema = z.object({
  name: z.string(),
  amount: z.number().nullable().default(null),
  amountType: z.enum(["fixed", "percent"]).default("fixed"),
  applied: z.boolean().default(false),
  conditional: z.boolean().default(false),
  eligibilityConfirmed: z.boolean().default(false),
  continuingEligibilityRequired: z.boolean().default(false),
  conditions: z.array(z.string()).default([]),
  evidenceId: z.string().nullable().default(null),
});
export type QuoteDiscount = z.infer<typeof QuoteDiscountSchema>;

export const QuoteCoverageItemSchema = z.object({
  coverageCode: z.string(),
  coverageName: z.string(),
  insuredEntityIds: z.array(z.string()).default([]),
  limit: z.union([z.number(), z.string()]).nullable().default(null),
  sublimit: z.union([z.number(), z.string()]).nullable().default(null),
  deductible: z.number().nullable().default(null),
  copay: z.number().nullable().default(null),
  coinsurance: z.number().nullable().default(null),
  outOfPocketMaximum: z.number().nullable().default(null),
  waitingPeriod: z.string().nullable().default(null),
  term: z.string().nullable().default(null),
  network: z.string().nullable().default(null),
  included: z.boolean().default(true),
  requestedMatch: z.boolean().nullable().default(null),
  equivalenceStatus: EquivalenceStatusSchema.default("missing_information"),
  differences: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
});
export type QuoteCoverageItem = z.infer<typeof QuoteCoverageItemSchema>;

/**
 * NormalizedQuote — every provider outcome converted into one comparable
 * schema. Deterministic code fills `effectiveComparisonCost` etc. (Spec §9.7)
 * Every demo quote must have quoteType "simulated".
 */
export const NormalizedQuoteSchema = z.object({
  quoteId: z.string(),
  workflowId: z.string(),
  providerId: z.string(),
  sourceConversationId: z.string().nullable().default(null),
  confirmedRequestId: z.string(),
  specificationHash: z.string(),
  insuranceLines: z.array(InsuranceLineSchema),
  quoteStatus: QuoteStatusSchema,
  quoteType: QuoteTypeSchema,
  quoteReference: z.string().nullable().default(null),
  effectiveDate: z.string().nullable().default(null),
  expirationDate: z.string().nullable().default(null),
  policyTerm: z.string().nullable().default(null),
  currency: z.string().default("USD"),
  premiumComponents: z.array(CostComponentSchema).default([]),
  feeComponents: z.array(CostComponentSchema).default([]),
  taxComponents: z.array(CostComponentSchema).default([]),
  discounts: z.array(QuoteDiscountSchema).default([]),
  paymentOptions: z.array(z.string()).default([]),
  coverageItems: z.array(QuoteCoverageItemSchema).default([]),
  exclusions: z.array(z.string()).default([]),
  conditions: z.array(z.string()).default([]),
  underwritingAssumptions: z.array(z.string()).default([]),
  requiredFollowUp: z.array(z.string()).default([]),
  effectiveComparisonCost: z.number().nullable().default(null),
  annualizedCost: z.number().nullable().default(null),
  coverageEquivalence: EquivalenceStatusSchema.default("missing_information"),
  completenessScore: z.number().min(0).max(1).default(0),
  confidenceScore: z.number().min(0).max(1).default(0),
  requiresHumanVerification: z.boolean().default(false),
  redFlags: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  rawExtraction: z.record(z.string(), z.unknown()).default({}),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type NormalizedQuote = z.infer<typeof NormalizedQuoteSchema>;
