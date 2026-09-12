import { describe, expect, it } from "vitest";

import {
  buildNegotiatorGoalView,
  NegotiationValidationError,
  validateNegotiationGoal,
} from "@/domain/negotiation";

import { createGoal, createQuote } from "./factories";

describe("negotiation goal validation", () => {
  it("requires the selected quote, provider, and workflow to match", () => {
    const quote = createQuote();

    expect(() => validateNegotiationGoal(createGoal({ selectedQuoteId: "quote-other" }), quote)).toThrow(
      NegotiationValidationError,
    );
    expect(() => validateNegotiationGoal(createGoal({ targetProviderId: "provider-other" }), quote)).toThrow(
      /target provider/i,
    );
    expect(() => validateNegotiationGoal(createGoal({ workflowId: "workflow-other" }), quote)).toThrow(/workflow/i);
  });

  it.each([
    createGoal({ targetAmountCents: null }),
    createGoal({ targetRangeMinCents: 800, targetRangeMaxCents: 900 }),
    createGoal({ targetAmountCents: null, targetRangeMinCents: 900, targetRangeMaxCents: null }),
    createGoal({ targetAmountCents: null, targetRangeMinCents: 950, targetRangeMaxCents: 900 }),
  ])("rejects an invalid or ambiguous target form", (goal) => {
    expect(() => validateNegotiationGoal(goal, createQuote())).toThrow(NegotiationValidationError);
  });

  it("binds disclosure policies to their corresponding target form", () => {
    expect(() =>
      validateNegotiationGoal(
        createGoal({
          targetAmountCents: null,
          targetRangeMinCents: 800,
          targetRangeMaxCents: 900,
          disclosurePolicy: "reveal_target_only",
        }),
        createQuote(),
      ),
    ).toThrow(/reveal_target_only/);
    expect(() => validateNegotiationGoal(createGoal({ disclosurePolicy: "reveal_range" }), createQuote())).toThrow(
      /reveal_range/,
    );
  });
});

describe("provider-safe negotiation goal view", () => {
  it("does not leak private target or hard-stop values when the ceiling is undisclosed", () => {
    const view = buildNegotiatorGoalView(createGoal());
    const serialized = JSON.stringify(view);

    expect(view.disclosedTargetAmountCents).toBeNull();
    expect(view.disclosedRangeMinCents).toBeNull();
    expect(view.disclosedRangeMaxCents).toBeNull();
    expect(serialized).not.toContain("987654321");
    expect(serialized).not.toContain("verifiedCompetingQuoteId");
    expect(serialized).not.toContain("disclosurePolicy");
  });

  it("reveals only the explicitly authorized single target", () => {
    const view = buildNegotiatorGoalView(createGoal({ disclosurePolicy: "reveal_target_only" }));

    expect(view.disclosedTargetAmountCents).toBe(900);
    expect(view.disclosedRangeMinCents).toBeNull();
    expect(view.disclosedRangeMaxCents).toBeNull();
  });

  it("reveals only the explicitly authorized range", () => {
    const view = buildNegotiatorGoalView(
      createGoal({
        targetAmountCents: null,
        targetRangeMinCents: 800,
        targetRangeMaxCents: 900,
        disclosurePolicy: "reveal_range",
      }),
    );

    expect(view.disclosedTargetAmountCents).toBeNull();
    expect(view.disclosedRangeMinCents).toBe(800);
    expect(view.disclosedRangeMaxCents).toBe(900);
  });
});
