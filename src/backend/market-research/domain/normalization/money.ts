import type { RawQuoteOutcome } from "@/domain/schemas/person4";

export interface QuoteCostCalculation {
  effectiveComparisonCostCents: number | null;
  annualizedCostCents: number | null;
  ignoredPercentageDiscounts: boolean;
  unverifiedCostEvidenceIds: string[];
}

const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
const PROVIDER_QUOTE_EVIDENCE_TYPES = new Set(["provider_document", "transcript", "audio"]);

function unavailableCost(
  ignoredPercentageDiscounts: boolean,
  unverifiedCostEvidenceIds: readonly string[] = [],
): QuoteCostCalculation {
  return {
    effectiveComparisonCostCents: null,
    annualizedCostCents: null,
    ignoredPercentageDiscounts,
    unverifiedCostEvidenceIds: [...new Set(unverifiedCostEvidenceIds)],
  };
}

function hasTrustedCostEvidence(quote: RawQuoteOutcome, evidenceId: string): boolean {
  const matchingEvidence = quote.evidence.filter((evidence) => evidence.id === evidenceId);
  if (matchingEvidence.length !== 1) return false;

  const [evidence] = matchingEvidence;
  if (evidence.workflowId !== quote.workflowId || evidence.type === "web_source") return false;
  if (PROVIDER_QUOTE_EVIDENCE_TYPES.has(evidence.type)) {
    return evidence.verificationStatus === "provider_confirmed" || (
      quote.simulated &&
      evidence.type === "transcript" &&
      evidence.verificationStatus === "user_confirmed"
    );
  }

  return (
    quote.simulated &&
    evidence.type === "demo_fixture" &&
    ["provider_confirmed", "not_applicable"].includes(evidence.verificationStatus)
  );
}

function toSafeCents(value: bigint): number | null {
  if (value < 0n || value > MAX_SAFE_CENTS) return null;
  return Number(value);
}

function componentTotal(amountCents: number, termCount: number): bigint | null {
  if (!Number.isSafeInteger(amountCents) || !Number.isSafeInteger(termCount)) return null;
  return BigInt(amountCents) * BigInt(termCount);
}

function coversPolicyTerm(
  frequency: RawQuoteOutcome["premiumComponents"][number]["frequency"],
  termCount: number,
  policyTermMonths: number,
): boolean {
  const monthsPerCharge: Partial<Record<typeof frequency, number>> = {
    monthly: 1,
    quarterly: 3,
    semiannual: 6,
    annual: 12,
  };
  if (frequency === "one_time") return true;
  if (frequency === "policy_term") return termCount === 1;

  return monthsPerCharge[frequency] !== undefined && monthsPerCharge[frequency] * termCount === policyTermMonths;
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

/** Uses explicit charge counts and BigInt arithmetic so cent calculations never accumulate float error. */
export function calculateQuoteCost(quote: RawQuoteOutcome): QuoteCostCalculation {
  const ignoredPercentageDiscounts = quote.discounts.some(
    (discount) => discount.applied && discount.amountType === "percentage",
  );

  if (quote.policyTermMonths === null || !Number.isSafeInteger(quote.policyTermMonths)) {
    return unavailableCost(ignoredPercentageDiscounts);
  }

  const requiredPremiums = quote.premiumComponents.filter(
    (component) => component.required && !component.includedInQuotedTotal,
  );
  if (requiredPremiums.length === 0 || requiredPremiums.some((component) => component.conditional)) {
    return unavailableCost(ignoredPercentageDiscounts);
  }

  const includedComponents = [
    ...requiredPremiums,
    ...quote.feeComponents.filter((component) => component.required && !component.includedInQuotedTotal),
    ...quote.taxComponents.filter((component) => component.required && !component.includedInQuotedTotal),
  ];
  if (includedComponents.some((component) => component.conditional)) {
    return unavailableCost(ignoredPercentageDiscounts);
  }
  if (
    includedComponents.some(
      (component) => !coversPolicyTerm(component.frequency, component.termCount, quote.policyTermMonths as number),
    )
  ) {
    return unavailableCost(ignoredPercentageDiscounts);
  }

  const applicableDiscounts = quote.discounts.filter(
    (discount) =>
      discount.amountType === "fixed" &&
      discount.applied &&
      !discount.conditional &&
      discount.eligibilityConfirmed &&
      !discount.continuingEligibilityRequired,
  );
  const unverifiedCostEvidenceIds = [...includedComponents, ...applicableDiscounts]
    .map((item) => item.evidenceId)
    .filter((evidenceId) => !hasTrustedCostEvidence(quote, evidenceId));
  if (unverifiedCostEvidenceIds.length > 0) {
    return unavailableCost(ignoredPercentageDiscounts, unverifiedCostEvidenceIds);
  }

  let effectiveCost = 0n;
  for (const component of includedComponents) {
    const total = componentTotal(component.amountCents, component.termCount);
    if (total === null) {
      return unavailableCost(ignoredPercentageDiscounts);
    }
    effectiveCost += total;
  }

  for (const discount of applicableDiscounts) effectiveCost -= BigInt(discount.amountCents);

  const effectiveComparisonCostCents = toSafeCents(effectiveCost);
  if (effectiveComparisonCostCents === null) {
    return unavailableCost(ignoredPercentageDiscounts);
  }

  const annualized = divideRounded(effectiveCost * 12n, BigInt(quote.policyTermMonths));
  return {
    effectiveComparisonCostCents,
    annualizedCostCents: toSafeCents(annualized),
    ignoredPercentageDiscounts,
    unverifiedCostEvidenceIds: [],
  };
}
