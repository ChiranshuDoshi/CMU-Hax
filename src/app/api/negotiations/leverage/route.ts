import { z } from "zod";

import { jsonError, jsonSuccess, readJsonBody } from "@/app/api/_lib/http";
import { requireInternalAuthorization } from "@/app/api/_lib/security";
import { selectVerifiedLeverage } from "@/domain/negotiation";
import { EvidenceSchema, NormalizedQuoteSchema } from "@/domain/schemas/person4";

export const runtime = "nodejs";

const BodySchema = z.strictObject({
  selectedQuote: NormalizedQuoteSchema,
  candidateQuotes: z.array(NormalizedQuoteSchema),
  evidence: z.array(EvidenceSchema),
  evaluatedAt: z.string().datetime(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    requireInternalAuthorization(request);
    const body = BodySchema.parse(await readJsonBody(request));
    return jsonSuccess({
      leverage: selectVerifiedLeverage({
        selectedQuote: body.selectedQuote,
        candidateQuotes: body.candidateQuotes,
        evidence: body.evidence,
        now: new Date(body.evaluatedAt),
      }),
    });
  } catch (error) {
    return jsonError(error);
  }
}
