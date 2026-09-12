/**
 * Deterministic personal-auto demo fixtures. (Spec §31.1.)
 *
 * This is the Checkpoint-1 handoff: one realistic, schema-valid instance of
 * every shared contract so Person 1 (dashboard), Person 3 (agents), and
 * Person 4 (ranking/normalization) can build in parallel before the DB and live
 * services exist. Everything is parsed through its Zod schema at module load, so
 * an invalid fixture fails fast (and in tests).
 *
 * The five providers match the demo counterparties in Spec §17. Quotes are
 * built so at least three are comparable, one is incomplete (Granite), and one
 * is a decline (none here — all five answer, Granite just underspecifies).
 */
import {
  InsuranceProfileSchema,
  type InsuranceProfile,
  ConfirmedQuoteRequestSchema,
  type ConfirmedQuoteRequest,
  ProviderRankingResultSchema,
  type ProviderRankingResult,
  ProviderResearchBriefSchema,
  NormalizedQuoteSchema,
  type NormalizedQuote,
  NegotiationGoalSchema,
  type NegotiationGoal,
  NegotiationEventSchema,
  type NegotiationEvent,
} from "../../domain/schemas/index.js";
import { computeSpecificationHash } from "../../domain/hashing/index.js";

const NOW = "2026-07-18T12:00:00.000Z";
const WORKFLOW_ID = "wf_demo_auto_0001";
const USER_ID = "user_demo_0001";
const REQUEST_ID = "req_demo_auto_0001";

// ── Provider IDs (stable, referenced by quotes & negotiation) ────────
export const PROVIDER_IDS = {
  harbor: "prov_harbor",
  granite: "prov_granite",
  summit: "prov_summit",
  cedar: "prov_cedar",
  horizon: "prov_horizon",
} as const;

// ── InsuranceProfile (complete, quote-ready) ─────────────────────────
export const demoProfile: InsuranceProfile = InsuranceProfileSchema.parse({
  id: "ins_profile_demo_0001",
  userId: USER_ID,
  version: 1,
  status: "confirmed",
  completenessScore: 1,
  quoteReady: true,
  userContext: {
    displayName: "Alex Rivera",
    state: "TX",
    zipCode: "78701",
    preferredLanguage: "en",
    preferredContactMethod: "email",
    desiredEffectiveDate: "2026-08-01",
    isDemoData: true,
  },
  requestedInsuranceLines: ["auto"],
  insuredEntities: [
    {
      id: "drv_1",
      entityType: "driver",
      displayLabel: "Alex Rivera",
      lineSpecificAttributes: {
        ageBand: "35-44",
        licenseStatus: "valid",
        yearsLicensed: 18,
        incidents: [],
      },
    },
    {
      id: "veh_1",
      entityType: "vehicle",
      displayLabel: "2021 Toyota RAV4",
      lineSpecificAttributes: {
        year: 2021,
        make: "Toyota",
        model: "RAV4",
        ownership: "owned",
        primaryUse: "commute",
        annualMileage: 11000,
        garaging: "78701",
      },
    },
  ],
  coverageSections: [
    {
      coverageCode: "BI",
      coverageName: "Bodily Injury Liability",
      insuranceLine: "auto",
      insuredEntityIds: ["drv_1"],
      limit: "100/300",
      requirement: "required",
    },
    {
      coverageCode: "COLL",
      coverageName: "Collision",
      insuranceLine: "auto",
      insuredEntityIds: ["veh_1"],
      deductible: 500,
      requirement: "required",
    },
    {
      coverageCode: "COMP",
      coverageName: "Comprehensive",
      insuranceLine: "auto",
      insuredEntityIds: ["veh_1"],
      deductible: 500,
      requirement: "required",
    },
  ],
  createdAt: NOW,
  updatedAt: NOW,
});

// ── ConfirmedQuoteRequest (provider-safe, hashed) ────────────────────
const requestBase = {
  requestId: REQUEST_ID,
  workflowId: WORKFLOW_ID,
  version: 1,
  insuranceLines: ["auto"] as const,
  state: "TX",
  zipCode: "78701",
  desiredEffectiveDate: "2026-08-01",
  providerSafeEntities: demoProfile.insuredEntities,
  existingCoverageBaseline: [],
  requestedCoverage: demoProfile.coverageSections,
  matchingMode: "exact_match" as const,
  allowedProviderContext: {},
  requiredQuoteQuestions: [
    "What is the total policy-term premium (not just monthly)?",
    "What fees apply, and are they required?",
    "Which discounts are conditional or require monitoring?",
  ],
  requiredQuoteFields: ["premium", "fees", "deductibles", "discounts", "term"],
  userConfirmedFacts: { continuousInsurance: true },
  excludedSensitiveFacts: ["ssn", "driversLicenseNumber", "paymentCardNumber"],
};

const specificationHash = computeSpecificationHash(requestBase);

export const demoConfirmedRequest: ConfirmedQuoteRequest =
  ConfirmedQuoteRequestSchema.parse({
    ...requestBase,
    confirmedAt: NOW,
    specificationHash,
  });

// ── ProviderRankingResult (Top 5) ────────────────────────────────────
function brief(
  id: string,
  name: string,
  rank: number,
  normalizedRating: number,
  reviewCount: number
) {
  return ProviderResearchBriefSchema.parse({
    providerId: id,
    providerName: name,
    providerType: "demo_counterparty",
    insuranceLinesOffered: ["auto"],
    geographicAvailability: ["TX"],
    website: `https://example.com/${name.toLowerCase().replace(/\s+/g, "-")}`,
    officialSource: true,
    licenseVerificationStatus: "verified",
    reviewCount,
    rating: normalizedRating / 20, // pretend a 5-star scale
    ratingScale: 5,
    ratingSource: "Demo Consumer Index",
    ratingSourceUrl: "https://example.com/ratings",
    normalizedRating,
    ratingRecency: "2026-Q2",
    ratingConfidence: 0.8,
    eligibilityStatus: "eligible",
    topFiveRank: rank,
    selectionExplanation: `Ranked #${rank} on normalized rating with sufficient review volume.`,
    researchSources: [
      {
        title: `${name} official auto page`,
        url: `https://example.com/${id}`,
        publisher: name,
        retrievedAt: NOW,
        excerpt: "Auto insurance available in TX.",
        officialSource: true,
        confidence: 0.9,
      },
    ],
    retrievedAt: NOW,
    confidence: 0.85,
    simulated: true,
  });
}

export const demoRankingResult: ProviderRankingResult =
  ProviderRankingResultSchema.parse({
    workflowId: WORKFLOW_ID,
    quoteRequestId: REQUEST_ID,
    rankedProviders: [
      brief(PROVIDER_IDS.cedar, "Cedar Mutual", 1, 92, 4200),
      brief(PROVIDER_IDS.harbor, "Harbor Assurance", 2, 90, 3100),
      brief(PROVIDER_IDS.horizon, "Horizon Direct", 3, 88, 5600),
      brief(PROVIDER_IDS.summit, "Summit Insurance Partners", 4, 86, 2100),
      brief(PROVIDER_IDS.granite, "Granite Coverage Group", 5, 83, 900),
    ],
    excludedProviders: [],
    hasFiveEligible: true,
    warning: null,
    generatedAt: NOW,
  });

// ── NormalizedQuotes (five outcomes) ─────────────────────────────────
function quote(
  quoteId: string,
  providerId: string,
  opts: {
    status?: NormalizedQuote["quoteStatus"];
    monthly: number | null;
    fees?: number;
    comparisonCost: number | null;
    equivalence?: NormalizedQuote["coverageEquivalence"];
    completeness?: number;
    redFlags?: string[];
  }
): NormalizedQuote {
  const premium =
    opts.monthly === null
      ? []
      : [
          {
            category: "premium",
            label: "Base premium",
            amount: opts.monthly,
            frequency: "monthly" as const,
            termCount: 6,
            required: true,
            includedInQuotedTotal: true,
          },
        ];
  const fees =
    opts.fees && opts.fees > 0
      ? [
          {
            category: "fee",
            label: "Installment fee",
            amount: opts.fees,
            frequency: "monthly" as const,
            required: true,
            conditional: false,
            includedInQuotedTotal: true,
          },
        ]
      : [];
  return NormalizedQuoteSchema.parse({
    quoteId,
    workflowId: WORKFLOW_ID,
    providerId,
    sourceConversationId: `conv_${providerId}`,
    confirmedRequestId: REQUEST_ID,
    specificationHash,
    insuranceLines: ["auto"],
    quoteStatus: opts.status ?? "quote_received",
    quoteType: "simulated",
    policyTerm: "6 months",
    currency: "USD",
    premiumComponents: premium,
    feeComponents: fees,
    discounts: [],
    coverageItems: [
      {
        coverageCode: "BI",
        coverageName: "Bodily Injury Liability",
        limit: "100/300",
        included: true,
        equivalenceStatus: opts.equivalence ?? "equivalent",
      },
      {
        coverageCode: "COLL",
        coverageName: "Collision",
        deductible: 500,
        included: true,
        equivalenceStatus: opts.equivalence ?? "equivalent",
      },
    ],
    effectiveComparisonCost: opts.comparisonCost,
    annualizedCost: opts.comparisonCost === null ? null : opts.comparisonCost * 2,
    coverageEquivalence: opts.equivalence ?? "equivalent",
    completenessScore: opts.completeness ?? 0.95,
    confidenceScore: 0.9,
    requiresHumanVerification: false,
    redFlags: opts.redFlags ?? [],
    createdAt: NOW,
    updatedAt: NOW,
  });
}

export const demoQuotes: NormalizedQuote[] = [
  quote("quote_cedar", PROVIDER_IDS.cedar, {
    monthly: 158,
    comparisonCost: 948,
    equivalence: "equivalent",
  }),
  quote("quote_harbor", PROVIDER_IDS.harbor, {
    monthly: 149,
    fees: 6,
    comparisonCost: 930,
    equivalence: "equivalent",
  }),
  quote("quote_horizon", PROVIDER_IDS.horizon, {
    monthly: 139,
    fees: 9,
    comparisonCost: 888,
    equivalence: "equivalent",
    redFlags: ["Some discounts conditional on telematics enrollment"],
  }),
  quote("quote_summit", PROVIDER_IDS.summit, {
    monthly: 182,
    comparisonCost: 1092,
    equivalence: "better_than_requested",
  }),
  quote("quote_granite", PROVIDER_IDS.granite, {
    status: "incomplete_quote",
    monthly: 129,
    comparisonCost: null,
    equivalence: "missing_information",
    completeness: 0.4,
    redFlags: ["Monthly-only quote; fees and policy-term total not disclosed"],
  }),
];

/** Cedar is the system recommendation (best comparable value here). */
export const demoRecommendedQuoteId = "quote_harbor";

// ── NegotiationGoal (user selected Summit to push on price) ──────────
export const demoNegotiationGoal: NegotiationGoal = NegotiationGoalSchema.parse({
  goalId: "goal_demo_0001",
  workflowId: WORKFLOW_ID,
  selectedQuoteId: "quote_summit",
  targetProviderId: PROVIDER_IDS.summit,
  targetRangeMin: 900,
  targetRangeMax: 1000,
  desiredNonPriceImprovements: ["Waive new-policy fee"],
  allowedTradeoffs: ["Enroll in autopay"],
  hardStops: ["Do not reduce liability below 100/300"],
  verifiedCompetingQuoteId: "quote_harbor",
  disclosurePolicy: "do_not_reveal_ceiling",
  confirmedAt: NOW,
});

// ── NegotiationEvent (before/after result) ───────────────────────────
export const demoNegotiationEvent: NegotiationEvent =
  NegotiationEventSchema.parse({
    eventId: "nevent_demo_0001",
    workflowId: WORKFLOW_ID,
    negotiationGoalId: "goal_demo_0001",
    targetProviderId: PROVIDER_IDS.summit,
    negotiationConversationId: "conv_neg_summit",
    originalQuoteId: "quote_summit",
    competingQuoteId: "quote_harbor",
    specificationHash,
    verifiedLeverageStatement:
      "A verified comparable quote for the same coverage spec is available at $930/term.",
    requestedImprovement: "Match competing comparable price and waive new-policy fee.",
    providerResponse: "Applied loyalty discount and waived the new-policy fee.",
    outcome: "price_reduced",
    originalPrice: 1092,
    finalPrice: 984,
    savingsAmount: 108,
    changedFees: ["new-policy fee waived"],
    targetMet: true,
    verificationStatus: "verified",
    createdAt: NOW,
  });

/** The workflow-level spec hash, exported for cross-fixture assertions. */
export const demoSpecificationHash = specificationHash;
