import {
  ConfirmedQuoteRequestSchema,
  EvidenceSchema,
  NegotiationEventSchema,
  NormalizedQuoteSchema,
  type ConfirmedQuoteRequest,
  type CoverageItem,
  type Evidence,
  type NegotiationEvent,
  type NormalizedQuote,
  type RawQuoteOutcome,
} from "@/domain/schemas/person4";
import { normalizeQuote } from "@/domain/normalization";

import { parseNegotiationGoal } from "./goal";
import { NegotiationValidationError } from "./validation-error";

export interface NegotiationEventValidationInput {
  event: unknown;
  goal: unknown;
  originalQuote: unknown;
  confirmedRequest: unknown;
  competingQuote?: unknown;
  evidence: readonly unknown[];
}

export interface ValidatedNegotiationEvent {
  event: NegotiationEvent;
  originalQuote: NormalizedQuote;
  confirmedRequest: ConfirmedQuoteRequest;
  competingQuote: NormalizedQuote | null;
  savingsCents: number;
  evidence: readonly Evidence[];
  effectiveQuote: NormalizedQuote;
}

export interface EffectiveOfferSnapshot {
  readonly quoteId: string;
  readonly originalQuoteId: string;
  readonly negotiationEventId: string;
  readonly originalCostCents: number;
  readonly finalCostCents: number;
  readonly savingsCents: number;
  readonly effectiveQuote: NormalizedQuote;
  readonly evidenceIds: readonly string[];
}

function formatSchemaIssues(error: { issues: readonly { path: PropertyKey[]; message: string }[] }): string[] {
  return error.issues.map(({ path, message }) => `${path.join(".") || "value"}: ${message}`);
}

function coverageKey(item: CoverageItem): string {
  return `${item.coverageCode}\u0000${[...item.insuredEntityIds].sort().join("\u0000")}`;
}

function mergeByKey<T>(original: readonly T[], changes: readonly T[], keyFor: (item: T) => string): T[] {
  const changedByKey = new Map(changes.map((item) => [keyFor(item), item]));
  const merged = original.map((item) => changedByKey.get(keyFor(item)) ?? item);
  const originalKeys = new Set(original.map(keyFor));
  merged.push(...changes.filter((item) => !originalKeys.has(keyFor(item))));
  return merged;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nestedValue of Object.values(value as Record<string, unknown>)) deepFreeze(nestedValue);
    Object.freeze(value);
  }
  return value;
}

const FINAL_COST_CLAIM_PATTERN = /cost|premium|price|offer|total/i;

function claimAmountCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value !== "object" || value === null || !("amountCents" in value)) return null;
  const amountCents = (value as { amountCents?: unknown }).amountCents;
  return typeof amountCents === "number" && Number.isSafeInteger(amountCents) ? amountCents : null;
}

function buildFinalRawQuote(
  originalQuote: NormalizedQuote,
  event: NegotiationEvent,
  evidence: readonly Evidence[],
): RawQuoteOutcome {
  return {
    quoteId: originalQuote.quoteId,
    workflowId: originalQuote.workflowId,
    providerId: originalQuote.providerId,
    sourceConversationId: originalQuote.sourceConversationId,
    confirmedRequestId: originalQuote.confirmedRequestId,
    specificationHash: originalQuote.specificationHash,
    status: originalQuote.status,
    quoteType: originalQuote.quoteType,
    effectiveDate: originalQuote.effectiveDate,
    expirationDate: originalQuote.expirationDate,
    policyTermMonths: originalQuote.policyTermMonths,
    premiumComponents: [...originalQuote.premiumComponents],
    feeComponents: mergeByKey(
      originalQuote.feeComponents,
      event.changedFees,
      (item) => `${item.category}\u0000${item.label}\u0000${item.frequency}`,
    ),
    taxComponents: [...originalQuote.taxComponents],
    discounts: mergeByKey(originalQuote.discounts, event.changedDiscounts, (item) => item.name),
    coverageItems: mergeByKey(originalQuote.coverageItems, event.changedCoverage, coverageKey),
    coveredEntityIds: [...originalQuote.coveredEntityIds],
    downPaymentCents: originalQuote.downPaymentCents,
    paymentOptions: [...originalQuote.paymentOptions],
    exclusions: [...originalQuote.exclusions],
    conditions: [...originalQuote.conditions],
    evidence: [...evidence],
    simulated: originalQuote.simulated,
  };
}

export function validateNegotiationEvent(input: NegotiationEventValidationInput): ValidatedNegotiationEvent {
  const goal = parseNegotiationGoal(input.goal);
  const eventResult = NegotiationEventSchema.safeParse(input.event);
  const originalResult = NormalizedQuoteSchema.safeParse(input.originalQuote);
  const requestResult = ConfirmedQuoteRequestSchema.safeParse(input.confirmedRequest);
  const competingResult = input.competingQuote === undefined ? null : NormalizedQuoteSchema.safeParse(input.competingQuote);
  const schemaErrors: string[] = [];

  if (!eventResult.success) schemaErrors.push(...formatSchemaIssues(eventResult.error));
  if (!originalResult.success) schemaErrors.push(...formatSchemaIssues(originalResult.error));
  if (!requestResult.success) schemaErrors.push(...formatSchemaIssues(requestResult.error));
  if (competingResult !== null && !competingResult.success) schemaErrors.push(...formatSchemaIssues(competingResult.error));
  if (
    !eventResult.success ||
    !originalResult.success ||
    !requestResult.success ||
    (competingResult !== null && !competingResult.success)
  ) {
    throw new NegotiationValidationError("Invalid negotiation event input", schemaErrors);
  }

  const event = eventResult.data;
  const originalQuote = originalResult.data;
  const confirmedRequest = requestResult.data;
  const competingQuote = competingResult?.data ?? null;
  const issues: string[] = [];

  if (goal.workflowId !== originalQuote.workflowId || event.workflowId !== goal.workflowId) {
    issues.push("Event, goal, and original quote workflows must match");
  }
  if (goal.id !== event.negotiationGoalId) issues.push("Event does not reference the confirmed negotiation goal");
  if (goal.selectedQuoteId !== originalQuote.quoteId || event.originalQuoteId !== originalQuote.quoteId) {
    issues.push("Event original quote does not match the goal's selected quote");
  }
  if (goal.targetProviderId !== originalQuote.providerId || event.targetProviderId !== originalQuote.providerId) {
    issues.push("Event target provider does not match the selected quote provider");
  }
  if (event.specificationHash !== originalQuote.specificationHash) {
    issues.push("Event specification hash does not match the original quote");
  }
  if (confirmedRequest.workflowId !== originalQuote.workflowId) {
    issues.push("Confirmed request workflow does not match the original quote");
  }
  if (confirmedRequest.id !== originalQuote.confirmedRequestId) {
    issues.push("Confirmed request ID does not match the original quote");
  }
  if (confirmedRequest.specificationHash !== originalQuote.specificationHash) {
    issues.push("Confirmed request specification hash does not match the original quote");
  }
  if (originalQuote.effectiveComparisonCostCents === null) {
    issues.push("Original quote has no effective comparison cost");
  } else if (event.originalCostCents !== originalQuote.effectiveComparisonCostCents) {
    issues.push("Event original cost does not match the normalized original quote");
  }
  if (event.verificationStatus !== "provider_confirmed") {
    issues.push("Negotiation event is not provider-confirmed");
  }
  if (event.finalCostCents <= 0) issues.push("Negotiated final cost must be greater than zero");

  if (event.competingQuoteId !== goal.verifiedCompetingQuoteId) {
    issues.push("Event competing quote does not match the goal's verified competing quote");
  }
  if (goal.verifiedCompetingQuoteId === null && competingQuote !== null) {
    issues.push("A competing quote was supplied when the goal has no verified leverage");
  }
  if (goal.verifiedCompetingQuoteId !== null && competingQuote === null) {
    issues.push("The goal's verified competing quote was not supplied");
  }
  if (competingQuote !== null) {
    if (competingQuote.quoteId !== goal.verifiedCompetingQuoteId) issues.push("Competing quote ID does not match the goal");
    if (competingQuote.quoteId === originalQuote.quoteId) issues.push("Original quote cannot be competing leverage");
    if (competingQuote.workflowId !== originalQuote.workflowId) issues.push("Competing quote workflow does not match");
    if (competingQuote.confirmedRequestId !== originalQuote.confirmedRequestId) {
      issues.push("Competing quote confirmed request does not match");
    }
    if (competingQuote.specificationHash !== originalQuote.specificationHash) {
      issues.push("Competing quote specification hash does not match");
    }
    if (!new Set(["equivalent", "better_than_requested"]).has(competingQuote.coverageEquivalence.status)) {
      issues.push("Competing quote coverage is not equivalent or better");
    }
  }
  if (event.verifiedLeverageStatement !== null && event.competingQuoteId === null) {
    issues.push("A leverage statement requires a verified competing quote");
  }

  const evidenceById = new Map<string, Evidence>();
  for (const value of input.evidence) {
    const parsed = EvidenceSchema.safeParse(value);
    if (parsed.success) evidenceById.set(parsed.data.id, parsed.data);
  }
  const nestedEvidenceIds = [
    ...event.changedCoverage.flatMap(({ evidenceIds }) => evidenceIds),
    ...event.changedFees.map(({ evidenceId }) => evidenceId),
    ...event.changedDiscounts.map(({ evidenceId }) => evidenceId),
  ];
  for (const id of nestedEvidenceIds) {
    if (!event.evidenceIds.includes(id)) issues.push(`Changed-term evidence ${id} is missing from event evidence IDs`);
  }

  const eventEvidence = event.evidenceIds.map((id) => evidenceById.get(id));
  if (eventEvidence.some((record) => record === undefined)) issues.push("Negotiation event references missing evidence");
  if (eventEvidence.some((record) => record !== undefined && record.workflowId !== event.workflowId)) {
    issues.push("Negotiation evidence belongs to another workflow");
  }
  if (eventEvidence.some((record) => record !== undefined && record.verificationStatus !== "provider_confirmed")) {
    issues.push("Negotiation evidence is not provider-confirmed");
  }
  const hasConfirmedFinalCostEvidence = eventEvidence.some(
    (record) =>
      record !== undefined &&
      record.sourceId === event.negotiationConversationId &&
      record.verificationStatus === "provider_confirmed" &&
      FINAL_COST_CLAIM_PATTERN.test(record.claimKey) &&
      claimAmountCents(record.claimValue) === event.finalCostCents,
  );
  if (!hasConfirmedFinalCostEvidence) {
    issues.push("Negotiation evidence does not provider-confirm the final cost");
  }

  if (issues.length > 0) throw new NegotiationValidationError("Negotiation event failed verification", issues);

  const verifiedEventEvidence = eventEvidence.filter((record): record is Evidence => record !== undefined);
  const finalEvidenceIds = new Set([...originalQuote.evidenceIds, ...event.evidenceIds]);
  const effectiveEvidence = [...finalEvidenceIds]
    .map((id) => evidenceById.get(id))
    .filter((record): record is Evidence => record !== undefined && record.workflowId === originalQuote.workflowId);
  const effectiveQuote = normalizeQuote(buildFinalRawQuote(originalQuote, event, effectiveEvidence), confirmedRequest);
  if (effectiveQuote.effectiveComparisonCostCents !== event.finalCostCents) {
    throw new NegotiationValidationError("Negotiation event failed verification", [
      "Negotiated final cost does not match the recomputed final offer components",
    ]);
  }

  return {
    event,
    originalQuote,
    confirmedRequest,
    competingQuote,
    savingsCents: Math.max(0, event.originalCostCents - event.finalCostCents),
    evidence: verifiedEventEvidence,
    effectiveQuote,
  };
}

export function deriveEffectiveOffer(validated: ValidatedNegotiationEvent): EffectiveOfferSnapshot {
  const { event, originalQuote, savingsCents } = validated;
  const effectiveQuote = NormalizedQuoteSchema.parse(validated.effectiveQuote);

  return deepFreeze({
    quoteId: originalQuote.quoteId,
    originalQuoteId: originalQuote.quoteId,
    negotiationEventId: event.id,
    originalCostCents: event.originalCostCents,
    finalCostCents: event.finalCostCents,
    savingsCents,
    effectiveQuote,
    evidenceIds: [...effectiveQuote.evidenceIds],
  });
}
