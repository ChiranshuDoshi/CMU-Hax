import { z } from "zod";
import { InsuranceLineSchema } from "./insurance-line.js";
import { IsoDateTimeSchema } from "./common.js";
import { InsuredEntitySchema, CoverageSectionSchema } from "./insurance-profile.js";

/** How closely a provider quote must match the requested coverage. (Spec §9.5) */
export const CoverageMatchingModeSchema = z.enum([
  "exact_match",
  "same_or_better",
  "minimum_confirmed_requirements",
  "user_approved_tradeoffs",
]);
export type CoverageMatchingMode = z.infer<typeof CoverageMatchingModeSchema>;

/**
 * ConfirmedQuoteRequest — the immutable, provider-safe spec reused for every
 * first-round provider conversation. (Spec §9.5)
 *
 * The `specificationHash` is a SHA-256 over the canonical JSON of the
 * provider-safe fields (see src/domain/hashing). All five first-round calls
 * MUST share the same requestId + version + specificationHash. Private
 * constraints never appear here.
 */
export const ConfirmedQuoteRequestSchema = z.object({
  requestId: z.string(),
  workflowId: z.string(),
  version: z.number().int().min(1),
  insuranceLines: z.array(InsuranceLineSchema),
  state: z.string().nullable().default(null),
  zipCode: z.string().nullable().default(null),
  desiredEffectiveDate: z.string().nullable().default(null),
  providerSafeEntities: z.array(InsuredEntitySchema).default([]),
  existingCoverageBaseline: z.array(CoverageSectionSchema).default([]),
  requestedCoverage: z.array(CoverageSectionSchema).default([]),
  matchingMode: CoverageMatchingModeSchema.default("exact_match"),
  allowedProviderContext: z.record(z.string(), z.unknown()).default({}),
  requiredQuoteQuestions: z.array(z.string()).default([]),
  requiredQuoteFields: z.array(z.string()).default([]),
  userConfirmedFacts: z.record(z.string(), z.unknown()).default({}),
  excludedSensitiveFacts: z.array(z.string()).default([]),
  confirmedAt: IsoDateTimeSchema,
  specificationHash: z.string(),
});
export type ConfirmedQuoteRequest = z.infer<typeof ConfirmedQuoteRequestSchema>;

/**
 * The subset that actually feeds the specification hash — i.e. everything
 * except the hash itself and the confirmation timestamp. Keep this in sync with
 * src/domain/hashing/spec-hash.ts.
 */
export const HASHABLE_REQUEST_KEYS = [
  "requestId",
  "workflowId",
  "version",
  "insuranceLines",
  "state",
  "zipCode",
  "desiredEffectiveDate",
  "providerSafeEntities",
  "existingCoverageBaseline",
  "requestedCoverage",
  "matchingMode",
  "allowedProviderContext",
  "requiredQuoteQuestions",
  "requiredQuoteFields",
  "userConfirmedFacts",
  "excludedSensitiveFacts",
] as const;
