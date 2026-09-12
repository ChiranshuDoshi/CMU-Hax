import type { InsuranceLineConfig } from "@/config/insurance-lines";
import type {
  ConfirmedQuoteRequest,
  RawResearchCandidate,
} from "@/domain/schemas/person4";

type ResearchSource = RawResearchCandidate["sources"][number];

const PERCENT_SCALE = 100;
const MAX_REVIEW_LOG = 4;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

const SOURCE_KIND_QUALITY: Readonly<Record<ResearchSource["sourceKind"], number>> = {
  regulator: 100,
  recognized_consumer: 100,
  business_listing: 85,
  provider: 70,
  secondary: 50,
  search_snippet: 0,
};

function clampPercent(value: number): number {
  return Math.min(PERCENT_SCALE, Math.max(0, value));
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function normalizeRating(rating: number | null, scaleMaximum: number | null): number {
  if (rating === null || scaleMaximum === null || scaleMaximum <= 0) return 0;
  return roundScore(clampPercent((rating / scaleMaximum) * PERCENT_SCALE));
}

export function calculateReviewConfidence(reviewCount: number | null): number {
  if (reviewCount === null || reviewCount <= 0) return 0;
  return roundScore(
    Math.min(1, Math.log10(reviewCount + 1) / MAX_REVIEW_LOG) * PERCENT_SCALE,
  );
}

export function calculateSourceQuality(source: ResearchSource | undefined): number {
  if (!source) return 0;
  return SOURCE_KIND_QUALITY[source.sourceKind];
}

export function calculateRecency(observedAt: string | null, evaluatedAt: string): number {
  if (observedAt === null) return 20;

  const observedTime = Date.parse(observedAt);
  const evaluatedTime = Date.parse(evaluatedAt);
  if (!Number.isFinite(observedTime) || !Number.isFinite(evaluatedTime)) return 20;

  const ageInDays = Math.max(0, evaluatedTime - observedTime) / MILLISECONDS_PER_DAY;
  if (ageInDays <= 180) return 100;
  if (ageInDays <= 365) return 80;
  if (ageInDays <= 730) return 50;
  return 20;
}

export function calculateCoverageFit(
  candidate: RawResearchCandidate,
  request: ConfirmedQuoteRequest,
): number {
  const requestedCodes = new Set(
    request.requestedCoverage.map((coverage) => coverage.coverageCode),
  );
  if (requestedCodes.size === 0) return PERCENT_SCALE;

  const supportedCodes = new Set(candidate.preliminaryCoverageCodes);
  let supportedCount = 0;
  for (const code of requestedCodes) {
    if (supportedCodes.has(code)) supportedCount += 1;
  }

  return roundScore((supportedCount / requestedCodes.size) * PERCENT_SCALE);
}

export function calculateContactability(candidate: RawResearchCandidate): number {
  const directContactScore = candidate.publicContact?.trim() ? 50 : 0;
  const websiteScore = candidate.website ? 25 : 0;
  const officialSourceConfidence = candidate.sources
    .filter((source) => source.officialSource)
    .reduce((maximum, source) => Math.max(maximum, source.confidence), 0);

  return roundScore(
    clampPercent(directContactScore + websiteScore + officialSourceConfidence * 25),
  );
}

export interface CandidateScore {
  normalizedRating: number;
  reviewConfidence: number;
  sourceQuality: number;
  recency: number;
  coverageFit: number;
  contactability: number;
  weightedTotal: number;
  ratingEvidenceFound: boolean;
}

export function scoreCandidate(
  candidate: RawResearchCandidate,
  request: ConfirmedQuoteRequest,
  config: InsuranceLineConfig,
  evaluatedAt: string,
): CandidateScore {
  const ratingSource = candidate.ratingSourceId
    ? candidate.sources.find((source) => source.id === candidate.ratingSourceId)
    : undefined;
  const ratingEvidenceFound = ratingSource !== undefined;
  const normalizedRating = ratingEvidenceFound
    ? normalizeRating(candidate.rating, candidate.ratingScaleMaximum)
    : 0;
  const reviewConfidence = ratingEvidenceFound
    ? calculateReviewConfidence(candidate.reviewCount)
    : 0;
  const sourceQuality = calculateSourceQuality(ratingSource);
  const recency = ratingEvidenceFound
    ? calculateRecency(candidate.ratingObservedAt, evaluatedAt)
    : 0;
  const coverageFit = calculateCoverageFit(candidate, request);
  const contactability = calculateContactability(candidate);
  const weights = config.rankingWeights;
  const weightedTotal = roundScore(
    normalizedRating * weights.normalizedRating +
      reviewConfidence * weights.reviewConfidence +
      sourceQuality * weights.sourceQuality +
      recency * weights.recency +
      coverageFit * weights.coverageFit +
      contactability * weights.contactability,
  );

  return {
    normalizedRating,
    reviewConfidence,
    sourceQuality,
    recency,
    coverageFit,
    contactability,
    weightedTotal,
    ratingEvidenceFound,
  };
}
