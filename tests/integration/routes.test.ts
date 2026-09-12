import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { POST as normalizeQuotes } from "@/app/api/quotes/normalize/route";
import { POST as runResearch } from "@/app/api/research/run/route";
import { ConfirmedQuoteRequestSchema, type Evidence, type RawQuoteOutcome } from "@/domain/schemas/person4";

const evaluatedAt = "2026-07-18T16:00:00.000Z";
const internalApiKey = "integration-test-internal-key";

function confirmedRequest() {
  const profile = JSON.parse(
    readFileSync(resolve(process.cwd(), "tests/fixtures/fake_person_profile.json"), "utf8"),
  ) as { confirmedQuoteRequest: unknown };
  return ConfirmedQuoteRequestSchema.parse(profile.confirmedQuoteRequest);
}

function evidence(id: string, claimKey: string): Evidence {
  return {
    id,
    workflowId: "workflow-demo-001",
    type: "demo_fixture",
    sourceId: "conversation-demo-harbor",
    claimKey,
    claimValue: true,
    pageNumber: null,
    transcriptStartMs: null,
    transcriptEndMs: null,
    speaker: "provider",
    excerpt: `Simulated provider evidence for ${claimKey}`,
    url: null,
    retrievedAt: evaluatedAt,
    confidence: 1,
    verificationStatus: "provider_confirmed",
  };
}

function completeRawQuote(): RawQuoteOutcome {
  const request = confirmedRequest();
  const coverageItems = request.requestedCoverage.map((coverage, index) => ({
    coverageCode: coverage.coverageCode,
    coverageName: coverage.coverageCode.replaceAll("_", " "),
    insuredEntityIds: coverage.insuredEntityIds,
    limitCents: coverage.minimumLimitCents,
    deductibleCents: coverage.maximumDeductibleCents,
    included: true,
    exclusions: [],
    evidenceIds: [`coverage-${index}`],
  }));
  const quoteEvidence = [
    evidence("premium", "premium.policy_term"),
    evidence("fees", "fees.confirmed_none"),
    ...coverageItems.map((_, index) => evidence(`coverage-${index}`, `coverage.${index}`)),
  ];

  return {
    quoteId: "quote-demo-harbor",
    workflowId: request.workflowId,
    providerId: "harbor-assurance",
    sourceConversationId: "conversation-demo-harbor",
    confirmedRequestId: request.id,
    specificationHash: request.specificationHash,
    status: "complete",
    quoteType: "simulated",
    effectiveDate: "2026-08-01",
    expirationDate: "2027-08-01",
    policyTermMonths: 12,
    premiumComponents: [
      {
        category: "base_premium",
        label: "Annual premium",
        amountCents: 120000,
        frequency: "policy_term",
        termCount: 1,
        required: true,
        conditional: false,
        refundable: false,
        includedInQuotedTotal: false,
        evidenceId: "premium",
      },
    ],
    feeComponents: [],
    taxComponents: [],
    discounts: [],
    coverageItems,
    coveredEntityIds: request.insuredEntityIds,
    downPaymentCents: 10000,
    paymentOptions: ["paid_in_full", "monthly"],
    exclusions: [],
    conditions: [],
    evidence: quoteEvidence,
    simulated: true,
  };
}

describe("Person 4 route integration", () => {
  it("returns a deterministic, cited mock Top Five for the user location", async () => {
    const response = await runResearch(
      new Request("http://localhost/api/research/run", {
        method: "POST",
        body: JSON.stringify({ quoteRequest: confirmedRequest(), mode: "mock", evaluatedAt }),
      }),
    );
    const body = (await response.json()) as {
      mode: string;
      ranking: { selected: Array<{ states: string[]; sources: unknown[]; selectionExplanation: string }> };
    };

    expect(response.status).toBe(200);
    expect(body.mode).toBe("mock");
    expect(body.ranking.selected).toHaveLength(5);
    expect(body.ranking.selected.every((provider) => provider.sources.length >= 2)).toBe(true);
    expect(body.ranking.selected.every((provider) => provider.selectionExplanation.includes("Ranked #"))).toBe(true);
  });

  it("normalizes quote evidence and deterministic policy-term cost", async () => {
    process.env.POLICYSCOUT_INTERNAL_API_KEY = internalApiKey;
    const response = await normalizeQuotes(
      new Request("http://localhost/api/quotes/normalize", {
        method: "POST",
        headers: { Authorization: `Bearer ${internalApiKey}` },
        body: JSON.stringify({ quoteRequest: confirmedRequest(), rawQuotes: [completeRawQuote()] }),
      }),
    );
    const body = (await response.json()) as {
      quotes: Array<{
        effectiveComparisonCostCents: number;
        coverageEquivalence: { status: string };
        evidenceIds: string[];
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.quotes[0]?.effectiveComparisonCostCents).toBe(120000);
    expect(body.quotes[0]?.coverageEquivalence.status).toBe("equivalent");
    expect(body.quotes[0]?.evidenceIds).toContain("premium");
  });

  it("rejects anonymous access to paid live research and trusted quote processing", async () => {
    process.env.POLICYSCOUT_INTERNAL_API_KEY = internalApiKey;
    const liveResearchResponse = await runResearch(
      new Request("http://localhost/api/research/run", {
        method: "POST",
        body: JSON.stringify({ quoteRequest: confirmedRequest(), mode: "live", evaluatedAt }),
      }),
    );
    const quoteResponse = await normalizeQuotes(
      new Request("http://localhost/api/quotes/normalize", {
        method: "POST",
        body: JSON.stringify({ quoteRequest: confirmedRequest(), rawQuotes: [completeRawQuote()] }),
      }),
    );

    expect(liveResearchResponse.status).toBe(401);
    expect(quoteResponse.status).toBe(401);
  });
});
