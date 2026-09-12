import { describe, expect, it } from "vitest";

import { MockResearchProvider, rankResearchResult } from "@/domain/research";

import { EVALUATED_AT, makeQuoteRequest } from "./factories";

describe("MockResearchProvider", () => {
  it("builds deterministic request-specific fictional candidates and supports backfill", async () => {
    const provider = new MockResearchProvider();
    const request = makeQuoteRequest();
    const input = { quoteRequest: request, retrievedAt: EVALUATED_AT };
    const first = await provider.research(input);
    const second = await provider.research(input);

    expect(second).toEqual(first);
    expect(first.candidates.length).toBeGreaterThan(5);
    expect(first.candidates.every((candidate) => candidate.simulated)).toBe(true);
    expect(first.candidates.every((candidate) => candidate.insuranceLines.includes("auto"))).toBe(true);
    expect(
      first.candidates.every((candidate) =>
        request.requestedCoverage.every((coverage) =>
          candidate.preliminaryCoverageCodes.includes(coverage.coverageCode),
        ),
      ),
    ).toBe(true);

    const initialRanking = rankResearchResult(request, first, EVALUATED_AT);
    const excludedId = initialRanking.selected[0].providerId;
    const backfilled = rankResearchResult(
      makeQuoteRequest({ excludedProviderIds: [excludedId] }),
      first,
      EVALUATED_AT,
    );

    expect(initialRanking.selected).toHaveLength(5);
    expect(backfilled.selected).toHaveLength(5);
    expect(backfilled.selected.some((candidate) => candidate.providerId === excludedId)).toBe(false);
    expect(backfilled.selected[4].providerId).toBe(initialRanking.eligibleAlternates[0].providerId);
  });
});
