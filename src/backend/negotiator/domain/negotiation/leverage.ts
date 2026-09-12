import {
  EvidenceSchema,
  LeverageSelectionSchema,
  NormalizedQuoteSchema,
  type Evidence,
  type LeverageSelection,
  type NormalizedQuote,
} from "@/domain/schemas/person4";

const ELIGIBLE_EQUIVALENCE_STATUSES = new Set(["equivalent", "better_than_requested"]);

export interface VerifiedLeverageInput {
  selectedQuote: unknown;
  candidateQuotes: readonly unknown[];
  evidence: readonly unknown[];
  now: Date;
}

interface CandidateEvaluation {
  quote?: NormalizedQuote;
  reasons: string[];
}

function parseEvidence(values: readonly unknown[]): Map<string, Evidence> {
  const evidence = new Map<string, Evidence>();
  for (const value of values) {
    const parsed = EvidenceSchema.safeParse(value);
    if (parsed.success) evidence.set(parsed.data.id, parsed.data);
  }
  return evidence;
}

function evaluateCandidate(
  value: unknown,
  selectedQuote: NormalizedQuote,
  evidenceById: ReadonlyMap<string, Evidence>,
  today: string,
): CandidateEvaluation {
  const parsed = NormalizedQuoteSchema.safeParse(value);
  if (!parsed.success) return { reasons: ["quote data failed normalized-quote validation"] };

  const quote = parsed.data;
  const reasons: string[] = [];
  if (quote.quoteId === selectedQuote.quoteId) reasons.push("selected quote cannot be its own leverage");
  if (quote.workflowId !== selectedQuote.workflowId) reasons.push("workflow does not match selected quote");
  if (quote.confirmedRequestId !== selectedQuote.confirmedRequestId) reasons.push("confirmed quote request does not match");
  if (quote.specificationHash !== selectedQuote.specificationHash) reasons.push("specification hash does not match");
  if (quote.simulated !== selectedQuote.simulated) reasons.push("demo/live mode does not match");
  if (quote.simulated && quote.sourceType === "conversation") {
    reasons.push("simulated quote-collection calls cannot be used as leverage");
  }
  if (quote.status !== "complete") reasons.push("quote is not complete");
  if (quote.effectiveComparisonCostCents === null) reasons.push("effective comparison cost is missing");
  if (quote.expirationDate === null) reasons.push("quote expiration is missing");
  else if (quote.expirationDate < today) reasons.push("quote is expired");
  if (!ELIGIBLE_EQUIVALENCE_STATUSES.has(quote.coverageEquivalence.status)) {
    reasons.push("coverage is not equivalent or better");
  }
  if (quote.redFlags.some(({ severity }) => severity === "blocking")) reasons.push("quote has a blocking red flag");
  if (quote.redFlags.some(({ code }) => code.toLowerCase().includes("withdraw"))) reasons.push("quote was withdrawn");

  if (quote.evidenceIds.length === 0) {
    reasons.push("quote has no evidence");
  } else {
    const evidenceRecords = quote.evidenceIds.map((id) => evidenceById.get(id));
    if (evidenceRecords.some((record) => record === undefined)) reasons.push("quote evidence is missing");
    if (evidenceRecords.some((record) => record !== undefined && record.workflowId !== quote.workflowId)) {
      reasons.push("quote evidence belongs to another workflow");
    }
    if (evidenceRecords.some((record) => record !== undefined && record.verificationStatus !== "provider_confirmed")) {
      reasons.push("quote evidence is not provider-confirmed");
    }
  }

  return { quote, reasons };
}

export function selectVerifiedLeverage(input: VerifiedLeverageInput): LeverageSelection {
  const selected = NormalizedQuoteSchema.safeParse(input.selectedQuote);
  if (!selected.success) {
    return LeverageSelectionSchema.parse({
      status: "no_leverage_available",
      reasons: ["selected quote failed normalized-quote validation"],
    });
  }

  if (!Number.isFinite(input.now.getTime())) {
    return LeverageSelectionSchema.parse({ status: "no_leverage_available", reasons: ["evaluation time is invalid"] });
  }

  const evidenceById = parseEvidence(input.evidence);
  const nowIso = input.now.toISOString();
  const today = nowIso.slice(0, 10);
  const evaluated = input.candidateQuotes.map((candidate) =>
    evaluateCandidate(candidate, selected.data, evidenceById, today),
  );
  const eligible = evaluated
    .filter(
      (candidate): candidate is CandidateEvaluation & { quote: NormalizedQuote } =>
        candidate.quote !== undefined && candidate.reasons.length === 0,
    )
    .sort((left, right) => {
      const costDifference =
        (left.quote.effectiveComparisonCostCents ?? Number.POSITIVE_INFINITY) -
        (right.quote.effectiveComparisonCostCents ?? Number.POSITIVE_INFINITY);
      return costDifference || left.quote.quoteId.localeCompare(right.quote.quoteId);
    });

  const best = eligible[0]?.quote;
  if (!best || best.effectiveComparisonCostCents === null) {
    const reasons = evaluated.flatMap((candidate, index) =>
      candidate.reasons.map((reason) => `${candidate.quote?.quoteId ?? `candidate-${index + 1}`}: ${reason}`),
    );
    return LeverageSelectionSchema.parse({
      status: "no_leverage_available",
      reasons: reasons.length > 0 ? reasons : ["no competing quotes were provided"],
    });
  }

  return LeverageSelectionSchema.parse({
    status: "selected",
    quoteId: best.quoteId,
    providerId: best.providerId,
    effectiveComparisonCostCents: best.effectiveComparisonCostCents,
    specificationHash: best.specificationHash,
    evidenceIds: [...best.evidenceIds],
    reason: "Lowest-cost provider-confirmed quote with equivalent-or-better coverage for the same confirmed request",
  });
}
