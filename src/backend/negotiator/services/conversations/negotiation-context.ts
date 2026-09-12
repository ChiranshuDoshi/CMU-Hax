import { z } from "zod";

import { NegotiationHandoffSchema, NegotiationGoalSchema } from "@/domain/schemas/person4";

import type { NegotiationSessionInput, SafeNegotiationContext } from "./types";

export class ConversationInvariantError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ConversationInvariantError";
  }
}

const UserDisplayNameSchema = z.string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => !/\p{Cc}/u.test(value));

export const NegotiationParticipantSchema = z.strictObject({
  displayName: UserDisplayNameSchema,
});

export function buildSafeNegotiationContext(input: NegotiationSessionInput): SafeNegotiationContext {
  const handoff = NegotiationHandoffSchema.parse(input.handoff);
  const goal = NegotiationGoalSchema.parse(input.goal);
  const selection = input.explicitSelection;

  if (!selection) {
    throw new ConversationInvariantError(
      "EXPLICIT_SELECTION_REQUIRED",
      "The user must explicitly select a quote before negotiation",
    );
  }
  if (!Number.isFinite(Date.parse(selection.selectedAt))) {
    throw new ConversationInvariantError("INVALID_SELECTION", "The explicit quote selection timestamp is invalid");
  }
  if (selection.quoteId !== handoff.target.quoteId || selection.quoteId !== goal.selectedQuoteId) {
    throw new ConversationInvariantError("QUOTE_MISMATCH", "The selected quote does not match the negotiation target");
  }
  if (selection.providerId !== handoff.target.providerId || selection.providerId !== goal.targetProviderId) {
    throw new ConversationInvariantError(
      "PROVIDER_MISMATCH",
      "The selected provider does not match the negotiation target",
    );
  }
  if (selection.specificationHash !== handoff.specificationHash) {
    throw new ConversationInvariantError(
      "SPECIFICATION_MISMATCH",
      "The selected quote specification does not match the negotiation handoff",
    );
  }
  if (goal.workflowId !== handoff.workflowId) {
    throw new ConversationInvariantError("WORKFLOW_MISMATCH", "The negotiation goal belongs to another workflow");
  }
  const participant = NegotiationParticipantSchema.safeParse(input.participant);
  if (!participant.success) {
    throw new ConversationInvariantError("INVALID_PARTICIPANT", "The negotiation participant is invalid");
  }

  const competingQuote = handoff.verifiedCompetingQuote;
  if (competingQuote === null && goal.verifiedCompetingQuoteId !== null) {
    throw new ConversationInvariantError(
      "LEVERAGE_MISMATCH",
      "The negotiation goal references leverage that is absent from the handoff",
    );
  }
  if (competingQuote !== null && competingQuote.quoteId !== goal.verifiedCompetingQuoteId) {
    throw new ConversationInvariantError(
      "LEVERAGE_MISMATCH",
      "The negotiation goal and handoff reference different competing quotes",
    );
  }
  if (competingQuote?.quoteId === selection.quoteId) {
    throw new ConversationInvariantError(
      "INVALID_LEVERAGE",
      "The selected quote cannot also be used as competing leverage",
    );
  }

  const currentMonthlyEffectiveCostCents = handoff.target.annualizedCostCents === null
    ? null
    : Math.round(handoff.target.annualizedCostCents / 12);
  const allowedLeverageText = competingQuote === null
    ? "No verified comparable quote is available; do not cite competitor pricing."
    : `A verified comparable quote from ${competingQuote.providerName} has a normalized comparison cost of ${competingQuote.effectiveComparisonCostCents} cents.`;
  const coverageDifferences = handoff.target.coverageEquivalence.differences;
  const coverageSummary = coverageDifferences.length === 0
    ? `Coverage comparison status: ${handoff.target.coverageEquivalence.status}; preserve every selected coverage term.`
    : `Coverage comparison status: ${handoff.target.coverageEquivalence.status}. ${coverageDifferences.join(" ")}`;

  return Object.freeze({
    userDisplayName: participant.data.displayName,
    workflowId: handoff.workflowId,
    specificationHash: handoff.specificationHash,
    negotiationGoalId: goal.id,
    selectedQuoteId: selection.quoteId,
    targetProviderId: selection.providerId,
    selectedProviderName: handoff.target.providerName,
    currentMonthlyEffectiveCostCents,
    currentPolicyPeriodEffectiveCostCents: handoff.target.effectiveComparisonCostCents,
    // The handoff does not carry the competing quote's term, so it cannot safely be normalized to monthly.
    lowestVerifiedComparableMonthlyEffectiveCostCents: null,
    allowedLeverageText,
    coverageSummary,
    aiDisclosure:
      "I am an AI voice agent conducting a simulated demo using a voice-collected quote that was not supplied by the insurer. The result is non-binding and requires human verification.",
    disclaimer: handoff.target.disclaimer,
    simulated: true,
    requiresHumanVerification: true,
  });
}
