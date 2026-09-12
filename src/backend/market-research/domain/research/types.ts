import { z } from "zod";

import {
  ConfirmedQuoteRequestSchema,
  RawResearchResultSchema,
  type ConfirmedQuoteRequest,
  type RawResearchResult,
} from "@/domain/schemas/person4";

export const ResearchInputSchema = z.strictObject({
  quoteRequest: ConfirmedQuoteRequestSchema,
  retrievedAt: z.string().datetime(),
});

export interface ResearchInput {
  quoteRequest: ConfirmedQuoteRequest;
  retrievedAt: string;
}

export interface ResearchProvider {
  research(input: ResearchInput): Promise<RawResearchResult>;
}

export function validateResearchInput(input: ResearchInput): ResearchInput {
  return ResearchInputSchema.parse(input);
}

export function validateRawResearchResult(result: RawResearchResult): RawResearchResult {
  return RawResearchResultSchema.parse(result);
}
