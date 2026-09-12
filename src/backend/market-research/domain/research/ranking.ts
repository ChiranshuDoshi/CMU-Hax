import { getInsuranceLineConfig } from "@/config/insurance-lines";
import {
  ProviderRankingResultSchema,
  RawResearchCandidateSchema,
  type ConfirmedQuoteRequest,
  type ProviderRankingResult,
  type ProviderResearchBrief,
  type RawResearchCandidate,
  type RawResearchResult,
} from "@/domain/schemas/person4";

import { getEligibilityReasons } from "./eligibility";
import { scoreCandidate, type CandidateScore } from "./scoring";

const TOP_PROVIDER_COUNT = 5;
export const INSUFFICIENT_ELIGIBLE_PROVIDERS_WARNING =
  "Blocking: fewer than five eligible providers were found; no providers or provider data were invented.";

interface EvaluatedCandidate {
  candidate: RawResearchCandidate;
  score: CandidateScore;
  exclusionReasons: string[];
}

export interface RankProvidersInput {
  quoteRequest: ConfirmedQuoteRequest;
  candidates: readonly RawResearchCandidate[];
  evaluatedAt: string;
  warnings?: readonly string[];
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareEvaluatedCandidates(left: EvaluatedCandidate, right: EvaluatedCandidate): number {
  if (left.score.weightedTotal !== right.score.weightedTotal) {
    return right.score.weightedTotal - left.score.weightedTotal;
  }
  if (left.score.normalizedRating !== right.score.normalizedRating) {
    return right.score.normalizedRating - left.score.normalizedRating;
  }

  const leftReviews = left.score.ratingEvidenceFound ? (left.candidate.reviewCount ?? 0) : 0;
  const rightReviews = right.score.ratingEvidenceFound ? (right.candidate.reviewCount ?? 0) : 0;
  if (leftReviews !== rightReviews) return rightReviews - leftReviews;

  return compareStrings(left.candidate.providerId, right.candidate.providerId);
}

function buildWarnings(evaluated: EvaluatedCandidate): string[] {
  const warnings: string[] = [];
  const candidate = evaluated.candidate;

  if (
    (candidate.rating !== null || candidate.reviewCount !== null) &&
    !evaluated.score.ratingEvidenceFound
  ) {
    warnings.push("Rating and review data were not scored because matching source evidence was unavailable.");
  }
  if (candidate.rating === null) warnings.push("No source-backed public rating was available.");
  if (candidate.reviewCount === null) warnings.push("No source-backed review count was available.");
  if (candidate.ratingObservedAt === null) warnings.push("Rating observation recency was unavailable.");
  if (candidate.licenseVerificationStatus === "unverified") {
    warnings.push("Provider licensing was not verified by the research adapter.");
  }
  if (candidate.licenseVerificationStatus === "conflicting") {
    warnings.push("Provider licensing evidence was conflicting.");
  }

  return warnings;
}

function toBrief(
  evaluated: EvaluatedCandidate,
  eligibilityStatus: "eligible" | "ineligible",
  rank: number | null,
): ProviderResearchBrief {
  const candidate = evaluated.candidate;
  const score = evaluated.score;
  const sourceCount = candidate.sources.length;
  const selectionExplanation =
    rank === null
      ? eligibilityStatus === "eligible"
        ? `Eligible alternate with a ${score.weightedTotal.toFixed(2)} weighted score supported by ${sourceCount} citation${sourceCount === 1 ? "" : "s"}.`
        : `Not selected because ${evaluated.exclusionReasons.join(" ")}`
      : `Ranked #${rank} with a ${score.weightedTotal.toFixed(2)} weighted score led by a ${score.normalizedRating.toFixed(2)} normalized rating and supported by ${sourceCount} citation${sourceCount === 1 ? "" : "s"}.`;

  return {
    ...candidate,
    sources: [...candidate.sources].sort(
      (left, right) => compareStrings(left.id, right.id) || compareStrings(left.url, right.url),
    ),
    normalizedRating: score.normalizedRating,
    ratingConfidence: score.reviewConfidence,
    eligibilityStatus,
    exclusionReasons: [...evaluated.exclusionReasons],
    topFiveRank: rank,
    scoreBreakdown: {
      normalizedRating: score.normalizedRating,
      reviewConfidence: score.reviewConfidence,
      sourceQuality: score.sourceQuality,
      recency: score.recency,
      coverageFit: score.coverageFit,
      contactability: score.contactability,
      weightedTotal: score.weightedTotal,
    },
    selectionExplanation,
    warnings: buildWarnings(evaluated),
  };
}

function canonicalCarrierKey(candidate: RawResearchCandidate): string {
  const canonicalId = candidate.canonicalCarrierId.trim().toLowerCase();
  return canonicalId || candidate.providerId.trim().toLowerCase();
}

function applyCarrierDedupe(
  eligible: EvaluatedCandidate[],
): { retained: EvaluatedCandidate[]; duplicates: EvaluatedCandidate[] } {
  const retainedByCarrier = new Map<string, EvaluatedCandidate>();
  const duplicates: EvaluatedCandidate[] = [];

  for (const evaluated of [...eligible].sort(compareEvaluatedCandidates)) {
    const carrierKey = canonicalCarrierKey(evaluated.candidate);
    const retained = retainedByCarrier.get(carrierKey);
    if (!retained) {
      retainedByCarrier.set(carrierKey, evaluated);
      continue;
    }

    duplicates.push({
      ...evaluated,
      exclusionReasons: [
        ...evaluated.exclusionReasons,
        `Duplicate carrier representation; retained ${retained.candidate.providerId}.`,
      ],
    });
  }

  return { retained: [...retainedByCarrier.values()], duplicates };
}

export function rankProviders(input: RankProvidersInput): ProviderRankingResult {
  const evaluatedAtTime = Date.parse(input.evaluatedAt);
  if (!Number.isFinite(evaluatedAtTime)) throw new Error("evaluatedAt must be a valid date-time.");

  const config = getInsuranceLineConfig(input.quoteRequest.insuranceLines[0]);
  const evaluated = input.candidates.map((candidateInput) => {
    const candidate = RawResearchCandidateSchema.parse(candidateInput);
    return {
      candidate,
      score: scoreCandidate(candidate, input.quoteRequest, config, input.evaluatedAt),
      exclusionReasons: getEligibilityReasons(candidate, input.quoteRequest),
    } satisfies EvaluatedCandidate;
  });
  const initiallyEligible = evaluated.filter((candidate) => candidate.exclusionReasons.length === 0);
  const initiallyIneligible = evaluated.filter((candidate) => candidate.exclusionReasons.length > 0);
  const { retained, duplicates } = applyCarrierDedupe(initiallyEligible);
  const rankedEligible = retained.sort(compareEvaluatedCandidates);
  const selectedEvaluated = rankedEligible.slice(0, TOP_PROVIDER_COUNT);
  const alternateEvaluated = rankedEligible.slice(TOP_PROVIDER_COUNT);
  const allIneligible = [...initiallyIneligible, ...duplicates].sort(compareEvaluatedCandidates);
  const warnings = [...new Set(input.warnings ?? [])];

  if (selectedEvaluated.length < TOP_PROVIDER_COUNT) {
    if (!warnings.includes(INSUFFICIENT_ELIGIBLE_PROVIDERS_WARNING)) {
      warnings.push(INSUFFICIENT_ELIGIBLE_PROVIDERS_WARNING);
    }
  }

  return ProviderRankingResultSchema.parse({
    workflowId: input.quoteRequest.workflowId,
    quoteRequestId: input.quoteRequest.id,
    specificationHash: input.quoteRequest.specificationHash,
    evaluatedAt: input.evaluatedAt,
    selected: selectedEvaluated.map((candidate, index) =>
      toBrief(candidate, "eligible", index + 1),
    ),
    eligibleAlternates: alternateEvaluated.map((candidate) =>
      toBrief(candidate, "eligible", null),
    ),
    ineligible: allIneligible.map((candidate) => toBrief(candidate, "ineligible", null)),
    warnings,
  });
}

export function rankResearchResult(
  quoteRequest: ConfirmedQuoteRequest,
  researchResult: RawResearchResult,
  evaluatedAt: string,
): ProviderRankingResult {
  return rankProviders({
    quoteRequest,
    candidates: researchResult.candidates,
    evaluatedAt,
    warnings: researchResult.warnings,
  });
}
