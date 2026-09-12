import { describe, expect, it } from "vitest";

import type { NegotiationHandoff, NegotiationGoal } from "@/domain/schemas/person4";
import {
  ConversationInvariantError,
  ConversationSessionService,
  PreparedNegotiationContextService,
  buildSafeNegotiationContext,
} from "@/server/services/conversations";

const specificationHash = "a".repeat(64);
const handoff: NegotiationHandoff = {
  workflowId: "workflow-1",
  specificationHash,
  target: {
    providerId: "provider-1",
    providerName: "Demo Mutual",
    quoteId: "quote-1",
    scenarioId: "scenario-1",
    currency: "USD",
    effectiveComparisonCostCents: 60_000,
    annualizedCostCents: 120_000,
    policyTermMonths: 6,
    quoteValidUntil: "2030-01-01T00:00:00.000Z",
    coverageEquivalence: { status: "equivalent", differences: [] },
    recommendationScore: 92,
    selectionExplanation: "Lowest equivalent demo quote",
    evidenceIds: ["evidence-1"],
    simulated: true,
    requiresHumanVerification: true,
    disclaimer: "Simulated quote; not supplied by the insurer and not binding.",
  },
  verifiedCompetingQuote: {
    providerId: "provider-2",
    providerName: "Sample Insurance",
    quoteId: "quote-2",
    effectiveComparisonCostCents: 58_000,
    coverageEquivalence: { status: "equivalent", differences: [] },
    evidenceIds: ["evidence-2"],
  },
  requestedOutcome: "lower_price_with_same_or_better_coverage",
  selectionSource: "system_recommendation",
  generatedAt: "2029-01-01T00:00:00.000Z",
};
const goal: NegotiationGoal = {
  id: "goal-1",
  workflowId: "workflow-1",
  selectedQuoteId: "quote-1",
  targetProviderId: "provider-1",
  targetAmountCents: 55_000,
  targetRangeMinCents: null,
  targetRangeMaxCents: null,
  billingFrequency: "semiannual",
  desiredNonPriceImprovements: ["waive installment fee"],
  allowedTradeoffs: ["paperless billing"],
  hardStops: ["never exceed 65000 cents"],
  verifiedCompetingQuoteId: "quote-2",
  disclosurePolicy: "do_not_reveal_ceiling",
  confirmedAt: "2029-01-01T00:01:00.000Z",
};
const explicitSelection = {
  quoteId: "quote-1",
  providerId: "provider-1",
  specificationHash,
  selectedAt: "2029-01-01T00:02:00.000Z",
};
const participant = { displayName: "Alex Morgan" };

describe("Person 3 conversation integration", () => {
  it("requires explicit selection even when a system recommendation exists", () => {
    expect(() => buildSafeNegotiationContext({ participant, handoff, goal })).toThrowError(
      expect.objectContaining({ code: "EXPLICIT_SELECTION_REQUIRED" }),
    );
  });

  it.each([
    ["quote", { ...explicitSelection, quoteId: "quote-other" }, "QUOTE_MISMATCH"],
    ["provider", { ...explicitSelection, providerId: "provider-other" }, "PROVIDER_MISMATCH"],
    ["specification", { ...explicitSelection, specificationHash: "b".repeat(64) }, "SPECIFICATION_MISMATCH"],
  ])("rejects a wrong %s selection", (_label, selection, code) => {
    expect(() => buildSafeNegotiationContext({ participant, handoff, goal, explicitSelection: selection })).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it("builds a client-safe context without targets, ceilings, hard stops, tradeoffs, or ranking", () => {
    const context = buildSafeNegotiationContext({ participant, handoff, goal, explicitSelection });
    const serialized = JSON.stringify(context);

    expect(context.selectedProviderName).toBe("Demo Mutual");
    expect(context.userDisplayName).toBe("Alex Morgan");
    expect(context.negotiationGoalId).toBe("goal-1");
    expect(context.currentMonthlyEffectiveCostCents).toBe(10_000);
    expect(context.allowedLeverageText).toContain("Sample Insurance");
    expect(context.aiDisclosure).toContain("AI voice agent");
    expect(context.simulated).toBe(true);
    expect(context.requiresHumanVerification).toBe(true);
    expect(context.aiDisclosure).toContain("not supplied by the insurer");
    expect(context.aiDisclosure).toContain("non-binding");
    expect(serialized).not.toContain("55000");
    expect(serialized).not.toContain("65000");
    expect(serialized).not.toContain("paperless billing");
    expect(serialized).not.toContain("Lowest equivalent demo quote");
  });

  it.each([
    ["workflowId", { workflowId: "workflow-other" }],
    ["providerId", { providerId: "provider-other" }],
    ["quoteId", { quoteId: "quote-other" }],
    ["specificationHash", { specificationHash: "b".repeat(64) }],
    ["selectedAt", { selectedAt: "2029-01-01T00:03:00.000Z" }],
  ])("requires an exact %s match to trusted prepared context", async (_field, change) => {
    const contexts = new PreparedNegotiationContextService({
      async load() { return { participant, handoff, goal, explicitSelection }; },
    });

    await expect(contexts.load({
      workflowId: handoff.workflowId,
      providerId: explicitSelection.providerId,
      quoteId: explicitSelection.quoteId,
      specificationHash,
      selectedAt: explicitSelection.selectedAt,
      ...change,
    })).rejects.toMatchObject({ code: "NEGOTIATION_REFERENCE_MISMATCH" });
  });

  it("rejects absent, mismatched, or self-referential verified leverage", () => {
    expect(() => buildSafeNegotiationContext({
      participant,
      handoff: { ...handoff, verifiedCompetingQuote: null },
      goal,
      explicitSelection,
    })).toThrowError(expect.objectContaining({ code: "LEVERAGE_MISMATCH" }));

    expect(() => buildSafeNegotiationContext({
      participant,
      handoff,
      goal: { ...goal, verifiedCompetingQuoteId: "quote-other" },
      explicitSelection,
    })).toThrowError(expect.objectContaining({ code: "LEVERAGE_MISMATCH" }));

    expect(() => buildSafeNegotiationContext({
      participant,
      handoff: {
        ...handoff,
        verifiedCompetingQuote: { ...handoff.verifiedCompetingQuote!, quoteId: "quote-1" },
      },
      goal: { ...goal, verifiedCompetingQuoteId: "quote-1" },
      explicitSelection,
    })).toThrowError(expect.objectContaining({ code: "INVALID_LEVERAGE" }));
  });

  it("rejects an invalid participant and a prepared context without one", async () => {
    expect(() => buildSafeNegotiationContext({
      participant: { displayName: "Alex\nMorgan" },
      handoff,
      goal,
      explicitSelection,
    })).toThrowError(expect.objectContaining({ code: "INVALID_PARTICIPANT" }));
    expect(() => buildSafeNegotiationContext({
      participant: { displayName: "Alex\u0085Morgan" },
      handoff,
      goal,
      explicitSelection,
    })).toThrowError(expect.objectContaining({ code: "INVALID_PARTICIPANT" }));

    const contexts = new PreparedNegotiationContextService({
      async load() { return { handoff, goal, explicitSelection }; },
    });
    await expect(contexts.load({
      workflowId: handoff.workflowId,
      providerId: explicitSelection.providerId,
      quoteId: explicitSelection.quoteId,
      specificationHash,
      selectedAt: explicitSelection.selectedAt,
    })).rejects.toMatchObject({ code: "PREPARED_CONTEXT_INVALID" });
  });

  it("enforces lifecycle transitions, bounded retries, and idempotent completion", () => {
    const service = new ConversationSessionService();
    const created = service.create("negotiation", { participant, handoff, goal, explicitSelection });
    const active = service.activate(created.id, "conversation-1");
    expect("checkNegotiationGoal" in service).toBe(false);
    const processing = service.beginProcessing(active.id);
    const completed = service.complete(processing.id);

    expect(created.state).toBe("connecting");
    expect(active.state).toBe("active");
    expect(processing.state).toBe("processing");
    expect(completed.state).toBe("completed");
    expect(service.complete(completed.id)).toEqual(completed);
    expect(() => service.retry(completed.id)).toThrowError(ConversationInvariantError);
  });
});
