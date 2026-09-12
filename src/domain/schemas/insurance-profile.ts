import { z } from "zod";
import { InsuranceLineSchema } from "./insurance-line.js";
import { IsoDateTimeSchema } from "./common.js";

/** Kinds of things a policy can insure. (Spec §9.3) */
export const EntityTypeSchema = z.enum([
  "person",
  "household",
  "driver",
  "vehicle",
  "property",
  "rental_unit",
  "pet",
  "business",
  "employee_group",
  "life_insured",
  "health_plan_member",
  "scheduled_item",
  "other",
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

/**
 * An insured entity. Generic attributes hold anything; line-specific
 * attributes hold auto/home/etc fields. Keeps the model config-driven.
 */
export const InsuredEntitySchema = z.object({
  id: z.string(),
  entityType: EntityTypeSchema,
  displayLabel: z.string(),
  attributes: z.record(z.string(), z.unknown()).default({}),
  lineSpecificAttributes: z.record(z.string(), z.unknown()).default({}),
  sensitive: z.boolean().default(false),
  evidenceIds: z.array(z.string()).default([]),
});
export type InsuredEntity = z.infer<typeof InsuredEntitySchema>;

/** A coverage line item on a policy or request. Not every field applies. */
export const CoverageSectionSchema = z.object({
  coverageCode: z.string(),
  coverageName: z.string(),
  insuranceLine: InsuranceLineSchema,
  insuredEntityIds: z.array(z.string()).default([]),
  limit: z.union([z.number(), z.string()]).nullable().default(null),
  sublimit: z.union([z.number(), z.string()]).nullable().default(null),
  deductible: z.number().nullable().default(null),
  copay: z.number().nullable().default(null),
  coinsurance: z.number().nullable().default(null),
  outOfPocketMaximum: z.number().nullable().default(null),
  waitingPeriod: z.string().nullable().default(null),
  benefitAmount: z.number().nullable().default(null),
  term: z.string().nullable().default(null),
  networkType: z.string().nullable().default(null),
  replacementCost: z.boolean().nullable().default(null),
  actualCashValue: z.boolean().nullable().default(null),
  included: z.boolean().default(true),
  requirement: z.enum(["required", "preferred", "optional"]).default("required"),
  conditions: z.array(z.string()).default([]),
  exclusions: z.array(z.string()).default([]),
  endorsements: z.array(z.string()).default([]),
  attributes: z.record(z.string(), z.unknown()).default({}),
  evidenceIds: z.array(z.string()).default([]),
});
export type CoverageSection = z.infer<typeof CoverageSectionSchema>;

/** A user's current/existing policy (the baseline we shop against). */
export const CurrentPolicySchema = z.object({
  carrierName: z.string().nullable().default(null),
  agencyName: z.string().nullable().default(null),
  maskedPolicyNumber: z.string().nullable().default(null),
  insuranceLine: InsuranceLineSchema,
  effectiveDate: z.string().nullable().default(null),
  expirationDate: z.string().nullable().default(null),
  policyTerm: z.string().nullable().default(null),
  currentPremium: z.number().nullable().default(null),
  paymentFrequency: z.string().nullable().default(null),
  fees: z.array(z.record(z.string(), z.unknown())).default([]),
  discounts: z.array(z.record(z.string(), z.unknown())).default([]),
  insuredEntityIds: z.array(z.string()).default([]),
  coverageSections: z.array(CoverageSectionSchema).default([]),
  endorsements: z.array(z.string()).default([]),
  exclusions: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
});
export type CurrentPolicy = z.infer<typeof CurrentPolicySchema>;

export const UserContextSchema = z.object({
  displayName: z.string().nullable().default(null),
  state: z.string().nullable().default(null),
  zipCode: z.string().nullable().default(null),
  preferredLanguage: z.string().default("en"),
  preferredContactMethod: z.string().nullable().default(null),
  desiredEffectiveDate: z.string().nullable().default(null),
  isDemoData: z.boolean().default(false),
});
export type UserContext = z.infer<typeof UserContextSchema>;

export const ProfileStatusSchema = z.enum([
  "draft",
  "in_progress",
  "ready",
  "confirmed",
]);

/**
 * InsuranceProfile — the user's reusable, quote-ready source profile. (Spec §9.3)
 * `quoteReady` gates market research; `missingFields` is computed server-side.
 */
export const InsuranceProfileSchema = z.object({
  id: z.string(),
  userId: z.string(),
  version: z.number().int().min(1),
  status: ProfileStatusSchema,
  completenessScore: z.number().min(0).max(1),
  quoteReady: z.boolean(),
  userContext: UserContextSchema,
  currentPolicies: z.array(CurrentPolicySchema).default([]),
  insuredEntities: z.array(InsuredEntitySchema).default([]),
  underwritingFacts: z.record(z.string(), z.unknown()).default({}),
  requestedInsuranceLines: z.array(InsuranceLineSchema),
  coverageSections: z.array(CoverageSectionSchema).default([]),
  currentCosts: z.record(z.string(), z.unknown()).default({}),
  preferences: z.record(z.string(), z.unknown()).default({}),
  missingFields: z.array(z.string()).default([]),
  conflictingFields: z.array(z.string()).default([]),
  evidenceReferences: z.array(z.string()).default([]),
  confirmedAt: IsoDateTimeSchema.nullable().default(null),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type InsuranceProfile = z.infer<typeof InsuranceProfileSchema>;

/**
 * CoverageProfile — an immutable per-workflow snapshot of the confirmed
 * insurance-domain fields. Changes stay local to the workflow. (Spec §9.3)
 */
export const CoverageProfileSchema = InsuranceProfileSchema.omit({
  id: true,
  userId: true,
}).extend({
  id: z.string(),
  workflowId: z.string(),
  sourceInsuranceProfileId: z.string(),
  sourceInsuranceProfileVersion: z.number().int().min(1),
  snapshotAt: IsoDateTimeSchema,
});
export type CoverageProfile = z.infer<typeof CoverageProfileSchema>;
