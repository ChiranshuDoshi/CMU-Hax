import type {
  ConfirmedQuoteRequest,
  CoverageItem,
  Evidence,
  NegotiationEvent,
  NegotiationGoal,
  NormalizedQuote,
} from "@/domain/schemas/person4";

export const SPECIFICATION_HASH = "a".repeat(64);
export const OTHER_SPECIFICATION_HASH = "b".repeat(64);

export function createConfirmedRequest(overrides: Partial<ConfirmedQuoteRequest> = {}): ConfirmedQuoteRequest {
  return {
    id: "request-1",
    workflowId: "workflow-1",
    version: 1,
    insuranceLines: ["auto"],
    state: "MA",
    zipCode: "02139",
    desiredEffectiveDate: "2026-08-01",
    insuredEntityIds: ["vehicle-1"],
    requestedCoverage: [
      {
        coverageCode: "bodily_injury_liability",
        insuredEntityIds: ["vehicle-1"],
        required: true,
        minimumLimitCents: 100_000,
        maximumDeductibleCents: 500,
      },
    ],
    excludedProviderIds: [],
    matchingMode: "exact_match",
    specificationHash: SPECIFICATION_HASH,
    confirmedAt: "2026-07-18T12:00:00.000Z",
    ...overrides,
  };
}

export function createEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "evidence-quote",
    workflowId: "workflow-1",
    type: "transcript",
    sourceId: "conversation-1",
    claimKey: "effective_comparison_cost",
    claimValue: 1_000,
    pageNumber: null,
    transcriptStartMs: 0,
    transcriptEndMs: 1_000,
    speaker: "provider",
    excerpt: "The provider confirmed the offer.",
    url: null,
    retrievedAt: "2026-07-18T12:00:00.000Z",
    confidence: 1,
    verificationStatus: "provider_confirmed",
    ...overrides,
  };
}

export function createCoverageItem(overrides: Partial<CoverageItem> = {}): CoverageItem {
  return {
    coverageCode: "bodily_injury_liability",
    coverageName: "Bodily injury liability",
    insuredEntityIds: ["vehicle-1"],
    limitCents: 100_000,
    deductibleCents: 500,
    included: true,
    exclusions: [],
    evidenceIds: ["evidence-quote"],
    ...overrides,
  };
}

export function createNegotiatedDiscount(
  amountCents = 200,
  overrides: Partial<NormalizedQuote["discounts"][number]> = {},
): NormalizedQuote["discounts"][number] {
  return {
    name: "Negotiated discount",
    amountCents,
    amountType: "fixed",
    applied: true,
    conditional: false,
    eligibilityConfirmed: true,
    continuingEligibilityRequired: false,
    conditions: [],
    evidenceId: "evidence-negotiation",
    ...overrides,
  };
}

export function createQuote(overrides: Partial<NormalizedQuote> = {}): NormalizedQuote {
  return {
    quoteId: "quote-1",
    workflowId: "workflow-1",
    providerId: "provider-1",
    sourceConversationId: "conversation-1",
    confirmedRequestId: "request-1",
    specificationHash: SPECIFICATION_HASH,
    status: "complete",
    quoteType: "simulated",
    effectiveDate: "2026-08-01",
    expirationDate: "2027-07-31",
    policyTermMonths: 12,
    premiumComponents: [
      {
        category: "base_premium",
        label: "Annual premium",
        amountCents: 1_000,
        frequency: "annual",
        termCount: 1,
        required: true,
        conditional: false,
        refundable: false,
        includedInQuotedTotal: false,
        evidenceId: "evidence-quote",
      },
    ],
    feeComponents: [
      {
        category: "policy_fee",
        label: "Policy fee",
        amountCents: 0,
        frequency: "policy_term",
        termCount: 1,
        required: true,
        conditional: false,
        refundable: false,
        includedInQuotedTotal: false,
        evidenceId: "evidence-quote",
      },
    ],
    taxComponents: [],
    discounts: [],
    coverageItems: [createCoverageItem()],
    coveredEntityIds: ["vehicle-1"],
    downPaymentCents: 100,
    paymentOptions: ["monthly", "annual"],
    exclusions: [],
    conditions: [],
    simulated: true,
    effectiveComparisonCostCents: 1_000,
    annualizedCostCents: 1_000,
    completenessScore: 100,
    confidenceScore: 100,
    coverageEquivalence: { status: "equivalent", differences: [] },
    redFlags: [],
    requiresHumanVerification: false,
    evidenceIds: ["evidence-quote"],
    ...overrides,
  };
}

export function createGoal(overrides: Partial<NegotiationGoal> = {}): NegotiationGoal {
  return {
    id: "goal-1",
    workflowId: "workflow-1",
    selectedQuoteId: "quote-1",
    targetProviderId: "provider-1",
    targetAmountCents: 900,
    targetRangeMinCents: null,
    targetRangeMaxCents: null,
    billingFrequency: "annual",
    desiredNonPriceImprovements: ["longer validity"],
    allowedTradeoffs: ["payment_schedule"],
    hardStops: ["private ceiling 987654321"],
    verifiedCompetingQuoteId: null,
    disclosurePolicy: "do_not_reveal_ceiling",
    confirmedAt: "2026-07-18T12:00:00.000Z",
    ...overrides,
  };
}

export function createNegotiationEvent(overrides: Partial<NegotiationEvent> = {}): NegotiationEvent {
  return {
    id: "event-1",
    workflowId: "workflow-1",
    negotiationGoalId: "goal-1",
    targetProviderId: "provider-1",
    negotiationConversationId: "negotiation-conversation-1",
    originalQuoteId: "quote-1",
    competingQuoteId: null,
    specificationHash: SPECIFICATION_HASH,
    verifiedLeverageStatement: null,
    requestedImprovement: "Reduce the annual effective cost.",
    providerResponse: "The annual effective cost is now 800.",
    originalCostCents: 1_000,
    finalCostCents: 800,
    changedCoverage: [],
    changedFees: [],
    changedDiscounts: [createNegotiatedDiscount()],
    evidenceIds: ["evidence-negotiation"],
    verificationStatus: "provider_confirmed",
    ...overrides,
  };
}

export function createNegotiationEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return createEvidence({
    id: "evidence-negotiation",
    sourceId: "negotiation-conversation-1",
    claimKey: "final_price",
    claimValue: 800,
    ...overrides,
  });
}
