import { z } from "zod";

/**
 * Every insurance line the architecture is allowed to reference.
 * The hackathon demo implements `auto` deeply; the rest exist so a new
 * line is "add a config file", not "rewrite the app". (Spec §5.)
 */
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

export type InsuranceLine = z.infer<typeof InsuranceLineSchema>;
