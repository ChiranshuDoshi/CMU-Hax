import { z } from "zod";

import { jsonError, jsonSuccess, readJsonBody } from "@/app/api/_lib/http";
import { requireInternalAuthorization } from "@/app/api/_lib/security";
import { normalizeQuote } from "@/domain/normalization";
import { addComparableMedianOutlierFlags } from "@/domain/red-flags";
import { ConfirmedQuoteRequestSchema, RawQuoteOutcomeSchema } from "@/domain/schemas/person4";

export const runtime = "nodejs";

const BodySchema = z.strictObject({
  quoteRequest: ConfirmedQuoteRequestSchema,
  rawQuotes: z.array(RawQuoteOutcomeSchema).min(1).max(25),
});

export async function POST(request: Request): Promise<Response> {
  try {
    requireInternalAuthorization(request);
    const body = BodySchema.parse(await readJsonBody(request));
    const normalized = body.rawQuotes.map((quote) => normalizeQuote(quote, body.quoteRequest));
    return jsonSuccess({ quotes: addComparableMedianOutlierFlags(normalized) });
  } catch (error) {
    return jsonError(error);
  }
}
