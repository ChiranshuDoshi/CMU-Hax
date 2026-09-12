import { evaluateCoverageEquivalence } from "@/domain/equivalence";
import { evaluateRedFlags } from "@/domain/red-flags";
import {
  ConfirmedQuoteRequestSchema,
  NormalizedQuoteSchema,
  RawQuoteOutcomeSchema,
  type ConfirmedQuoteRequest,
  type NormalizedQuote,
  type RawQuoteOutcome,
} from "@/domain/schemas/person4";

import { calculateQuoteCost } from "./money";

const MATERIAL_EVIDENCE_TYPES = new Set(["provider_document", "transcript", "audio", "user_confirmation", "demo_fixture"]);

function roundPercent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator * 100) / denominator);
}

function hasFeeDisclosure(quote: RawQuoteOutcome): boolean {
  if (quote.feeComponents.length > 0 || quote.taxComponents.length > 0) return true;
  return quote.evidence.some(
    (evidence) =>
      /fee|tax/i.test(evidence.claimKey) &&
      evidence.type !== "web_source" &&
      ["user_confirmed", "provider_confirmed", "not_applicable"].includes(evidence.verificationStatus),
  );
}

function hasProviderEvidence(evidenceItems: RawQuoteOutcome["evidence"]): boolean {
  return evidenceItems.some(
    (evidence) =>
      evidence.type !== "web_source" &&
      (evidence.type === "provider_document" || evidence.verificationStatus === "provider_confirmed"),
  );
}

function calculateCompleteness(quote: RawQuoteOutcome, request: ConfirmedQuoteRequest, hasComparisonCost: boolean): number {
  const requiredCoverage = request.requestedCoverage.filter((coverage) => coverage.required);
  const coveredCodes = new Set(quote.coverageItems.filter((coverage) => coverage.included).map((coverage) => coverage.coverageCode));
  const checks = [
    quote.status === "complete",
    quote.effectiveDate !== null,
    quote.expirationDate !== null,
    quote.policyTermMonths !== null,
    request.insuredEntityIds.every((entityId) => quote.coveredEntityIds.includes(entityId)),
    quote.premiumComponents.some((component) => component.required && !component.includedInQuotedTotal),
    hasComparisonCost,
    hasFeeDisclosure(quote),
    requiredCoverage.every((coverage) => coveredCodes.has(coverage.coverageCode)),
    requiredCoverage.every((required) => {
      const offered = quote.coverageItems.filter(
        (coverage) => coverage.coverageCode === required.coverageCode && coverage.included,
      );
      return offered.length > 0 && offered.some((coverage) => coverage.evidenceIds.length > 0);
    }),
  ];

  return roundPercent(checks.filter(Boolean).length, checks.length);
}

function evidenceWeight(evidence: RawQuoteOutcome["evidence"][number]): number {
  if (!MATERIAL_EVIDENCE_TYPES.has(evidence.type) || evidence.type === "web_source") return 0;
  if (evidence.verificationStatus === "conflicting") return 0;

  const verificationWeight =
    evidence.verificationStatus === "provider_confirmed"
      ? 1
      : evidence.verificationStatus === "user_confirmed"
        ? 0.8
        : evidence.verificationStatus === "not_applicable"
          ? 0.7
          : 0.4;
  const sourceWeight = evidence.type === "provider_document" ? 1 : evidence.type === "demo_fixture" ? 0.9 : 0.8;
  return evidence.confidence * verificationWeight * sourceWeight;
}

function collectEvidenceIds(quote: RawQuoteOutcome): string[] {
  return [
    ...new Set([
      ...quote.evidence.map((evidence) => evidence.id),
      ...quote.premiumComponents.map((component) => component.evidenceId),
      ...quote.feeComponents.map((component) => component.evidenceId),
      ...quote.taxComponents.map((component) => component.evidenceId),
      ...quote.discounts.map((discount) => discount.evidenceId),
      ...quote.coverageItems.flatMap((coverage) => coverage.evidenceIds),
    ]),
  ];
}

function calculateConfidence(quote: RawQuoteOutcome, evidenceIds: readonly string[]): number {
  if (evidenceIds.length === 0) return 0;
  const byId = new Map(quote.evidence.map((evidence) => [evidence.id, evidence]));
  const evidenceScore = evidenceIds.reduce((total, id) => {
    const evidence = byId.get(id);
    return total + (evidence ? evidenceWeight(evidence) : 0);
  }, 0);
  const providerEvidence = hasProviderEvidence(quote.evidence);
  const score = roundPercent(evidenceScore, evidenceIds.length);

  // A quote without provider-originated support must never appear high-confidence.
  return providerEvidence ? score : Math.min(score, 60);
}

/** Validates and deterministically normalizes a Person 3 quote outcome. */
export function normalizeQuote(rawQuote: RawQuoteOutcome, confirmedRequest: ConfirmedQuoteRequest): NormalizedQuote;
export function normalizeQuote(rawQuote: unknown, confirmedRequest: unknown): NormalizedQuote;
export function normalizeQuote(rawQuote: unknown, confirmedRequest: unknown): NormalizedQuote {
  const quote = RawQuoteOutcomeSchema.parse(rawQuote);
  const request = ConfirmedQuoteRequestSchema.parse(confirmedRequest);
  const cost = calculateQuoteCost(quote);
  const coverageEquivalence = evaluateCoverageEquivalence(quote, request);
  const evidenceIds = collectEvidenceIds(quote);
  const completenessScore = calculateCompleteness(quote, request, cost.effectiveComparisonCostCents !== null);
  const confidenceScore = calculateConfidence(quote, evidenceIds);
  const redFlags = evaluateRedFlags(quote, request, {
    coverageEquivalence,
    effectiveComparisonCostCents: cost.effectiveComparisonCostCents,
    ignoredPercentageDiscounts: cost.ignoredPercentageDiscounts,
    hasUnverifiedCostEvidence: cost.unverifiedCostEvidenceIds.length > 0,
  });
  const { evidence, ...quoteWithoutEvidence } = quote;
  const providerEvidence = hasProviderEvidence(evidence);

  return NormalizedQuoteSchema.parse({
    ...quoteWithoutEvidence,
    quoteType: "simulated",
    effectiveComparisonCostCents: cost.effectiveComparisonCostCents,
    annualizedCostCents: cost.annualizedCostCents,
    completenessScore,
    confidenceScore,
    coverageEquivalence,
    redFlags,
    requiresHumanVerification:
      quote.simulated ||
      !providerEvidence ||
      cost.effectiveComparisonCostCents === null ||
      confidenceScore < 80 ||
      coverageEquivalence.status !== "equivalent" ||
      redFlags.some((flag) => flag.severity === "blocking"),
    evidenceIds,
  });
}

export class QuoteNormalizer {
  normalize(rawQuote: unknown, confirmedRequest: unknown): NormalizedQuote {
    return normalizeQuote(rawQuote, confirmedRequest);
  }
}
