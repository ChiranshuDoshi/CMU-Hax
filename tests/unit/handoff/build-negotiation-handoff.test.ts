import { describe, expect, it, vi } from "vitest";

import { POST as recommend } from "@/app/api/recommendations/route";
import { buildNegotiationHandoff } from "@/domain/handoff";
import type { NormalizedQuote } from "@/domain/schemas/person4";

import { OTHER_SPECIFICATION_HASH } from "../recommendation/factories";
import {
  createHandoffFixture,
  QUOTE_VALID_UNTIL,
  CONVERSATION_SOURCE_ID,
  SIMULATED_CALL_DISCLAIMER,
} from "./factories";

const MISSING_METADATA_CASES: Array<[string, Partial<NormalizedQuote>]> = [
  ["source type", { sourceType: undefined }],
  ["source conversation", { sourceConversationId: null }],
  ["currency", { currency: undefined }],
  ["effective cost", { effectiveComparisonCostCents: null }],
  ["policy term", { policyTermMonths: null }],
  ["evidence", { evidenceIds: [] }],
];

describe("automatic negotiation handoff", () => {
  it("targets the system recommendation with provider, price, coverage, term, and evidence", () => {
    const result = buildNegotiationHandoff(createHandoffFixture());

    expect(result).toMatchObject({
      workflowId: "workflow-1",
      target: {
        providerId: "provider-1",
        providerName: "Provider provider-1",
        quoteId: "quote-1",
        scenarioId: null,
        sourceConversationId: CONVERSATION_SOURCE_ID,
        currency: "USD",
        effectiveComparisonCostCents: 1_000,
        annualizedCostCents: 1_000,
        policyTermMonths: 12,
        quoteValidUntil: QUOTE_VALID_UNTIL,
        coverageEquivalence: { status: "better_than_requested" },
        evidenceIds: ["evidence-target"],
        simulated: true,
        requiresHumanVerification: true,
        disclaimer: SIMULATED_CALL_DISCLAIMER,
      },
      requestedOutcome: "lower_price_with_same_or_better_coverage",
      selectionSource: "system_recommendation",
      generatedAt: "2026-07-18T12:00:00.000Z",
    });
    expect(result.target.recommendationScore).toBe(
      createHandoffFixture().recommendation.rankedQualifyingQuotes[0]?.scoreBreakdown.weightedTotal,
    );
    expect(result.target.selectionExplanation).toContain("lowest valid all-in policy-term cost");
  });

  it("uses exactly five Top Five providers with one conversation quote and transcript evidence each", () => {
    const fixture = createHandoffFixture();

    expect(fixture.providerRanking.selected).toHaveLength(5);
    expect(fixture.quotes).toHaveLength(5);
    expect(new Set(fixture.quotes.map(({ providerId }) => providerId))).toEqual(
      new Set(fixture.providerRanking.selected.map(({ providerId }) => providerId)),
    );
    expect(fixture.evidence).toHaveLength(5);
    expect(
      fixture.evidence.every(
        (evidence) =>
          evidence.type === "transcript" &&
          evidence.verificationStatus === "user_confirmed" &&
          evidence.sourceId === CONVERSATION_SOURCE_ID,
      ),
    ).toBe(true);
  });

  it("never treats simulated conversation evidence as verified leverage", () => {
    expect(buildNegotiationHandoff(createHandoffFixture()).verifiedCompetingQuote).toBeNull();
  });

  it.each([
    ["quotes", (fixture: ReturnType<typeof createHandoffFixture>) => {
      fixture.quotes = fixture.quotes.slice(0, 4);
    }],
    ["ranked providers", (fixture: ReturnType<typeof createHandoffFixture>) => {
      fixture.providerRanking = {
        ...fixture.providerRanking,
        selected: fixture.providerRanking.selected.slice(0, 4),
      };
    }],
  ])("rejects fewer than five Top Five %s", (_label, mutate) => {
    const fixture = createHandoffFixture();
    mutate(fixture);

    expect(() => buildNegotiationHandoff(fixture)).toThrow();
  });

  it("rejects duplicate quote providers and resulting missing Top Five provider coverage", () => {
    const fixture = createHandoffFixture();
    fixture.quotes[4] = { ...fixture.quotes[4]!, providerId: "provider-4" };

    expect(() => buildNegotiationHandoff(fixture)).toThrow(/Top Five provider/);
  });

  it("rejects a stale conversation quote validity deadline", () => {
    const fixture = createHandoffFixture();
    fixture.quotes[0] = {
      ...fixture.quotes[0]!,
      quoteValidUntil: fixture.generatedAt.toISOString(),
    };

    expect(() => buildNegotiationHandoff(fixture)).toThrow(/stale/);
  });

  it("rejects non-transcript provenance for conversation evidence", () => {
    const fixture = createHandoffFixture();
    fixture.evidence[0] = {
      ...fixture.evidence[0]!,
      verificationStatus: "provider_confirmed",
    };

    expect(() => buildNegotiationHandoff(fixture)).toThrow(/invalid provenance/);
  });

  it.each([
    ["missing", null],
    ["missing required language", "This is a simulated quote for demonstration only."],
    ["missing not-binding warning", "This simulated quote is not supplied by the insurer."],
  ])("rejects a %s simulated quote disclaimer", (_label, disclaimer) => {
    const fixture = createHandoffFixture();
    fixture.quotes[0] = { ...fixture.quotes[0]!, disclaimer };

    expect(() => buildNegotiationHandoff(fixture)).toThrow(/disclaimer/);
  });

  it("rejects a simulated recommendation without required human verification", () => {
    const fixture = createHandoffFixture();
    fixture.quotes[0] = { ...fixture.quotes[0]!, requiresHumanVerification: false };

    expect(() => buildNegotiationHandoff(fixture)).toThrow(/human verification/);
  });

  it.each([
    ["recommendation/ranking workflow", (fixture: ReturnType<typeof createHandoffFixture>) => {
      fixture.providerRanking = { ...fixture.providerRanking, workflowId: "workflow-other" };
    }],
    ["recommendation/ranking hash", (fixture: ReturnType<typeof createHandoffFixture>) => {
      fixture.providerRanking = { ...fixture.providerRanking, specificationHash: OTHER_SPECIFICATION_HASH };
    }],
    ["ranking/quote request ID", (fixture: ReturnType<typeof createHandoffFixture>) => {
      fixture.quotes[0] = { ...fixture.quotes[0]!, confirmedRequestId: "request-other" };
    }],
    ["ranked/normalized provider ID", (fixture: ReturnType<typeof createHandoffFixture>) => {
      fixture.recommendation = {
        ...fixture.recommendation,
        rankedQualifyingQuotes: fixture.recommendation.rankedQualifyingQuotes.map((ranked, index) =>
          index === 0 ? { ...ranked, providerId: "provider-2" } : ranked,
        ),
      };
    }],
  ])("rejects mismatched %s", (_label, mutate) => {
    const fixture = createHandoffFixture();
    mutate(fixture);

    expect(() => buildNegotiationHandoff(fixture)).toThrow();
  });

  it.each(MISSING_METADATA_CASES)("rejects a recommended quote missing conversation %s metadata", (_label, overrides) => {
    const fixture = createHandoffFixture();
    fixture.quotes[0] = { ...fixture.quotes[0]!, ...overrides };

    expect(() => buildNegotiationHandoff(fixture)).toThrow();
  });

  it("rejects a recommendation with no qualifying quote", () => {
    const fixture = createHandoffFixture();
    fixture.recommendation = {
      ...fixture.recommendation,
      rankedQualifyingQuotes: [],
      disqualifiedQuotes: fixture.quotes.map(({ quoteId }) => ({
        quoteId,
        reasons: ["quote_not_complete"],
      })),
      recommendedQuoteId: null,
      lowestPriceEquivalentQuoteId: null,
      bestCoverageQuoteId: null,
      bestValueAlternativeQuoteId: null,
    };

    expect(() => buildNegotiationHandoff(fixture)).toThrow(/qualifying system recommendation/);
  });

  it("is deterministic and does not mutate its input", () => {
    const fixture = createHandoffFixture();
    const before = JSON.stringify(fixture);

    expect(buildNegotiationHandoff(fixture)).toEqual(buildNegotiationHandoff(fixture));
    expect(JSON.stringify(fixture)).toBe(before);
  });

  it("ignores a recommendation's legacy user selection and keeps the system target", () => {
    const fixture = createHandoffFixture();
    fixture.recommendation = {
      ...fixture.recommendation,
      userSelectedNegotiationQuoteId: "quote-2",
      selectionDiffersFromRecommendation: true,
    };

    expect(buildNegotiationHandoff(fixture)).toMatchObject({
      target: { quoteId: "quote-1" },
      selectionSource: "system_recommendation",
    });
  });

  it("returns the handoff and rejects the removed user-selection route input", async () => {
    const fixture = createHandoffFixture();
    const previousKey = process.env.POLICYSCOUT_INTERNAL_API_KEY;
    process.env.POLICYSCOUT_INTERNAL_API_KEY = "handoff-test-key";

    try {
      const requestBody = {
        workflowId: fixture.recommendation.workflowId,
        specificationHash: fixture.recommendation.specificationHash,
        insuranceLine: "auto",
        quotes: fixture.quotes,
        effectiveOffers: [],
        providerRanking: fixture.providerRanking,
        evidence: fixture.evidence,
        generatedAt: fixture.generatedAt.toISOString(),
      };
      const makeRequest = (body: unknown) =>
        new Request("http://localhost/api/recommendations", {
          method: "POST",
          headers: {
            Authorization: "Bearer handoff-test-key",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

      const response = await recommend(makeRequest(requestBody));
      const body = (await response.json()) as {
        recommendation: { userSelectedNegotiationQuoteId: string | null };
        recommendedDeal: { quoteId: string };
        negotiationHandoff: { target: { quoteId: string } };
      };
      expect(response.status).toBe(200);
      expect(body.recommendation.userSelectedNegotiationQuoteId).toBeNull();
      expect(body.recommendedDeal.quoteId).toBe("quote-1");
      expect(body.negotiationHandoff.target).toEqual(body.recommendedDeal);

      const overrideResponse = await recommend(
        makeRequest({ ...requestBody, userSelectedNegotiationQuoteId: "quote-2" }),
      );
      expect(overrideResponse.status).toBe(400);
    } finally {
      if (previousKey === undefined) delete process.env.POLICYSCOUT_INTERNAL_API_KEY;
      else process.env.POLICYSCOUT_INTERNAL_API_KEY = previousKey;
    }
  });

  it("rejects stale replay even when the request supplies a historical generatedAt", async () => {
    const fixture = createHandoffFixture();
    const previousKey = process.env.POLICYSCOUT_INTERNAL_API_KEY;
    process.env.POLICYSCOUT_INTERNAL_API_KEY = "handoff-test-key";
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
      const response = await recommend(
        new Request("http://localhost/api/recommendations", {
          method: "POST",
          headers: {
            Authorization: "Bearer handoff-test-key",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workflowId: fixture.recommendation.workflowId,
            specificationHash: fixture.recommendation.specificationHash,
            insuranceLine: "auto",
            quotes: fixture.quotes,
            effectiveOffers: [],
            providerRanking: fixture.providerRanking,
            evidence: fixture.evidence,
            generatedAt: fixture.generatedAt.toISOString(),
          }),
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    } finally {
      vi.useRealTimers();
      if (previousKey === undefined) delete process.env.POLICYSCOUT_INTERNAL_API_KEY;
      else process.env.POLICYSCOUT_INTERNAL_API_KEY = previousKey;
    }
  });
});
