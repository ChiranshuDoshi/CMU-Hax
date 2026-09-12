import { z } from "zod";

import { jsonError, jsonSuccess, readJsonBody } from "@/app/api/_lib/http";
import { requireInternalAuthorization } from "@/app/api/_lib/security";
import { buildNegotiationHandoff } from "@/domain/handoff";
import { buildRecommendation } from "@/domain/recommendation";
import {
  EvidenceSchema,
  NormalizedQuoteSchema,
  ProviderRankingResultSchema,
} from "@/domain/schemas/person4";

export const runtime = "nodejs";

const EffectiveOfferSchema = z.strictObject({
  quoteId: z.string().min(1),
  originalQuoteId: z.string().min(1),
  negotiationEventId: z.string().min(1),
  originalCostCents: z.number().int().nonnegative(),
  finalCostCents: z.number().int().nonnegative(),
  savingsCents: z.number().int().nonnegative(),
  effectiveQuote: NormalizedQuoteSchema,
  evidenceIds: z.array(z.string().min(1)),
});

const BodySchema = z.strictObject({
  workflowId: z.string().min(1),
  specificationHash: z.string().regex(/^[a-f0-9]{64}$/),
  insuranceLine: z.string().default("auto"),
  quotes: z.array(NormalizedQuoteSchema).min(1).max(25),
  effectiveOffers: z.array(EffectiveOfferSchema).default([]),
  providerRanking: ProviderRankingResultSchema,
  evidence: z.array(EvidenceSchema),
  generatedAt: z.string().datetime(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    requireInternalAuthorization(request);
    const body = BodySchema.parse(await readJsonBody(request));
    const recommendationGeneratedAt = new Date(body.generatedAt);
    const recommendation = buildRecommendation({
      workflowId: body.workflowId,
      specificationHash: body.specificationHash,
      insuranceLine: body.insuranceLine,
      quotes: body.quotes,
      effectiveOffers: body.effectiveOffers,
      generatedAt: recommendationGeneratedAt,
    });
    const negotiationHandoff = buildNegotiationHandoff({
      recommendation,
      providerRanking: body.providerRanking,
      quotes: body.quotes,
      evidence: body.evidence,
      // Freshness is a trust decision, so it must use the server clock rather than request provenance.
      generatedAt: new Date(),
    });

    return jsonSuccess({
      recommendation,
      recommendedDeal: negotiationHandoff.target,
      negotiationHandoff,
    });
  } catch (error) {
    return jsonError(error);
  }
}
