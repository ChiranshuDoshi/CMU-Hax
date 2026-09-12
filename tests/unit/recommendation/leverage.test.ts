import { describe, expect, it } from "vitest";

import { selectVerifiedLeverage } from "@/domain/negotiation";

import { createEvidence, createQuote, OTHER_SPECIFICATION_HASH } from "./factories";

const now = new Date("2026-07-18T12:00:00.000Z");

function select(candidate: unknown, evidence = [createEvidence({ id: "evidence-candidate" })]) {
  return selectVerifiedLeverage({
    selectedQuote: createQuote(),
    candidateQuotes: [candidate],
    evidence,
    now,
  });
}

describe("verified leverage selection", () => {
  it.each([
    ["self", createQuote()],
    ["cross-workflow", createQuote({ quoteId: "candidate", workflowId: "workflow-other", evidenceIds: ["evidence-candidate"] })],
    ["cross-request", createQuote({ quoteId: "candidate", confirmedRequestId: "request-other", evidenceIds: ["evidence-candidate"] })],
    ["cross-hash", createQuote({ quoteId: "candidate", specificationHash: OTHER_SPECIFICATION_HASH, evidenceIds: ["evidence-candidate"] })],
    ["expired", createQuote({ quoteId: "candidate", expirationDate: "2026-07-17", evidenceIds: ["evidence-candidate"] })],
    ["failed", createQuote({ quoteId: "candidate", status: "failed", evidenceIds: ["evidence-candidate"] })],
    [
      "withdrawn",
      createQuote({
        quoteId: "candidate",
        evidenceIds: ["evidence-candidate"],
        redFlags: [{ code: "quote_withdrawn", severity: "blocking", message: "Provider withdrew the quote" }],
      }),
    ],
    ["cross-mode", createQuote({ quoteId: "candidate", simulated: false, evidenceIds: ["evidence-candidate"] })],
  ])("rejects %s leverage", (_label, candidate) => {
    expect(select(candidate)).toMatchObject({ status: "no_leverage_available" });
  });

  it("rejects evidence that is missing or not provider-confirmed", () => {
    const candidate = createQuote({ quoteId: "candidate", evidenceIds: ["evidence-candidate"] });

    expect(select(candidate, [])).toMatchObject({ status: "no_leverage_available" });
    expect(
      select(candidate, [createEvidence({ id: "evidence-candidate", verificationStatus: "user_confirmed" })]),
    ).toMatchObject({ status: "no_leverage_available" });
  });

  it("chooses the lowest verified equivalent cost and breaks exact ties by quote ID", () => {
    const result = selectVerifiedLeverage({
      selectedQuote: createQuote(),
      candidateQuotes: [
        createQuote({ quoteId: "quote-z", providerId: "provider-z", effectiveComparisonCostCents: 700, evidenceIds: ["e-z"] }),
        createQuote({ quoteId: "quote-b", providerId: "provider-b", effectiveComparisonCostCents: 600, evidenceIds: ["e-b"] }),
        createQuote({ quoteId: "quote-a", providerId: "provider-a", effectiveComparisonCostCents: 600, evidenceIds: ["e-a"] }),
      ],
      evidence: [
        createEvidence({ id: "e-z" }),
        createEvidence({ id: "e-b" }),
        createEvidence({ id: "e-a" }),
      ],
      now,
    });

    expect(result).toMatchObject({ status: "selected", quoteId: "quote-a", effectiveComparisonCostCents: 600 });
  });
});
