import { describe, expect, it } from "vitest";

import {
  deriveEffectiveOffer,
  NegotiationValidationError,
  validateNegotiationEvent,
} from "@/domain/negotiation";

import {
  createCoverageItem,
  createConfirmedRequest,
  createEvidence,
  createGoal,
  createNegotiationEvent,
  createNegotiationEvidence,
  createNegotiatedDiscount,
  createQuote,
  OTHER_SPECIFICATION_HASH,
} from "./factories";

function validate(overrides: Parameters<typeof createNegotiationEvent>[0] = {}) {
  return validateNegotiationEvent({
    event: createNegotiationEvent(overrides),
    goal: createGoal(),
    originalQuote: createQuote(),
    confirmedRequest: createConfirmedRequest(),
    evidence: [createEvidence(), createNegotiationEvidence()],
  });
}

describe("negotiation event validation", () => {
  it("recomputes savings from provider-confirmed original and final costs", () => {
    const validated = validateNegotiationEvent({
      event: createNegotiationEvent({ finalCostCents: 750, changedDiscounts: [createNegotiatedDiscount(250)] }),
      goal: createGoal(),
      originalQuote: createQuote(),
      confirmedRequest: createConfirmedRequest(),
      evidence: [createEvidence(), createNegotiationEvidence({ claimValue: 750 })],
    });

    expect(validated.savingsCents).toBe(250);
  });

  it.each([
    ["goal", { negotiationGoalId: "goal-other" }],
    ["provider", { targetProviderId: "provider-other" }],
    ["original", { originalQuoteId: "quote-other" }],
    ["hash", { specificationHash: OTHER_SPECIFICATION_HASH }],
    ["original cost", { originalCostCents: 999 }],
    ["provider confirmation", { verificationStatus: "user_confirmed" as const }],
  ])("rejects a tampered %s", (_label, overrides) => {
    expect(() => validate(overrides)).toThrow(NegotiationValidationError);
  });

  it("rejects missing or unverified event evidence", () => {
    expect(() =>
      validateNegotiationEvent({
        event: createNegotiationEvent(),
        goal: createGoal(),
        originalQuote: createQuote(),
        confirmedRequest: createConfirmedRequest(),
        evidence: [],
      }),
    ).toThrow(/missing evidence/i);
    expect(() =>
      validateNegotiationEvent({
        event: createNegotiationEvent(),
        goal: createGoal(),
        originalQuote: createQuote(),
        confirmedRequest: createConfirmedRequest(),
        evidence: [createNegotiationEvidence({ verificationStatus: "unverified" })],
      }),
    ).toThrow(/not provider-confirmed/i);
  });

  it("requires an authoritative request matching the original workflow, request ID, and hash", () => {
    expect(() =>
      validateNegotiationEvent({
        event: createNegotiationEvent(),
        goal: createGoal(),
        originalQuote: createQuote(),
        confirmedRequest: createConfirmedRequest({ id: "request-other", workflowId: "workflow-other" }),
        evidence: [createNegotiationEvidence()],
      }),
    ).toThrow(/confirmed request/i);
  });

  it("rejects zero final cost and final cost without exact provider-confirmed evidence", () => {
    expect(() => validate({ finalCostCents: 0 })).toThrow(/greater than zero/i);
    expect(() =>
      validateNegotiationEvent({
        event: createNegotiationEvent(),
        goal: createGoal(),
        originalQuote: createQuote(),
        confirmedRequest: createConfirmedRequest(),
        evidence: [createNegotiationEvidence({ claimValue: 799 })],
      }),
    ).toThrow(/provider-confirm the final cost/i);
  });

  it("rejects a final cost inconsistent with the overlaid offer components", () => {
    expect(() =>
      validateNegotiationEvent({
        event: createNegotiationEvent({ finalCostCents: 700 }),
        goal: createGoal(),
        originalQuote: createQuote(),
        confirmedRequest: createConfirmedRequest(),
        evidence: [createEvidence(), createNegotiationEvidence({ claimValue: { amountCents: 700, currency: "USD" } })],
      }),
    ).toThrow(/recomputed final offer components/i);
  });

  it("checks a competing quote against the confirmed goal and original quote", () => {
    expect(() =>
      validateNegotiationEvent({
        event: createNegotiationEvent({ competingQuoteId: "quote-competing", verifiedLeverageStatement: "A lower offer exists." }),
        goal: createGoal({ verifiedCompetingQuoteId: "quote-competing" }),
        originalQuote: createQuote(),
        confirmedRequest: createConfirmedRequest(),
        competingQuote: createQuote({ quoteId: "quote-competing", confirmedRequestId: "request-other" }),
        evidence: [createNegotiationEvidence()],
      }),
    ).toThrow(/confirmed request/i);
  });
});

describe("effective offer derivation", () => {
  it("creates a final snapshot without mutating the original normalized quote", () => {
    const original = createQuote();
    const before = structuredClone(original);
    const changedCoverage = createCoverageItem({ limitCents: 200_000, evidenceIds: ["evidence-negotiation"] });
    const validated = validateNegotiationEvent({
      event: createNegotiationEvent({ changedCoverage: [changedCoverage] }),
      goal: createGoal(),
      originalQuote: original,
      confirmedRequest: createConfirmedRequest(),
      evidence: [createEvidence(), createNegotiationEvidence()],
    });

    const snapshot = deriveEffectiveOffer(validated);

    expect(original).toEqual(before);
    expect(snapshot.effectiveQuote).not.toBe(original);
    expect(snapshot.effectiveQuote.effectiveComparisonCostCents).toBe(800);
    expect(snapshot.effectiveQuote.coverageItems[0]?.limitCents).toBe(200_000);
    expect(snapshot.negotiationEventId).toBe("event-1");
    expect(snapshot.evidenceIds).toEqual(expect.arrayContaining(["evidence-quote", "evidence-negotiation"]));
    expect(snapshot.effectiveQuote.requiresHumanVerification).toBe(true);
    expect(Object.isFrozen(snapshot.effectiveQuote)).toBe(true);
    expect(Object.isFrozen(snapshot.effectiveQuote.coverageItems)).toBe(true);
  });
});
