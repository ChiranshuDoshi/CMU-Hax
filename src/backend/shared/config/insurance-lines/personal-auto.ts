import type { InsuranceLineConfig } from "./types";

export const personalAutoConfig: InsuranceLineConfig = {
  line: "auto",
  displayName: "Personal auto",
  researchQueryTemplates: [
    "personal auto insurance providers serving {zipCode} {state}",
    "auto insurer ratings reviews {state}",
  ],
  requiredCoverageCodes: [
    "bodily_injury_liability",
    "property_damage_liability",
    "uninsured_underinsured_motorist",
    "collision",
    "comprehensive",
  ],
  allowedTradeoffs: ["payment_schedule", "autopay", "paid_in_full", "approved_bundle", "telematics_if_approved"],
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
    const differences: string[] = [];
    const byCode = new Map(coverage.map((item) => [item.coverageCode, item]));

    for (const required of request.requestedCoverage.filter((item) => item.required)) {
      const offered = byCode.get(required.coverageCode);
      if (!offered?.included) {
        differences.push(`Missing required coverage: ${required.coverageCode}`);
        continue;
      }
      if (required.minimumLimitCents !== null && (offered.limitCents === null || offered.limitCents < required.minimumLimitCents)) {
        differences.push(`Coverage limit below minimum: ${required.coverageCode}`);
      }
      if (
        required.maximumDeductibleCents !== null &&
        (offered.deductibleCents === null || offered.deductibleCents > required.maximumDeductibleCents)
      ) {
        differences.push(`Deductible above maximum: ${required.coverageCode}`);
      }
      const missingEntities = required.insuredEntityIds.filter((id) => !offered.insuredEntityIds.includes(id));
      if (missingEntities.length > 0) differences.push(`Coverage omits insured entities: ${required.coverageCode}`);
    }

    return differences;
  },
};
