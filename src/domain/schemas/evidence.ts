import { z } from "zod";
import { IsoDateTimeSchema } from "./common.js";
import { VerificationStatusSchema } from "./provenance.js";

export const EvidenceTypeSchema = z.enum([
  "document",
  "transcript",
  "audio",
  "provider_document",
  "web_source",
  "user_confirmation",
  "demo_fixture",
]);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

/**
 * Evidence — a traceable claim. Every material quote field either points to one
 * of these or is labeled unverified. Powers EvidenceLink in the UI. (Spec §9.8)
 */
export const EvidenceSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  evidenceType: EvidenceTypeSchema,
  sourceId: z.string().nullable().default(null),
  claimKey: z.string(),
  claimValue: z.unknown(),
  pageNumber: z.number().int().nullable().default(null),
  transcriptStartMs: z.number().int().nullable().default(null),
  transcriptEndMs: z.number().int().nullable().default(null),
  speaker: z.string().nullable().default(null),
  excerpt: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  retrievedAt: IsoDateTimeSchema.nullable().default(null),
  confidence: z.number().min(0).max(1),
  verificationStatus: VerificationStatusSchema,
});
export type Evidence = z.infer<typeof EvidenceSchema>;
