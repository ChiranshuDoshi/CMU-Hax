import { z } from "zod";

import { jsonError, jsonSuccess, readJsonBody } from "@/app/api/_lib/http";
import { requireInternalAuthorization } from "@/app/api/_lib/security";
import { MockResearchProvider, rankResearchResult } from "@/domain/research";
import { ConfirmedQuoteRequestSchema } from "@/domain/schemas/person4";
import { TavilyResearchProvider } from "@/integrations/tavily";

export const runtime = "nodejs";

const BodySchema = z.strictObject({
  quoteRequest: ConfirmedQuoteRequestSchema,
  mode: z.enum(["mock", "live"]).default("mock"),
  evaluatedAt: z.string().datetime().optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const body = BodySchema.parse(await readJsonBody(request));
    const evaluatedAt = body.evaluatedAt ?? new Date().toISOString();
    if (body.mode === "live") requireInternalAuthorization(request);
    const provider =
      body.mode === "live"
        ? new TavilyResearchProvider({ apiKey: process.env.TAVILY_API_KEY })
        : new MockResearchProvider();
    const researchResult = await provider.research({ quoteRequest: body.quoteRequest, retrievedAt: evaluatedAt });

    return jsonSuccess({
      mode: body.mode,
      ranking: rankResearchResult(body.quoteRequest, researchResult, evaluatedAt),
    });
  } catch (error) {
    return jsonError(error);
  }
}
