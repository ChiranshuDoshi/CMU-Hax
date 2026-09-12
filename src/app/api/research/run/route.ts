import { z } from "zod";

import { jsonError, jsonSuccess, readJsonBody } from "@/app/api/_lib/http";
import { requireInternalAuthorization } from "@/app/api/_lib/security";
import { MockResearchProvider, rankResearchResult } from "@/domain/research";
import { ConfirmedQuoteRequestSchema } from "@/domain/schemas/person4";
import { QueritResearchProvider } from "@/integrations/querit";
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

    let provider: MockResearchProvider | QueritResearchProvider | TavilyResearchProvider =
      new MockResearchProvider();
    if (body.mode === "live") {
      if (process.env.QUERIT_API_KEY?.trim()) {
        provider = new QueritResearchProvider({
          apiKey: process.env.QUERIT_API_KEY,
          baseUrl: process.env.QUERIT_BASE_URL,
        });
      } else {
        provider = new TavilyResearchProvider({ apiKey: process.env.TAVILY_API_KEY });
      }
    }

    const researchResult = await provider.research({ quoteRequest: body.quoteRequest, retrievedAt: evaluatedAt });

    return jsonSuccess({
      mode: body.mode,
      ranking: rankResearchResult(body.quoteRequest, researchResult, evaluatedAt),
    });
  } catch (error) {
    return jsonError(error);
  }
}
