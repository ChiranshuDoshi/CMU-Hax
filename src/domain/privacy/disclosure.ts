import type {
  NegotiationGoal,
  NegotiationGoalDisclosure,
  DisclosurePolicy,
} from "../schemas/negotiation.js";

/**
 * Project a full NegotiationGoal down to only what the Negotiator agent is
 * allowed to know, per the user's disclosure policy. (Spec §9.9, §27)
 *
 * This is the enforcement point for "the AI never reveals your ceiling":
 *   - do_not_reveal_ceiling → no target/range numbers leave the server
 *   - reveal_target_only    → only the single target amount is disclosed
 *   - reveal_range          → only the range min/max is disclosed
 *
 * The undisclosed ceiling (targetRangeMax under do_not_reveal_ceiling, or the
 * range under reveal_target_only) is never included in the returned object.
 */
export function applyDisclosurePolicy(
  goal: NegotiationGoal
): NegotiationGoalDisclosure {
  const policy: DisclosurePolicy = goal.disclosurePolicy;

  let disclosedTargetAmount: number | null = null;
  let disclosedRangeMin: number | null = null;
  let disclosedRangeMax: number | null = null;

  if (policy === "reveal_target_only") {
    // Prefer an explicit target; fall back to the low end of a range so the
    // agent still has a single number to aim for without exposing the ceiling.
    disclosedTargetAmount = goal.targetAmount ?? goal.targetRangeMin ?? null;
  } else if (policy === "reveal_range") {
    disclosedRangeMin = goal.targetRangeMin ?? goal.targetAmount ?? null;
    disclosedRangeMax = goal.targetRangeMax ?? null;
  }
  // do_not_reveal_ceiling → everything stays null.

  return {
    goalId: goal.goalId,
    selectedQuoteId: goal.selectedQuoteId,
    targetProviderId: goal.targetProviderId,
    disclosedTargetAmount,
    disclosedRangeMin,
    disclosedRangeMax,
    desiredNonPriceImprovements: goal.desiredNonPriceImprovements,
    allowedTradeoffs: goal.allowedTradeoffs,
    hasVerifiedCompetingQuote: goal.verifiedCompetingQuoteId !== null,
  };
}
