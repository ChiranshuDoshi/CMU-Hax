import type { ConfirmedQuoteRequest, CoverageItem } from "@/domain/schemas/person4";

export interface InsuranceLineConfig {
  line: string;
  displayName: string;
  researchQueryTemplates: readonly string[];
  requiredCoverageCodes: readonly string[];
  allowedTradeoffs: readonly string[];
  rankingWeights: {
    normalizedRating: number;
    reviewConfidence: number;
    sourceQuality: number;
    recency: number;
    coverageFit: number;
    contactability: number;
  };
  recommendationWeights: {
    cost: number;
    coverage: number;
    completeness: number;
    evidence: number;
    providerVerification: number;
    paymentFlexibility: number;
  };
  compareCoverage(request: ConfirmedQuoteRequest, coverage: readonly CoverageItem[]): string[];
}
