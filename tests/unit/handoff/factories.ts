import { buildRecommendation } from "@/domain/recommendation";
import { rankProviders } from "@/domain/research";
import type {
  Evidence,
  NormalizedQuote,
  ProviderRankingResult,
  Recommendation,
} from "@/domain/schemas/person4";

import { createEvidence, createQuote, SPECIFICATION_HASH } from "../recommendation/factories";
import { makeCandidate, makeQuoteRequest } from "../research/factories";

export const GENERATED_AT = new Date("2026-07-18T12:00:00.000Z");
export const QUOTE_VALID_UNTIL = "2026-08-17T12:00:00.000Z";
export const CONVERSATION_SOURCE_ID = "conversation-1";
export const SIMULATED_CALL_DISCLAIMER =
  "This simulated voice quote is not binding and requires human verification.";

export interface HandoffFixture {
  recommendation: Recommendation;
  providerRanking: ProviderRankingResult;
  quotes: NormalizedQuote[];
  evidence: Evidence[];
  generatedAt: Date;
}

export function createConversationQuote(overrides: Partial<NormalizedQuote> = {}): NormalizedQuote {
  return createQuote({
    sourceType: "conversation",
    sourceConversationId: CONVERSATION_SOURCE_ID,
    sourceArtifactId: null,
    scenarioId: null,
    quoteValidUntil: QUOTE_VALID_UNTIL,
    currency: "USD",
    disclaimer: SIMULATED_CALL_DISCLAIMER,
    expirationDate: "2027-07-31",
    requiresHumanVerification: true,
    ...overrides,
  });
}

export function createConversationEvidence(id: string): Evidence {
  return createEvidence({
    id,
    type: "transcript",
    sourceId: CONVERSATION_SOURCE_ID,
    verificationStatus: "user_confirmed",
  });
}

export function createProviderRanking(): ProviderRankingResult {
  return rankProviders({
    quoteRequest: makeQuoteRequest({
      id: "request-1",
      workflowId: "workflow-1",
      specificationHash: SPECIFICATION_HASH,
    }),
    candidates: [1, 2, 3, 4, 5].map((index) => makeCandidate(`provider-${index}`)),
    evaluatedAt: GENERATED_AT.toISOString(),
  });
}

export function createHandoffFixture(): HandoffFixture {
  const quotes = [
    createConversationQuote({
      quoteId: "quote-1",
      providerId: "provider-1",
      effectiveComparisonCostCents: 1_000,
      annualizedCostCents: 1_000,
      coverageEquivalence: { status: "better_than_requested", differences: ["Higher liability limit"] },
      evidenceIds: ["evidence-target"],
    }),
    createConversationQuote({
      quoteId: "quote-2",
      providerId: "provider-2",
      effectiveComparisonCostCents: 1_100,
      annualizedCostCents: 1_100,
      evidenceIds: ["evidence-2"],
    }),
    createConversationQuote({
      quoteId: "quote-3",
      providerId: "provider-3",
      effectiveComparisonCostCents: 1_200,
      annualizedCostCents: 1_200,
      evidenceIds: ["evidence-3"],
    }),
    createConversationQuote({
      quoteId: "quote-4",
      providerId: "provider-4",
      effectiveComparisonCostCents: 1_300,
      annualizedCostCents: 1_300,
      evidenceIds: ["evidence-4"],
    }),
    createConversationQuote({
      quoteId: "quote-5",
      providerId: "provider-5",
      effectiveComparisonCostCents: 1_400,
      annualizedCostCents: 1_400,
      evidenceIds: ["evidence-5"],
    }),
  ];
  const evidence = [
    createConversationEvidence("evidence-target"),
    createConversationEvidence("evidence-2"),
    createConversationEvidence("evidence-3"),
    createConversationEvidence("evidence-4"),
    createConversationEvidence("evidence-5"),
  ];
  const recommendation = buildRecommendation({
    workflowId: "workflow-1",
    specificationHash: SPECIFICATION_HASH,
    quotes,
    generatedAt: GENERATED_AT,
  });

  return {
    recommendation,
    providerRanking: createProviderRanking(),
    quotes,
    evidence,
    generatedAt: GENERATED_AT,
  };
}
