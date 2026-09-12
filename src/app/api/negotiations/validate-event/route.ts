import { z } from "zod";

import { jsonError, jsonSuccess, readJsonBody } from "@/app/api/_lib/http";
import { requireInternalAuthorization } from "@/app/api/_lib/security";
import { deriveEffectiveOffer, validateNegotiationEvent } from "@/domain/negotiation";
import {
  ConfirmedQuoteRequestSchema,
  EvidenceSchema,
  NegotiationEventSchema,
  NegotiationGoalSchema,
  NormalizedQuoteSchema,
} from "@/domain/schemas/person4";

export const runtime = "nodejs";

const BodySchema = z.strictObject({
  event: NegotiationEventSchema,
  goal: NegotiationGoalSchema,
  confirmedRequest: ConfirmedQuoteRequestSchema,
  originalQuote: NormalizedQuoteSchema,
  competingQuote: NormalizedQuoteSchema.optional(),
  evidence: z.array(EvidenceSchema),
});

export async function POST(request: Request): Promise<Response> {
  try {
    requireInternalAuthorization(request);
    const body = BodySchema.parse(await readJsonBody(request));
    const validated = validateNegotiationEvent(body);
    return jsonSuccess({
      valid: true,
      negotiationEventId: validated.event.id,
      effectiveOffer: deriveEffectiveOffer(validated),
    });
  } catch (error) {
    return jsonError(error);
  }
}
