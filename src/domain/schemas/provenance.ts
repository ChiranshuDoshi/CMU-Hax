import { z } from "zod";

/** Where a value came from. (Spec §9.2) */
export const SourceTypeSchema = z.enum([
  "document",
  "voice",
  "user_edit",
  "provider_conversation",
  "provider_document",
  "web_research",
  "demo_fixture",
]);
export type SourceType = z.infer<typeof SourceTypeSchema>;

/** How trusted a value is. */
export const VerificationStatusSchema = z.enum([
  "unverified",
  "user_confirmed",
  "provider_confirmed",
  "conflicting",
  "not_applicable",
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

/**
 * Every material value carries provenance so the UI can show evidence and
 * confidence. Unknown values are `null` — we never invent them. (Spec §9.2)
 */
export const ProvenanceValueSchema = z.object({
  value: z.unknown(),
  sourceType: SourceTypeSchema,
  sourceId: z.string().nullable(),
  pageNumber: z.number().int().nullable(),
  transcriptSegmentId: z.string().nullable(),
  sourceExcerpt: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  verificationStatus: VerificationStatusSchema,
});
export type ProvenanceValue = z.infer<typeof ProvenanceValueSchema>;

/** Helper: wrap a plain value as an unverified demo-fixture provenance value. */
export function demoProvenance(value: unknown, confidence = 1): ProvenanceValue {
  return {
    value,
    sourceType: "demo_fixture",
    sourceId: null,
    pageNumber: null,
    transcriptSegmentId: null,
    sourceExcerpt: null,
    confidence,
    verificationStatus: "user_confirmed",
  };
}
