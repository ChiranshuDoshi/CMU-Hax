import type {
  RawResearchCandidate,
} from "@/domain/schemas/person4";

import {
  validateRawResearchResult,
  validateResearchInput,
  type ResearchInput,
  type ResearchProvider,
} from "./types";

type ResearchSource = RawResearchCandidate["sources"][number];

interface MockProviderDefinition {
  id: string;
  name: string;
  rating: number;
  reviews: number;
  ratingAgeDays: number;
}

const MOCK_PROVIDER_DEFINITIONS: readonly MockProviderDefinition[] = [
  { id: "harbor-assurance", name: "Harbor Assurance", rating: 4.8, reviews: 3_400, ratingAgeDays: 35 },
  { id: "cedar-mutual", name: "Cedar Mutual", rating: 4.7, reviews: 6_200, ratingAgeDays: 50 },
  { id: "horizon-direct", name: "Horizon Direct", rating: 4.65, reviews: 8_100, ratingAgeDays: 20 },
  { id: "summit-insurance-partners", name: "Summit Insurance Partners", rating: 4.6, reviews: 4_800, ratingAgeDays: 80 },
  { id: "granite-coverage-group", name: "Granite Coverage Group", rating: 4.55, reviews: 5_500, ratingAgeDays: 65 },
  { id: "beacon-shield", name: "Beacon Shield", rating: 4.5, reviews: 9_700, ratingAgeDays: 110 },
  { id: "pioneer-protection", name: "Pioneer Protection", rating: 4.45, reviews: 2_900, ratingAgeDays: 45 },
];

function dateDaysBefore(isoDate: string, days: number): string {
  return new Date(Date.parse(isoDate) - days * 24 * 60 * 60 * 1_000).toISOString();
}

function makeSources(
  provider: MockProviderDefinition,
  retrievedAt: string,
): ResearchSource[] {
  const providerUrl = `https://${provider.id}.example.com/insurance`;
  const ratingUrl = `https://ratings.example.org/providers/${provider.id}`;
  return [
    {
      id: `${provider.id}-official`,
      title: `${provider.name} public product and contact page`,
      url: providerUrl,
      domain: `${provider.id}.example.com`,
      publisher: provider.name,
      retrievedAt,
      publishedAt: null,
      excerpt: "Fictional demo evidence for public products, service area, and contact options.",
      officialSource: true,
      sourceKind: "provider",
      confidence: 1,
    },
    {
      id: `${provider.id}-rating`,
      title: `${provider.name} fictional consumer rating`,
      url: ratingUrl,
      domain: "ratings.example.org",
      publisher: "PolicyScout Demo Ratings",
      retrievedAt,
      publishedAt: dateDaysBefore(retrievedAt, provider.ratingAgeDays),
      excerpt: `Fictional demo rating: ${provider.rating} out of 5 from ${provider.reviews} reviews.`,
      officialSource: false,
      sourceKind: "recognized_consumer",
      confidence: 1,
    },
  ];
}

export function buildMockResearchCandidates(input: ResearchInput): RawResearchCandidate[] {
  const { quoteRequest, retrievedAt } = validateResearchInput(input);
  const coverageCodes = [...new Set(quoteRequest.requestedCoverage.map((item) => item.coverageCode))];

  return MOCK_PROVIDER_DEFINITIONS.map((provider) => ({
    providerId: provider.id,
    canonicalCarrierId: provider.id,
    providerName: provider.name,
    providerType: "carrier",
    insuranceLines: [...quoteRequest.insuranceLines],
    nationwide: true,
    states: [],
    excludedZipCodes: [],
    preliminaryCoverageCodes: coverageCodes,
    website: `https://${provider.id}.example.com`,
    publicContact: `https://${provider.id}.example.com/contact`,
    rating: provider.rating,
    ratingScaleMaximum: 5,
    reviewCount: provider.reviews,
    ratingSourceId: `${provider.id}-rating`,
    ratingObservedAt: dateDaysBefore(retrievedAt, provider.ratingAgeDays),
    licenseVerificationStatus: "unverified",
    publicDiscounts: [],
    publicCoverageOptions: coverageCodes,
    sources: makeSources(provider, retrievedAt),
    simulated: true,
  }));
}

export class MockResearchProvider implements ResearchProvider {
  async research(input: ResearchInput) {
    const validatedInput = validateResearchInput(input);
    return validateRawResearchResult({
      candidates: buildMockResearchCandidates(validatedInput),
      warnings: [
        "Demo mode: provider identities, ratings, reviews, and evidence are fictional and simulated.",
      ],
    });
  }
}
