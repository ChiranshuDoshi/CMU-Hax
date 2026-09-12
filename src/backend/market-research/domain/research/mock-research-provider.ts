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
  { id: "lakeside-grand", name: "Lakeside Grand Chicago", rating: 4.9, reviews: 18_400, ratingAgeDays: 28 },
  { id: "westbridge", name: "Westbridge Hotel", rating: 4.8, reviews: 12_700, ratingAgeDays: 40 },
  { id: "parkline", name: "Parkline Suites", rating: 4.7, reviews: 9_800, ratingAgeDays: 22 },
  { id: "the-atrium", name: "The Atrium Chicago", rating: 4.6, reviews: 8_100, ratingAgeDays: 55 },
  { id: "shoreline-house", name: "Shoreline House", rating: 4.6, reviews: 6_500, ratingAgeDays: 33 },
  { id: "river-north-inn", name: "River North Inn", rating: 4.5, reviews: 5_200, ratingAgeDays: 70 },
  { id: "midway-plaza", name: "Midway Plaza Hotel", rating: 4.4, reviews: 4_100, ratingAgeDays: 48 },
];

const MOCK_NIGHTLY_USD: Record<string, number> = {
  "lakeside-grand": 248,
  westbridge: 264,
  parkline: 276,
  "the-atrium": 288,
  "shoreline-house": 301,
  "river-north-inn": 312,
  "midway-plaza": 329,
};

function dateDaysBefore(isoDate: string, days: number): string {
  return new Date(Date.parse(isoDate) - days * 24 * 60 * 60 * 1_000).toISOString();
}

function makeSources(
  provider: MockProviderDefinition,
  retrievedAt: string,
): ResearchSource[] {
  const providerUrl = `https://${provider.id}.example.com/groups`;
  const ratingUrl = `https://ratings.example.org/hotels/${provider.id}`;
  return [
    {
      id: `${provider.id}-official`,
      title: `${provider.name} group booking and amenities page`,
      url: providerUrl,
      domain: `${provider.id}.example.com`,
      publisher: provider.name,
      retrievedAt,
      publishedAt: null,
      excerpt: "Fictional demo evidence for group rates, stay inclusions, and sales contact options.",
      officialSource: true,
      sourceKind: "provider",
      confidence: 1,
    },
    {
      id: `${provider.id}-rating`,
      title: `${provider.name} fictional traveler rating`,
      url: ratingUrl,
      domain: "ratings.example.org",
      publisher: "Atrium Demo Ratings",
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

  return MOCK_PROVIDER_DEFINITIONS.map((provider) => {
    const nightly = MOCK_NIGHTLY_USD[provider.id] ?? 250;
    return {
    providerId: provider.id,
    canonicalCarrierId: provider.id,
    providerName: provider.name,
    providerType: "marketplace" as const,
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
    licenseVerificationStatus: "not_applicable" as const,
    publicDiscounts: [
      "room_type:Deluxe king",
      `aggregator_nightly_cents:${nightly * 100}`,
      `agg:Booking.com=${nightly * 100}`,
      `agg:Expedia=${(nightly + 8) * 100}`,
      `agg:Hotels.com=${(nightly + 14) * 100}`,
    ],
    publicCoverageOptions: coverageCodes,
    sources: makeSources(provider, retrievedAt),
    simulated: true,
  };
  });
}

export class MockResearchProvider implements ResearchProvider {
  async research(input: ResearchInput) {
    const validatedInput = validateResearchInput(input);
    return validateRawResearchResult({
      candidates: buildMockResearchCandidates(validatedInput),
      warnings: [
        "Demo mode: hotel identities, ratings, reviews, and evidence are fictional and simulated.",
      ],
    });
  }
}
