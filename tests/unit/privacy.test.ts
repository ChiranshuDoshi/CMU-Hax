import { describe, it, expect } from "vitest";
import { applyDisclosurePolicy } from "../../src/domain/privacy/disclosure.js";
import {
  findProviderLeaks,
  isProviderSafe,
  assertProviderSafe,
} from "../../src/domain/privacy/provider-safe.js";
import { NegotiationGoalSchema } from "../../src/domain/schemas/negotiation.js";
import { demoConfirmedRequest } from "../../src/demo/fixtures/personal-auto.js";

const baseGoal = {
  goalId: "g1",
  workflowId: "w1",
  selectedQuoteId: "q1",
  targetProviderId: "p1",
  targetRangeMin: 900,
  targetRangeMax: 1000,
  confirmedAt: "2026-07-18T12:00:00.000Z",
};

describe("disclosure policy (test #25, #26)", () => {
  it("do_not_reveal_ceiling exposes no target numbers", () => {
    const goal = NegotiationGoalSchema.parse({
      ...baseGoal,
      disclosurePolicy: "do_not_reveal_ceiling",
    });
    const d = applyDisclosurePolicy(goal);
    expect(d.disclosedTargetAmount).toBeNull();
    expect(d.disclosedRangeMin).toBeNull();
    expect(d.disclosedRangeMax).toBeNull();
    // the ceiling (1000) must not appear anywhere in the disclosure
    expect(JSON.stringify(d)).not.toContain("1000");
  });

  it("reveal_target_only exposes a single target, never the range max", () => {
    const goal = NegotiationGoalSchema.parse({
      ...baseGoal,
      targetAmount: 950,
      disclosurePolicy: "reveal_target_only",
    });
    const d = applyDisclosurePolicy(goal);
    expect(d.disclosedTargetAmount).toBe(950);
    expect(d.disclosedRangeMax).toBeNull();
  });

  it("reveal_range exposes both range ends", () => {
    const goal = NegotiationGoalSchema.parse({
      ...baseGoal,
      disclosurePolicy: "reveal_range",
    });
    const d = applyDisclosurePolicy(goal);
    expect(d.disclosedRangeMin).toBe(900);
    expect(d.disclosedRangeMax).toBe(1000);
  });
});

describe("provider-safe boundary", () => {
  it("flags a leaked ceiling / private field", () => {
    const leaky = { coverage: "ok", nested: { maxAnnualPremium: 1200 } };
    const leaks = findProviderLeaks(leaky);
    expect(leaks.map((l) => l.key)).toContain("maxAnnualPremium");
    expect(isProviderSafe(leaky)).toBe(false);
    expect(() => assertProviderSafe(leaky, "provider payload")).toThrow(
      /private data/i
    );
  });

  it("flags disallowed sensitive personal fields", () => {
    expect(isProviderSafe({ driver: { ssn: "000" } })).toBe(false);
  });

  it("the confirmed quote request is provider-safe", () => {
    expect(isProviderSafe(demoConfirmedRequest)).toBe(true);
  });
});
