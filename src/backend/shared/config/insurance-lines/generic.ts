import type { InsuranceLineConfig } from "./types";

export const genericConfig: InsuranceLineConfig = {
  line: "other",
  displayName: "Generic insurance",
  researchQueryTemplates: ["{insuranceLine} insurance providers serving {zipCode} {state}"],
  requiredCoverageCodes: [],
  allowedTradeoffs: ["payment_schedule"],
  rankingWeights: {
    normalizedRating: 0.55,
    reviewConfidence: 0.15,
    sourceQuality: 0.1,
    recency: 0.05,
    coverageFit: 0.1,
    contactability: 0.05,
  },
  recommendationWeights: {
    cost: 0.45,
    coverage: 0.25,
    completeness: 0.1,
    evidence: 0.1,
    providerVerification: 0.05,
    paymentFlexibility: 0.05,
  },
  compareCoverage(request, coverage) {
    const offered = new Set(coverage.filter((item) => item.included).map((item) => item.coverageCode));
    return request.requestedCoverage
      .filter((item) => item.required && !offered.has(item.coverageCode))
      .map((item) => `Missing required coverage: ${item.coverageCode}`);
  },
};
