/**
 * Turns the browser's car/coverage form into a provider-safe
 * `ConfirmedQuoteRequest` (Person 4 contract). No HTTP route ingested a raw
 * profile before this — the request had to be constructed upstream — so this is
 * that construction step, including the deterministic specification hash that
 * every downstream stage (research, quotes, recommendation) must share.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import {
  ConfirmedQuoteRequestSchema,
  type ConfirmedQuoteRequest,
} from "@/domain/schemas/person4";

export const CarProfileSchema = z.object({
  year: z.coerce.number().int().min(1980).max(2031),
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  bodyType: z.string().trim().max(40).optional(),
  driverName: z.string().trim().max(80).optional(),
  state: z.string().trim().length(2),
  zipCode: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/),
  annualMileage: z.coerce.number().int().min(0).max(300_000).optional(),
  // Private/first-round-hidden fields — never leave the server as-is.
  currentPremiumCents: z.coerce.number().int().min(0).max(100_000_000).nullable().optional(),
});

export type CarProfile = z.infer<typeof CarProfileSchema>;

const DRIVER_ENTITY_ID = "driver-1";
const VEHICLE_ENTITY_ID = "vehicle-1";

/** Stable, key-sorted serialization so the hash is order-independent. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function isoDatePlusDays(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildConfirmedRequest(
  workflowId: string,
  profile: CarProfile,
  now = new Date(),
): ConfirmedQuoteRequest {
  const requestId = `${workflowId}-req-1`.slice(0, 128);
  const desiredEffectiveDate = isoDatePlusDays(14);

  const requestedCoverage = [
    {
      coverageCode: "BI",
      insuredEntityIds: [DRIVER_ENTITY_ID],
      required: true,
      minimumLimitCents: 10_000_000, // 100/300 bodily-injury limit
      maximumDeductibleCents: null,
    },
    {
      coverageCode: "COLL",
      insuredEntityIds: [VEHICLE_ENTITY_ID],
      required: true,
      minimumLimitCents: null,
      maximumDeductibleCents: 50_000, // $500 deductible
    },
    {
      coverageCode: "COMP",
      insuredEntityIds: [VEHICLE_ENTITY_ID],
      required: true,
      minimumLimitCents: null,
      maximumDeductibleCents: 50_000,
    },
  ];

  const hashable = {
    insuranceLines: ["auto"],
    state: profile.state.toUpperCase(),
    zipCode: profile.zipCode,
    desiredEffectiveDate,
    insuredEntityIds: [DRIVER_ENTITY_ID, VEHICLE_ENTITY_ID],
    requestedCoverage,
    matchingMode: "exact_match",
  };
  const specificationHash = createHash("sha256").update(stableStringify(hashable)).digest("hex");

  return ConfirmedQuoteRequestSchema.parse({
    id: requestId,
    workflowId,
    version: 1,
    insuranceLines: ["auto"],
    state: profile.state,
    zipCode: profile.zipCode,
    desiredEffectiveDate,
    insuredEntityIds: [DRIVER_ENTITY_ID, VEHICLE_ENTITY_ID],
    requestedCoverage,
    excludedProviderIds: [],
    matchingMode: "exact_match",
    specificationHash,
    confirmedAt: now.toISOString(),
  });
}
