import {
  NegotiationGoalSchema,
  NegotiatorGoalViewSchema,
  NormalizedQuoteSchema,
  type NegotiationGoal,
  type NegotiatorGoalView,
} from "@/domain/schemas/person4";

import { NegotiationValidationError } from "./validation-error";

const SERVER_ENFORCED_HARD_STOP_INSTRUCTION =
  "Follow server-side hard-stop checks; do not accept an offer when the goal service reports a hard stop.";

function schemaIssues(error: { issues: readonly { path: PropertyKey[]; message: string }[] }): string[] {
  return error.issues.map(({ path, message }) => `${path.join(".") || "goal"}: ${message}`);
}

function validateTargetForm(goal: NegotiationGoal): string[] {
  const hasAmount = goal.targetAmountCents !== null;
  const hasRangeMin = goal.targetRangeMinCents !== null;
  const hasRangeMax = goal.targetRangeMaxCents !== null;
  const hasCompleteRange = hasRangeMin && hasRangeMax;
  const issues: string[] = [];

  if (hasAmount === hasCompleteRange || hasRangeMin !== hasRangeMax) {
    issues.push("Exactly one complete target form is required: a single amount or a minimum/maximum range");
  }

  if (
    hasCompleteRange &&
    goal.targetRangeMinCents !== null &&
    goal.targetRangeMaxCents !== null &&
    goal.targetRangeMinCents > goal.targetRangeMaxCents
  ) {
    issues.push("Target range minimum must not exceed its maximum");
  }

  if (goal.disclosurePolicy === "reveal_target_only" && !hasAmount) {
    issues.push("reveal_target_only requires a single target amount");
  }
  if (goal.disclosurePolicy === "reveal_range" && !hasCompleteRange) {
    issues.push("reveal_range requires a complete target range");
  }

  return issues;
}

export function parseNegotiationGoal(value: unknown): NegotiationGoal {
  const parsed = NegotiationGoalSchema.safeParse(value);
  if (!parsed.success) {
    throw new NegotiationValidationError("Invalid negotiation goal", schemaIssues(parsed.error));
  }

  const issues = validateTargetForm(parsed.data);
  if (issues.length > 0) {
    throw new NegotiationValidationError("Invalid negotiation goal", issues);
  }

  return parsed.data;
}

export function validateNegotiationGoal(value: unknown, selectedQuoteValue: unknown): NegotiationGoal {
  const goal = parseNegotiationGoal(value);
  const selectedQuote = NormalizedQuoteSchema.safeParse(selectedQuoteValue);
  if (!selectedQuote.success) {
    throw new NegotiationValidationError("Invalid selected quote", schemaIssues(selectedQuote.error));
  }

  const issues: string[] = [];
  if (goal.selectedQuoteId !== selectedQuote.data.quoteId) {
    issues.push("Negotiation goal selected quote does not match the user-selected quote");
  }
  if (goal.targetProviderId !== selectedQuote.data.providerId) {
    issues.push("Negotiation goal target provider does not match the selected quote provider");
  }
  if (goal.workflowId !== selectedQuote.data.workflowId) {
    issues.push("Negotiation goal workflow does not match the selected quote workflow");
  }

  if (issues.length > 0) {
    throw new NegotiationValidationError("Negotiation goal does not match selected quote", issues);
  }

  return goal;
}

export function buildNegotiatorGoalView(value: unknown): NegotiatorGoalView {
  const goal = parseNegotiationGoal(value);
  const revealTarget = goal.disclosurePolicy === "reveal_target_only";
  const revealRange = goal.disclosurePolicy === "reveal_range";

  return NegotiatorGoalViewSchema.parse({
    goalId: goal.id,
    workflowId: goal.workflowId,
    selectedQuoteId: goal.selectedQuoteId,
    targetProviderId: goal.targetProviderId,
    disclosedTargetAmountCents: revealTarget ? goal.targetAmountCents : null,
    disclosedRangeMinCents: revealRange ? goal.targetRangeMinCents : null,
    disclosedRangeMaxCents: revealRange ? goal.targetRangeMaxCents : null,
    billingFrequency: goal.billingFrequency,
    desiredNonPriceImprovements: [...goal.desiredNonPriceImprovements],
    allowedTradeoffs: [...goal.allowedTradeoffs],
    hardStopInstructions: goal.hardStops.length > 0 ? [SERVER_ENFORCED_HARD_STOP_INSTRUCTION] : [],
  });
}
