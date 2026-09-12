import type {
  ConfirmedQuoteRequest,
  RawResearchCandidate,
} from "@/domain/schemas/person4";

export const EVALUATED_AT = "2026-07-18T12:00:00.000Z";

export function makeQuoteRequest(
  overrides: Partial<ConfirmedQuoteRequest> = {},
): ConfirmedQuoteRequest {
  return {
    id: "request-1",
    workflowId: "workflow-1",
    version: 1,
    insuranceLines: ["auto"],
    state: "CA",
    zipCode: "94105",
    desiredEffectiveDate: "2026-08-01",
    insuredEntityIds: ["driver-1", "vehicle-1"],
    requestedCoverage: [
      {
        coverageCode: "bodily_injury_liability",
        insuredEntityIds: ["driver-1", "vehicle-1"],
        required: true,
        minimumLimitCents: 100_000,
        maximumDeductibleCents: null,
      },
      {
        coverageCode: "collision",
        insuredEntityIds: ["vehicle-1"],
        required: true,
        minimumLimitCents: null,
        maximumDeductibleCents: 100_000,
      },
    ],
    excludedProviderIds: [],
    matchingMode: "same_or_better",
    specificationHash: "a".repeat(64),
    confirmedAt: "2026-07-18T11:00:00.000Z",
    ...overrides,
  };
}

export function makeCandidate(
  providerId: string,
  overrides: Partial<RawResearchCandidate> = {},
): RawResearchCandidate {
  const ratingSourceId = `${providerId}-rating`;
  return {
    providerId,
    canonicalCarrierId: providerId,
    providerName: `Provider ${providerId}`,
    providerType: "carrier",
    insuranceLines: ["auto"],
    nationwide: true,
    states: [],
    excludedZipCodes: [],
    preliminaryCoverageCodes: ["bodily_injury_liability", "collision"],
    website: `https://${providerId}.example.com`,
    publicContact: `https://${providerId}.example.com/contact`,
    rating: 4.5,
    ratingScaleMaximum: 5,
    reviewCount: 1_000,
    ratingSourceId,
    ratingObservedAt: "2026-06-01T00:00:00.000Z",
    licenseVerificationStatus: "verified",
    publicDiscounts: [],
    publicCoverageOptions: [],
    sources: [
      {
        id: ratingSourceId,
        title: `${providerId} rating evidence`,
        url: `https://ratings.example.org/${providerId}`,
        domain: "ratings.example.org",
        publisher: "Consumer Ratings",
        retrievedAt: EVALUATED_AT,
        publishedAt: "2026-06-01T00:00:00.000Z",
        excerpt: "Rating evidence for deterministic unit tests.",
        officialSource: false,
        sourceKind: "recognized_consumer",
        confidence: 1,
      },
    ],
    simulated: true,
    ...overrides,
  };
}
