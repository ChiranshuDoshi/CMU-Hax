import { getInsuranceLineConfig, type InsuranceLineConfig } from "@/config/insurance-lines";
import type { EffectiveOfferSnapshot } from "@/domain/negotiation";
import {
  NormalizedQuoteSchema,
  RecommendationSchema,
  type NormalizedQuote,
  type Recommendation,
} from "@/domain/schemas/person4";

const QUALIFYING_EQUIVALENCE = new Set(["equivalent", "better_than_requested"]);
const COVERAGE_SCORES: Readonly<Record<string, number>> = {
  better_than_requested: 100,
  equivalent: 90,
};

export interface RecommendationInput {
  workflowId: string;
  specificationHash: string;
  quotes: readonly unknown[];
  effectiveOffers?: readonly EffectiveOfferSnapshot[];
  userSelectedNegotiationQuoteId?: string | null;
  generatedAt: Date;
  insuranceLine?: string;
  config?: InsuranceLineConfig;
}

interface QualifyingQuote {
  quote: NormalizedQuote;
  negotiationEventId: string | null;
  savingsCents: number;
  evidenceIds: string[];
}

interface ScoredQuote extends QualifyingQuote {
  scoreBreakdown: {
    cost: number;
    coverage: number;
    completeness: number;
    evidence: number;
    providerVerification: number;
    paymentFlexibility: number;
    weightedTotal: number;
  };
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function safeQuoteId(value: unknown, index: number): string {
  if (typeof value === "object" && value !== null && "quoteId" in value) {
    const quoteId = (value as { quoteId?: unknown }).quoteId;
    if (typeof quoteId === "string" && quoteId.length > 0) return quoteId;
  }
  return `invalid-quote-${index + 1}`;
}

function disqualificationReasons(quote: NormalizedQuote, input: RecommendationInput): string[] {
  const reasons: string[] = [];
  if (quote.workflowId !== input.workflowId) reasons.push("workflow_mismatch");
  if (quote.specificationHash !== input.specificationHash) reasons.push("specification_hash_mismatch");
  if (quote.status !== "complete") reasons.push("quote_not_complete");
  if (!QUALIFYING_EQUIVALENCE.has(quote.coverageEquivalence.status)) reasons.push("coverage_not_equivalent");
  if (quote.effectiveComparisonCostCents === null) reasons.push("effective_cost_missing");
  for (const flag of quote.redFlags.filter(({ severity }) => severity === "blocking")) {
    reasons.push(`blocking_flag:${flag.code}`);
  }
  return reasons;
}

function scoreQuote(quote: QualifyingQuote, minimumCost: number, config: InsuranceLineConfig): ScoredQuote {
  const cost = quote.quote.effectiveComparisonCostCents ?? 0;
  const costScore = cost === minimumCost ? 100 : minimumCost === 0 ? 0 : (minimumCost / cost) * 100;
  const scoreBreakdown = {
    cost: roundScore(costScore),
    coverage: COVERAGE_SCORES[quote.quote.coverageEquivalence.status] ?? 0,
    completeness: roundScore(quote.quote.completenessScore),
    evidence: roundScore(quote.quote.confidenceScore),
    providerVerification: quote.quote.requiresHumanVerification ? 0 : 100,
    paymentFlexibility: Math.min(100, quote.quote.paymentOptions.length * 25),
    weightedTotal: 0,
  };
  const weights = config.recommendationWeights;
  scoreBreakdown.weightedTotal = roundScore(
    scoreBreakdown.cost * weights.cost +
      scoreBreakdown.coverage * weights.coverage +
      scoreBreakdown.completeness * weights.completeness +
      scoreBreakdown.evidence * weights.evidence +
      scoreBreakdown.providerVerification * weights.providerVerification +
      scoreBreakdown.paymentFlexibility * weights.paymentFlexibility,
  );
  return { ...quote, scoreBreakdown };
}

function byLowestCostThenId(left: ScoredQuote, right: ScoredQuote): number {
  return (
    (left.quote.effectiveComparisonCostCents ?? Number.POSITIVE_INFINITY) -
      (right.quote.effectiveComparisonCostCents ?? Number.POSITIVE_INFINITY) ||
    left.quote.quoteId.localeCompare(right.quote.quoteId)
  );
}

export function buildRecommendation(input: RecommendationInput): Recommendation {
  if (!Number.isFinite(input.generatedAt.getTime())) throw new TypeError("generatedAt must be a valid date");
  const config = input.config ?? getInsuranceLineConfig(input.insuranceLine ?? "other");
  const effectiveOfferByQuoteId = new Map((input.effectiveOffers ?? []).map((offer) => [offer.quoteId, offer]));
  const qualifying: QualifyingQuote[] = [];
  const disqualifiedQuotes: { quoteId: string; reasons: string[] }[] = [];

  input.quotes.forEach((value, index) => {
    const parsed = NormalizedQuoteSchema.safeParse(value);
    if (!parsed.success) {
      disqualifiedQuotes.push({ quoteId: safeQuoteId(value, index), reasons: ["invalid_normalized_quote"] });
      return;
    }

    const effectiveOffer = effectiveOfferByQuoteId.get(parsed.data.quoteId);
    const quote = effectiveOffer ? NormalizedQuoteSchema.parse(effectiveOffer.effectiveQuote) : parsed.data;
    const reasons = disqualificationReasons(quote, input);
    if (reasons.length > 0) {
      disqualifiedQuotes.push({ quoteId: quote.quoteId, reasons });
      return;
    }

    qualifying.push({
      quote,
      negotiationEventId: effectiveOffer?.negotiationEventId ?? null,
      savingsCents: effectiveOffer?.savingsCents ?? 0,
      evidenceIds: [...new Set([...quote.evidenceIds, ...(effectiveOffer?.evidenceIds ?? [])])],
    });
  });

  const minimumCost = Math.min(...qualifying.map(({ quote }) => quote.effectiveComparisonCostCents ?? Number.POSITIVE_INFINITY));
  const ranked = qualifying.map((quote) => scoreQuote(quote, minimumCost, config)).sort(byLowestCostThenId);
  const recommended = ranked[0] ?? null;
  const lowestPrice = [...ranked].sort(
    (left, right) =>
      (left.quote.effectiveComparisonCostCents ?? Number.POSITIVE_INFINITY) -
        (right.quote.effectiveComparisonCostCents ?? Number.POSITIVE_INFINITY) ||
      left.quote.quoteId.localeCompare(right.quote.quoteId),
  )[0];
  const bestCoverage = [...ranked].sort(
    (left, right) =>
      right.scoreBreakdown.coverage - left.scoreBreakdown.coverage ||
      byLowestCostThenId(left, right),
  )[0];
  const selectedId = input.userSelectedNegotiationQuoteId ?? null;
  const selectedOffer = selectedId === null ? undefined : effectiveOfferByQuoteId.get(selectedId);
  const evidenceIds = [...new Set(ranked.flatMap((item) => item.evidenceIds))];
  const warnings = ranked.length === 0 ? ["No qualifying quote is available for recommendation"] : [];

  return RecommendationSchema.parse({
    workflowId: input.workflowId,
    specificationHash: input.specificationHash,
    generatedAt: input.generatedAt.toISOString(),
    rankedQualifyingQuotes: ranked.map((item, index) => ({
      rank: index + 1,
      quoteId: item.quote.quoteId,
      providerId: item.quote.providerId,
      negotiationEventId: item.negotiationEventId,
      effectiveCostCents: item.quote.effectiveComparisonCostCents,
      scoreBreakdown: item.scoreBreakdown,
      evidenceIds: item.evidenceIds,
      explanation: `Selected by lowest valid all-in policy-term cost; diagnostic score ${item.scoreBreakdown.weightedTotal}.`,
    })),
    disqualifiedQuotes,
    recommendedQuoteId: recommended?.quote.quoteId ?? null,
    lowestPriceEquivalentQuoteId: lowestPrice?.quote.quoteId ?? null,
    bestCoverageQuoteId: bestCoverage?.quote.quoteId ?? null,
    bestValueAlternativeQuoteId: ranked.find((item) => item.quote.quoteId !== recommended?.quote.quoteId)?.quote.quoteId ?? null,
    userSelectedNegotiationQuoteId: selectedId,
    selectionDiffersFromRecommendation:
      selectedId !== null && recommended !== null && selectedId !== recommended.quote.quoteId,
    savingsFromNegotiationCents: selectedOffer?.savingsCents ?? 0,
    warnings,
    evidenceIds,
    requiresHumanFollowUp: recommended?.quote.requiresHumanVerification ?? true,
  });
}
