import { describe, it, expect } from "vitest";
import {
  demoProfile,
  demoConfirmedRequest,
  demoRankingResult,
  demoQuotes,
  demoRecommendedQuoteId,
  demoNegotiationGoal,
  demoNegotiationEvent,
} from "../../src/demo/fixtures/personal-auto.js";
import { InsuranceProfileSchema } from "../../src/domain/schemas/insurance-profile.js";
import { NormalizedQuoteSchema } from "../../src/domain/schemas/normalized-quote.js";

// Fixtures are parsed at module load; these assert the demo invariants the
// other three people rely on.
describe("demo fixtures (Checkpoint 1 handoff)", () => {
  it("profile re-validates and is quote-ready", () => {
    expect(() => InsuranceProfileSchema.parse(demoProfile)).not.toThrow();
    expect(demoProfile.quoteReady).toBe(true);
  });

  it("research returns exactly five ranked providers (test #10)", () => {
    expect(demoRankingResult.rankedProviders).toHaveLength(5);
    expect(demoRankingResult.hasFiveEligible).toBe(true);
  });

  it("every Top-5 provider has a rank, score explanation and sources (test #11)", () => {
    for (const p of demoRankingResult.rankedProviders) {
      expect(p.topFiveRank).not.toBeNull();
      expect(p.selectionExplanation).toBeTruthy();
      expect(p.researchSources.length).toBeGreaterThan(0);
    }
  });

  it("there are five quotes with at least three comparable (DoD)", () => {
    expect(demoQuotes).toHaveLength(5);
    for (const q of demoQuotes) NormalizedQuoteSchema.parse(q);
    const comparable = demoQuotes.filter(
      (q) =>
        q.coverageEquivalence === "equivalent" ||
        q.coverageEquivalence === "better_than_requested"
    );
    expect(comparable.length).toBeGreaterThanOrEqual(3);
  });

  it("system recommendation is separate from the user's negotiation selection (test #19)", () => {
    expect(demoRecommendedQuoteId).not.toBe(demoNegotiationGoal.selectedQuoteId);
  });

  it("negotiation goal's provider matches the selected quote's provider (test #21)", () => {
    const selected = demoQuotes.find(
      (q) => q.quoteId === demoNegotiationGoal.selectedQuoteId
    );
    expect(selected).toBeDefined();
    expect(selected!.providerId).toBe(demoNegotiationGoal.targetProviderId);
  });

  it("competing leverage is a different comparable quote, same hash (test #22, #23)", () => {
    expect(demoNegotiationGoal.verifiedCompetingQuoteId).not.toBe(
      demoNegotiationGoal.selectedQuoteId
    );
    const competing = demoQuotes.find(
      (q) => q.quoteId === demoNegotiationGoal.verifiedCompetingQuoteId
    );
    expect(competing!.specificationHash).toBe(
      demoConfirmedRequest.specificationHash
    );
  });

  it("negotiation event records a measurable improvement (DoD)", () => {
    expect(demoNegotiationEvent.savingsAmount).toBeGreaterThan(0);
    expect(demoNegotiationEvent.finalPrice!).toBeLessThan(
      demoNegotiationEvent.originalPrice!
    );
    expect(demoNegotiationEvent.targetMet).toBe(true);
  });
});
