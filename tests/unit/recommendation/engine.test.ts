import { describe, expect, it } from "vitest";

import { deriveEffectiveOffer, validateNegotiationEvent } from "@/domain/negotiation";
import { buildRecommendation } from "@/domain/recommendation";

import {
  createGoal,
  createConfirmedRequest,
  createCoverageItem,
  createEvidence,
  createNegotiationEvent,
  createNegotiationEvidence,
  createQuote,
  OTHER_SPECIFICATION_HASH,
  SPECIFICATION_HASH,
} from "./factories";

const generatedAt = new Date("2026-07-18T12:00:00.000Z");

describe("deterministic recommendation", () => {
  it("hard-disqualifies workflow/hash mismatches, non-equivalence, missing cost, and blocking flags", () => {
    const result = buildRecommendation({
      workflowId: "workflow-1",
      specificationHash: SPECIFICATION_HASH,
      generatedAt,
      quotes: [
        createQuote({ quoteId: "valid" }),
        createQuote({ quoteId: "wrong-workflow", workflowId: "workflow-other" }),
        createQuote({ quoteId: "wrong-hash", specificationHash: OTHER_SPECIFICATION_HASH }),
        createQuote({
          quoteId: "non-equivalent",
          coverageEquivalence: { status: "worse_than_requested", differences: ["Lower limit"] },
        }),
        createQuote({ quoteId: "missing-cost", effectiveComparisonCostCents: null }),
        createQuote({
          quoteId: "blocking",
          redFlags: [{ code: "material_exclusion", severity: "blocking", message: "Material exclusion" }],
        }),
      ],
    });

    expect(result.rankedQualifyingQuotes.map(({ quoteId }) => quoteId)).toEqual(["valid"]);
    expect(result.disqualifiedQuotes).toHaveLength(5);
    expect(result.disqualifiedQuotes.find(({ quoteId }) => quoteId === "blocking")?.reasons).toContain(
      "blocking_flag:material_exclusion",
    );
  });

  it("uses configured 45/25/10/10/5/5 weights and a deterministic quote-ID tie-break", () => {
    const result = buildRecommendation({
      workflowId: "workflow-1",
      specificationHash: SPECIFICATION_HASH,
      generatedAt,
      quotes: [
        createQuote({ quoteId: "quote-b", providerId: "provider-b", paymentOptions: ["1", "2", "3", "4"] }),
        createQuote({ quoteId: "quote-a", providerId: "provider-a", paymentOptions: ["1", "2", "3", "4"] }),
      ],
    });

    expect(result.rankedQualifyingQuotes.map(({ quoteId }) => quoteId)).toEqual(["quote-a", "quote-b"]);
    expect(result.rankedQualifyingQuotes[0]?.scoreBreakdown).toMatchObject({
      cost: 100,
      coverage: 90,
      completeness: 100,
      evidence: 100,
      providerVerification: 100,
      paymentFlexibility: 100,
      weightedTotal: 97.5,
    });
  });

  it("reranks the immutable negotiated offer and preserves evidence, event ID, selection difference, and savings", () => {
    const selectedOriginal = createQuote({ quoteId: "quote-selected", providerId: "provider-selected", effectiveComparisonCostCents: 1_000 });
    const initiallyRecommended = createQuote({
      quoteId: "quote-initial-best",
      providerId: "provider-best",
      effectiveComparisonCostCents: 900,
    });
    const before = buildRecommendation({
      workflowId: "workflow-1",
      specificationHash: SPECIFICATION_HASH,
      generatedAt,
      quotes: [selectedOriginal, initiallyRecommended],
      userSelectedNegotiationQuoteId: selectedOriginal.quoteId,
    });
    const validated = validateNegotiationEvent({
      event: createNegotiationEvent({
        originalQuoteId: selectedOriginal.quoteId,
        targetProviderId: selectedOriginal.providerId,
        originalCostCents: 1_000,
        finalCostCents: 800,
      }),
      goal: createGoal({ selectedQuoteId: selectedOriginal.quoteId, targetProviderId: selectedOriginal.providerId }),
      originalQuote: selectedOriginal,
      confirmedRequest: createConfirmedRequest(),
      evidence: [createEvidence(), createNegotiationEvidence()],
    });
    const offer = deriveEffectiveOffer(validated);
    const after = buildRecommendation({
      workflowId: "workflow-1",
      specificationHash: SPECIFICATION_HASH,
      generatedAt,
      quotes: [selectedOriginal, initiallyRecommended],
      effectiveOffers: [offer],
      userSelectedNegotiationQuoteId: selectedOriginal.quoteId,
    });

    expect(before.recommendedQuoteId).toBe("quote-initial-best");
    expect(before.selectionDiffersFromRecommendation).toBe(true);
    expect(after.recommendedQuoteId).toBe("quote-selected");
    expect(after.selectionDiffersFromRecommendation).toBe(false);
    expect(after.savingsFromNegotiationCents).toBe(200);
    expect(after.rankedQualifyingQuotes[0]).toMatchObject({
      quoteId: "quote-selected",
      negotiationEventId: "event-1",
      effectiveCostCents: 800,
    });
    expect(after.rankedQualifyingQuotes[0]?.evidenceIds).toEqual(
      expect.arrayContaining(["evidence-quote", "evidence-negotiation"]),
    );
    expect(after.evidenceIds).toContain("evidence-negotiation");
    expect(selectedOriginal.effectiveComparisonCostCents).toBe(1_000);
  });

  it("disqualifies a cheaper negotiated offer that downgrades required coverage", () => {
    const original = createQuote();
    const validated = validateNegotiationEvent({
      event: createNegotiationEvent({
        changedCoverage: [createCoverageItem({ deductibleCents: 1_000, evidenceIds: ["evidence-negotiation"] })],
      }),
      goal: createGoal(),
      originalQuote: original,
      confirmedRequest: createConfirmedRequest(),
      evidence: [createEvidence(), createNegotiationEvidence()],
    });
    const offer = deriveEffectiveOffer(validated);
    const result = buildRecommendation({
      workflowId: "workflow-1",
      specificationHash: SPECIFICATION_HASH,
      generatedAt,
      quotes: [original],
      effectiveOffers: [offer],
    });

    expect(offer.effectiveQuote.coverageEquivalence.status).toBe("worse_than_requested");
    expect(offer.effectiveQuote.redFlags.map(({ code }) => code)).toContain("higher_deductible");
    expect(result.rankedQualifyingQuotes).toEqual([]);
    expect(result.disqualifiedQuotes[0]?.reasons).toEqual(
      expect.arrayContaining(["coverage_not_equivalent", "blocking_flag:higher_deductible"]),
    );
  });
});
