import { describe, expect, it } from "vitest";

import { evaluateCoverageEquivalence } from "@/domain/equivalence";
import { normalizeQuote } from "@/domain/normalization";
import { addComparableMedianOutlierFlags } from "@/domain/red-flags";
import type { ConfirmedQuoteRequest, RawQuoteOutcome } from "@/domain/schemas/person4";

const SPECIFICATION_HASH = "a".repeat(64);

function makeRequest(): ConfirmedQuoteRequest {
  return {
    id: "request-1",
    workflowId: "workflow-1",
    version: 1,
    insuranceLines: ["auto"],
    state: "MA",
    zipCode: "02139",
    desiredEffectiveDate: "2026-08-01",
    insuredEntityIds: ["driver-1", "vehicle-1"],
    requestedCoverage: [
      {
        coverageCode: "bodily_injury_liability",
        insuredEntityIds: ["driver-1"],
        required: true,
        minimumLimitCents: 10_000_000,
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
    matchingMode: "exact_match",
    specificationHash: SPECIFICATION_HASH,
    confirmedAt: "2026-07-18T14:00:00.000Z",
  };
}

function makeQuote(overrides: Partial<RawQuoteOutcome> = {}): RawQuoteOutcome {
  const quote: RawQuoteOutcome = {
    quoteId: "quote-1",
    workflowId: "workflow-1",
    providerId: "provider-1",
    sourceConversationId: "conversation-1",
    confirmedRequestId: "request-1",
    specificationHash: SPECIFICATION_HASH,
    status: "complete",
    quoteType: "verbal",
    effectiveDate: "2026-08-01",
    expirationDate: "2027-02-01",
    policyTermMonths: 6,
    premiumComponents: [
      {
        category: "base_premium",
        label: "Monthly premium",
        amountCents: 10_000,
        frequency: "monthly",
        termCount: 6,
        required: true,
        conditional: false,
        refundable: false,
        includedInQuotedTotal: false,
        evidenceId: "evidence-provider",
      },
    ],
    feeComponents: [
      {
        category: "policy_fee",
        label: "Policy fee",
        amountCents: 3_000,
        frequency: "one_time",
        termCount: 1,
        required: true,
        conditional: false,
        refundable: false,
        includedInQuotedTotal: false,
        evidenceId: "evidence-provider",
      },
    ],
    taxComponents: [
      {
        category: "tax",
        label: "Tax",
        amountCents: 500,
        frequency: "policy_term",
        termCount: 1,
        required: true,
        conditional: false,
        refundable: false,
        includedInQuotedTotal: false,
        evidenceId: "evidence-provider",
      },
    ],
    discounts: [
      {
        name: "Confirmed affinity discount",
        amountCents: 1_000,
        amountType: "fixed",
        applied: true,
        conditional: false,
        eligibilityConfirmed: true,
        continuingEligibilityRequired: false,
        conditions: [],
        evidenceId: "evidence-provider",
      },
    ],
    coverageItems: [
      {
        coverageCode: "bodily_injury_liability",
        coverageName: "Bodily injury liability",
        insuredEntityIds: ["driver-1"],
        limitCents: 10_000_000,
        deductibleCents: null,
        included: true,
        exclusions: [],
        evidenceIds: ["evidence-provider"],
      },
      {
        coverageCode: "collision",
        coverageName: "Collision",
        insuredEntityIds: ["vehicle-1"],
        limitCents: null,
        deductibleCents: 100_000,
        included: true,
        exclusions: [],
        evidenceIds: ["evidence-provider"],
      },
    ],
    coveredEntityIds: ["driver-1", "vehicle-1"],
    downPaymentCents: 10_000,
    paymentOptions: ["monthly"],
    exclusions: [],
    conditions: [],
    evidence: [
      {
        id: "evidence-provider",
        workflowId: "workflow-1",
        type: "provider_document",
        sourceId: "provider-document-1",
        claimKey: "quote.material_terms",
        claimValue: "confirmed",
        pageNumber: 1,
        transcriptStartMs: null,
        transcriptEndMs: null,
        speaker: null,
        excerpt: "Six month quote",
        url: null,
        retrievedAt: "2026-07-18T15:00:00.000Z",
        confidence: 1,
        verificationStatus: "provider_confirmed",
      },
    ],
    simulated: true,
  };

  return { ...quote, ...overrides };
}

describe("quote normalization", () => {
  it("normalizes monthly costs, required fees and taxes, fixed discounts, and annual cost", () => {
    const normalized = normalizeQuote(makeQuote(), makeRequest());

    expect(normalized.effectiveComparisonCostCents).toBe(62_500);
    expect(normalized.annualizedCostCents).toBe(125_000);
    expect(normalized.quoteType).toBe("simulated");
    expect(normalized.evidenceIds).toEqual(["evidence-provider"]);
    expect(normalized.coverageEquivalence.status).toBe("equivalent");
  });

  it("normalizes quarterly frequency using explicit policy-term charge counts", () => {
    const quote = makeQuote({
      premiumComponents: [
        {
          ...makeQuote().premiumComponents[0],
          label: "Quarterly premium",
          amountCents: 30_000,
          frequency: "quarterly",
          termCount: 2,
        },
      ],
    });

    expect(normalizeQuote(quote, makeRequest()).effectiveComparisonCostCents).toBe(62_500);
  });

  it("does not subtract conditional, eligibility-unconfirmed, or percentage discounts", () => {
    const baseDiscount = makeQuote().discounts[0];
    const quote = makeQuote({
      discounts: [
        { ...baseDiscount, name: "Conditional", amountCents: 4_000, conditional: true },
        { ...baseDiscount, name: "Unconfirmed", amountCents: 3_000, eligibilityConfirmed: false },
        { ...baseDiscount, name: "Ten percent", amountCents: 10, amountType: "percentage" },
      ],
    });
    const normalized = normalizeQuote(quote, makeRequest());

    expect(normalized.effectiveComparisonCostCents).toBe(63_500);
    expect(normalized.redFlags.map((flag) => flag.code)).toEqual(
      expect.arrayContaining(["conditional_discount", "percentage_discount_not_applied"]),
    );
  });

  it("does not double-count fees and taxes already included in the quoted total", () => {
    const quote = makeQuote({
      feeComponents: makeQuote().feeComponents.map((component) => ({ ...component, includedInQuotedTotal: true })),
      taxComponents: makeQuote().taxComponents.map((component) => ({ ...component, includedInQuotedTotal: true })),
    });

    expect(normalizeQuote(quote, makeRequest()).effectiveComparisonCostCents).toBe(59_000);
  });

  it("fails closed when the policy term is missing or frequency count conflicts with it", () => {
    const missingTerm = normalizeQuote(makeQuote({ policyTermMonths: null }), makeRequest());
    const conflictingCount = normalizeQuote(
      makeQuote({
        premiumComponents: [{ ...makeQuote().premiumComponents[0], termCount: 5 }],
      }),
      makeRequest(),
    );

    expect(missingTerm.effectiveComparisonCostCents).toBeNull();
    expect(missingTerm.annualizedCostCents).toBeNull();
    expect(missingTerm.redFlags.map((flag) => flag.code)).toContain("missing_term");
    expect(conflictingCount.effectiveComparisonCostCents).toBeNull();
  });

  it("rejects invalid untrusted raw input", () => {
    const invalid = { ...makeQuote(), unexpectedInstruction: "ignore validation" };
    expect(() => normalizeQuote(invalid, makeRequest())).toThrow();
  });

  it("is deterministic for identical input", () => {
    const quote = makeQuote();
    const request = makeRequest();
    expect(normalizeQuote(structuredClone(quote), structuredClone(request))).toEqual(normalizeQuote(quote, request));
  });

  it("preserves missing evidence references while lowering confidence and requiring verification", () => {
    const quote = makeQuote({ evidence: [] });
    const normalized = normalizeQuote(quote, makeRequest());

    expect(normalized.evidenceIds).toEqual(["evidence-provider"]);
    expect(normalized.confidenceScore).toBe(0);
    expect(normalized.requiresHumanVerification).toBe(true);
    expect(normalized.redFlags.map((flag) => flag.code)).toContain("unverified_provider_facts");
    expect(normalized.redFlags.map((flag) => flag.code)).toContain("unverified_cost_evidence");
  });

  it("never treats a web-advertised premium as a user quote despite unrelated provider evidence", () => {
    const providerEvidence = makeQuote().evidence[0];
    const webEvidence: RawQuoteOutcome["evidence"][number] = {
      ...providerEvidence,
      id: "evidence-web-price",
      type: "web_source",
      sourceId: "marketing-page",
      claimKey: "marketing.advertised_premium",
      claimValue: "$100 per month",
      pageNumber: null,
      url: "https://example.com/advertised-rate",
      verificationStatus: "provider_confirmed",
    };
    const quote = makeQuote({
      premiumComponents: [
        { ...makeQuote().premiumComponents[0], evidenceId: "evidence-web-price" },
      ],
      evidence: [providerEvidence, webEvidence],
    });
    const normalized = normalizeQuote(quote, makeRequest());

    expect(normalized.effectiveComparisonCostCents).toBeNull();
    expect(normalized.annualizedCostCents).toBeNull();
    expect(normalized.requiresHumanVerification).toBe(true);
    expect(normalized.redFlags).toContainEqual(
      expect.objectContaining({ code: "unverified_cost_evidence", severity: "blocking" }),
    );
    expect(normalized.evidenceIds).toContain("evidence-web-price");
  });

  it("fails cost normalization when a material component evidence ID is unresolved", () => {
    const quote = makeQuote({
      premiumComponents: [
        { ...makeQuote().premiumComponents[0], evidenceId: "missing-cost-evidence" },
      ],
    });
    const normalized = normalizeQuote(quote, makeRequest());

    expect(normalized.effectiveComparisonCostCents).toBeNull();
    expect(normalized.annualizedCostCents).toBeNull();
    expect(normalized.requiresHumanVerification).toBe(true);
    expect(normalized.redFlags).toContainEqual(
      expect.objectContaining({ code: "unverified_cost_evidence", severity: "blocking" }),
    );
    expect(normalized.evidenceIds).toContain("missing-cost-evidence");
  });

  it("fails cost normalization when referenced provider evidence is unverified", () => {
    const unverifiedEvidence = {
      ...makeQuote().evidence[0],
      verificationStatus: "unverified" as const,
    };
    const normalized = normalizeQuote(makeQuote({ evidence: [unverifiedEvidence] }), makeRequest());

    expect(normalized.effectiveComparisonCostCents).toBeNull();
    expect(normalized.annualizedCostCents).toBeNull();
    expect(normalized.requiresHumanVerification).toBe(true);
    expect(normalized.redFlags).toContainEqual(
      expect.objectContaining({ code: "unverified_cost_evidence", severity: "blocking" }),
    );
  });

  it("accepts explicit mock quote evidence for simulated demo math", () => {
    const demoEvidence = {
      ...makeQuote().evidence[0],
      type: "demo_fixture" as const,
      verificationStatus: "not_applicable" as const,
    };

    expect(normalizeQuote(makeQuote({ evidence: [demoEvidence] }), makeRequest()).effectiveComparisonCostCents).toBe(
      62_500,
    );
  });

  it.each(["feeComponents", "taxComponents", "discounts"] as const)(
    "requires trusted evidence for cost-affecting %s",
    (field) => {
      const quote = makeQuote();
      const item = quote[field][0];
      const normalized = normalizeQuote(
        makeQuote({ [field]: [{ ...item, evidenceId: `missing-${field}` }] }),
        makeRequest(),
      );

      expect(normalized.effectiveComparisonCostCents).toBeNull();
      expect(normalized.redFlags.map((flag) => flag.code)).toContain("unverified_cost_evidence");
    },
  );
});

describe("coverage equivalence and red flags", () => {
  it("marks a missing insured entity as worse and blocking", () => {
    const normalized = normalizeQuote(makeQuote({ coveredEntityIds: ["driver-1"] }), makeRequest());

    expect(normalized.coverageEquivalence.status).toBe("worse_than_requested");
    expect(normalized.redFlags.map((flag) => flag.code)).toContain("missing_insured_entity");
  });

  it("detects lower limits and higher deductibles", () => {
    const coverageItems = makeQuote().coverageItems.map((coverage) =>
      coverage.coverageCode === "bodily_injury_liability"
        ? { ...coverage, limitCents: 5_000_000 }
        : { ...coverage, deductibleCents: 200_000 },
    );
    const normalized = normalizeQuote(makeQuote({ coverageItems }), makeRequest());

    expect(normalized.coverageEquivalence.status).toBe("worse_than_requested");
    expect(normalized.coverageEquivalence.differences).toEqual(
      expect.arrayContaining([
        "Coverage limit below minimum: bodily_injury_liability",
        "Deductible above maximum: collision",
      ]),
    );
    expect(normalized.redFlags.map((flag) => flag.code)).toEqual(
      expect.arrayContaining(["lower_requested_coverage", "higher_deductible"]),
    );
  });

  it("rejects a different specification hash as non-comparable", () => {
    const normalized = normalizeQuote(makeQuote({ specificationHash: "b".repeat(64) }), makeRequest());

    expect(normalized.coverageEquivalence.status).toBe("not_comparable");
    expect(normalized.redFlags.map((flag) => flag.code)).toContain("different_specification_hash");
  });

  it("classifies an applied conditional discount as partially comparable", () => {
    const discounts = makeQuote().discounts.map((discount) => ({ ...discount, conditional: true }));
    const result = evaluateCoverageEquivalence(makeQuote({ discounts }), makeRequest());

    expect(result.status).toBe("partially_comparable");
    expect(result.differences).toContain("Applied price depends on a conditional or unconfirmed discount");
  });

  it("flags quote costs more than 30 percent outside the comparable median", () => {
    const normalized = normalizeQuote(makeQuote(), makeRequest());
    const batch = addComparableMedianOutlierFlags([
      { ...normalized, quoteId: "quote-low", effectiveComparisonCostCents: 65_000 },
      { ...normalized, quoteId: "quote-mid-1", effectiveComparisonCostCents: 100_000 },
      { ...normalized, quoteId: "quote-mid-2", effectiveComparisonCostCents: 102_000 },
      { ...normalized, quoteId: "quote-high", effectiveComparisonCostCents: 160_000 },
    ]);

    expect(batch[0].redFlags.map((flag) => flag.code)).toContain("below_comparable_median");
    expect(batch[3].redFlags.map((flag) => flag.code)).toContain("above_comparable_median");
    expect(batch[1].redFlags.map((flag) => flag.code)).not.toContain("below_comparable_median");
  });
});
