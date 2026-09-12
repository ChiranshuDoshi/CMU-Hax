import { describe, expect, it } from "vitest";

import {
  ELIGIBILITY_REASONS,
  INSUFFICIENT_ELIGIBLE_PROVIDERS_WARNING,
  rankProviders,
} from "@/domain/research";

import { EVALUATED_AT, makeCandidate, makeQuoteRequest } from "./factories";

describe("provider eligibility and ranking", () => {
  it("selects exactly five with citations, explanations, deterministic order, and alternates", () => {
    const candidates = [
      makeCandidate("foxtrot", { rating: 4.1 }),
      makeCandidate("echo", { rating: 4.2 }),
      makeCandidate("delta", { rating: 4.3 }),
      makeCandidate("charlie", { rating: 4.4 }),
      makeCandidate("bravo", { rating: 4.5 }),
      makeCandidate("alpha", { rating: 4.6 }),
    ];
    const request = makeQuoteRequest();
    const forward = rankProviders({ quoteRequest: request, candidates, evaluatedAt: EVALUATED_AT });
    const reverse = rankProviders({
      quoteRequest: request,
      candidates: [...candidates].reverse(),
      evaluatedAt: EVALUATED_AT,
    });

    expect(forward.selected).toHaveLength(5);
    expect(forward.selected.map((provider) => provider.providerId)).toEqual([
      "alpha",
      "bravo",
      "charlie",
      "delta",
      "echo",
    ]);
    expect(reverse).toEqual(forward);
    expect(forward.eligibleAlternates.map((provider) => provider.providerId)).toEqual(["foxtrot"]);
    expect(forward.selected.every((provider) => provider.sources.length > 0)).toBe(true);
    expect(forward.selected.every((provider) => provider.selectionExplanation.includes("Ranked #"))).toBe(true);
  });

  it("uses providerId as the final deterministic tie breaker", () => {
    const candidates = ["zulu", "echo", "delta", "charlie", "bravo", "alpha"].map((id) =>
      makeCandidate(id),
    );
    const result = rankProviders({
      quoteRequest: makeQuoteRequest(),
      candidates,
      evaluatedAt: EVALUATED_AT,
    });

    expect(result.selected.map((provider) => provider.providerId)).toEqual([
      "alpha",
      "bravo",
      "charlie",
      "delta",
      "echo",
    ]);
  });

  it("applies every eligibility gate before ranking", () => {
    const request = makeQuoteRequest({ excludedProviderIds: ["excluded"] });
    const candidates = [
      makeCandidate("excluded"),
      makeCandidate("line", { insuranceLines: [] }),
      makeCandidate("state", { nationwide: false, states: ["NY"] }),
      makeCandidate("zip", { excludedZipCodes: ["94105"] }),
      makeCandidate("coverage", { preliminaryCoverageCodes: ["collision"] }),
      makeCandidate("contact", { website: null, publicContact: null }),
      makeCandidate("citations", { sources: [] }),
    ];
    const result = rankProviders({ quoteRequest: request, candidates, evaluatedAt: EVALUATED_AT });
    const reasons = new Map(
      result.ineligible.map((provider) => [provider.providerId, provider.exclusionReasons]),
    );

    expect(reasons.get("excluded")).toContain(ELIGIBILITY_REASONS.excludedByUser);
    expect(reasons.get("line")).toContain(ELIGIBILITY_REASONS.insuranceLine);
    expect(reasons.get("state")).toContain(ELIGIBILITY_REASONS.state);
    expect(reasons.get("zip")).toContain(ELIGIBILITY_REASONS.zipCode);
    expect(reasons.get("coverage")).toContain(ELIGIBILITY_REASONS.coverage);
    expect(reasons.get("contact")).toContain(ELIGIBILITY_REASONS.contact);
    expect(reasons.get("citations")).toContain(ELIGIBILITY_REASONS.citations);
    expect(result.selected).toHaveLength(0);
  });

  it("excludes a selected provider and backfills from the next eligible alternate", () => {
    const candidates = [
      makeCandidate("alpha", { rating: 4.9 }),
      makeCandidate("bravo", { rating: 4.8 }),
      makeCandidate("charlie", { rating: 4.7 }),
      makeCandidate("delta", { rating: 4.6 }),
      makeCandidate("echo", { rating: 4.5 }),
      makeCandidate("foxtrot", { rating: 4.4 }),
    ];
    const result = rankProviders({
      quoteRequest: makeQuoteRequest({ excludedProviderIds: ["alpha"] }),
      candidates,
      evaluatedAt: EVALUATED_AT,
    });

    expect(result.selected.map((provider) => provider.providerId)).toEqual([
      "bravo",
      "charlie",
      "delta",
      "echo",
      "foxtrot",
    ]);
    expect(result.ineligible.find((provider) => provider.providerId === "alpha")?.exclusionReasons).toContain(
      ELIGIBILITY_REASONS.excludedByUser,
    );
  });

  it("keeps only the strongest representation of a canonical carrier", () => {
    const result = rankProviders({
      quoteRequest: makeQuoteRequest(),
      candidates: [
        makeCandidate("carrier-direct", { canonicalCarrierId: "carrier", rating: 4.8 }),
        makeCandidate("carrier-agent", { canonicalCarrierId: "carrier", rating: 4.2 }),
        makeCandidate("other"),
      ],
      evaluatedAt: EVALUATED_AT,
    });

    expect(result.selected.map((provider) => provider.providerId)).toEqual(["carrier-direct", "other"]);
    expect(
      result.ineligible.find((provider) => provider.providerId === "carrier-agent")?.exclusionReasons[0],
    ).toContain("Duplicate carrier representation");
  });

  it("warns and returns fewer than five without inventing candidates", () => {
    const result = rankProviders({
      quoteRequest: makeQuoteRequest(),
      candidates: [makeCandidate("one"), makeCandidate("two")],
      evaluatedAt: EVALUATED_AT,
    });

    expect(result.selected).toHaveLength(2);
    expect(result.warnings).toContain(INSUFFICIENT_ELIGIBLE_PROVIDERS_WARNING);
  });

  it("does not score a rating or review count without matching source evidence", () => {
    const candidate = makeCandidate("unsupported", { ratingSourceId: "missing-source" });
    const result = rankProviders({
      quoteRequest: makeQuoteRequest(),
      candidates: [candidate],
      evaluatedAt: EVALUATED_AT,
    });
    const selected = result.selected[0];

    expect(selected.normalizedRating).toBe(0);
    expect(selected.ratingConfidence).toBe(0);
    expect(selected.scoreBreakdown.sourceQuality).toBe(0);
    expect(selected.warnings[0]).toContain("not scored");
  });
});
