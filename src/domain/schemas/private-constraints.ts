import { z } from "zod";

/**
 * PrivateNegotiationConstraints — the user's private ceiling & rules. (Spec §9.4)
 *
 * IMPORTANT (product feature, not just security): this object must NEVER reach a
 * provider agent, the Calling Agent, research queries, transcripts, or the
 * browser. It is stored separately from provider-safe data. For the hackathon we
 * store it as plain JSON in its own record (no encryption), but the *boundary*
 * stays — see src/domain/privacy.
 */
export const PrivateNegotiationConstraintsSchema = z.object({
  maxMonthlyPremium: z.number().nullable().default(null),
  maxAnnualPremium: z.number().nullable().default(null),
  maxPolicyTermCost: z.number().nullable().default(null),
  maxDownPayment: z.number().nullable().default(null),
  maxDeductibleByCoverage: z.record(z.string(), z.number()).default({}),
  minCoverageRequirements: z.record(z.string(), z.unknown()).default({}),
  excludedProviders: z.array(z.string()).default([]),
  requiredProviderCharacteristics: z.array(z.string()).default([]),
  bundlingAllowed: z.boolean().nullable().default(null),
  telematicsAllowed: z.boolean().nullable().default(null),
  usageMonitoringAllowed: z.boolean().nullable().default(null),
  wellnessMonitoringAllowed: z.boolean().nullable().default(null),
  payInFullAllowed: z.boolean().nullable().default(null),
  autopayAllowed: z.boolean().nullable().default(null),
  tradeoffsRequiringApproval: z.array(z.string()).default([]),
  negotiationPriorities: z.array(z.string()).default([]),
  hardStops: z.array(z.string()).default([]),
});
export type PrivateNegotiationConstraints = z.infer<
  typeof PrivateNegotiationConstraintsSchema
>;
