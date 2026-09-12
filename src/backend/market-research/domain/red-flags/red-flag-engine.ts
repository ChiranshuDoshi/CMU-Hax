import {
  ConfirmedQuoteRequestSchema,
  RawQuoteOutcomeSchema,
  type ConfirmedQuoteRequest,
  type NormalizedQuote,
  type RawQuoteOutcome,
} from "@/domain/schemas/person4";
import type { CoverageEquivalenceResult } from "@/domain/equivalence";

export type RedFlag = NormalizedQuote["redFlags"][number];

export interface RedFlagContext {
  coverageEquivalence: CoverageEquivalenceResult;
  effectiveComparisonCostCents: number | null;
  ignoredPercentageDiscounts?: boolean;
  hasUnverifiedCostEvidence?: boolean;
}

const MONTHLY_FREQUENCY = "monthly";
const LARGE_DOWN_PAYMENT_PERCENT = 25n;
const MATERIAL_EXCLUSION_PATTERN = /exclu|not covered|excluded/i;
const MONITORING_PATTERN = /monitor|telematic|tracking|driving app/i;
const UNDERWRITING_PATTERN = /underwrit|price may change|subject to (?:review|approval)/i;
const BUNDLE_PATTERN = /required bundle|must bundle|bundle required/i;
const CANCELLATION_PATTERN = /cancell?ation (?:fee|penalty)|early termination/i;

function hasProviderEvidence(quote: RawQuoteOutcome): boolean {
  return quote.evidence.some(
    (evidence) =>
      evidence.type !== "web_source" &&
      (evidence.type === "provider_document" || evidence.verificationStatus === "provider_confirmed"),
  );
}

function hasFeeDisclosure(quote: RawQuoteOutcome): boolean {
  if (quote.feeComponents.length > 0 || quote.taxComponents.length > 0) return true;
  return quote.evidence.some(
    (evidence) =>
      /fee|tax/i.test(evidence.claimKey) &&
      evidence.type !== "web_source" &&
      ["user_confirmed", "provider_confirmed", "not_applicable"].includes(evidence.verificationStatus),
  );
}

function pushFlag(flags: RedFlag[], code: string, severity: RedFlag["severity"], message: string): void {
  if (!flags.some((flag) => flag.code === code)) flags.push({ code, severity, message });
}

/** Produces stable, ordered flags for a single validated quote. */
export function evaluateRedFlags(
  rawQuote: RawQuoteOutcome,
  confirmedRequest: ConfirmedQuoteRequest,
  context: RedFlagContext,
): RedFlag[];
export function evaluateRedFlags(rawQuote: unknown, confirmedRequest: unknown, context: RedFlagContext): RedFlag[];
export function evaluateRedFlags(rawQuote: unknown, confirmedRequest: unknown, context: RedFlagContext): RedFlag[] {
  const quote = RawQuoteOutcomeSchema.parse(rawQuote);
  const request = ConfirmedQuoteRequestSchema.parse(confirmedRequest);
  const flags: RedFlag[] = [];

  if (quote.effectiveDate === null) pushFlag(flags, "missing_effective_date", "blocking", "Effective date is missing");
  if (quote.expirationDate === null) pushFlag(flags, "missing_expiration_date", "blocking", "Expiration date is missing");
  if (quote.policyTermMonths === null) pushFlag(flags, "missing_term", "blocking", "Policy term is missing");
  if (!hasFeeDisclosure(quote)) pushFlag(flags, "missing_required_fees", "blocking", "Fees and taxes were not confirmed");

  const missingEntities = request.insuredEntityIds.filter((entityId) => !quote.coveredEntityIds.includes(entityId));
  const coverageOmitsEntities = context.coverageEquivalence.differences.some((difference) =>
    /coverage omits insured entities/i.test(difference),
  );
  if (missingEntities.length > 0 || coverageOmitsEntities) {
    const message =
      missingEntities.length > 0
        ? `Missing insured entities: ${missingEntities.join(", ")}`
        : "Required coverage omits an insured entity";
    pushFlag(flags, "missing_insured_entity", "blocking", message);
  }

  if (context.coverageEquivalence.differences.some((difference) => /missing required coverage|limit below/i.test(difference))) {
    pushFlag(flags, "lower_requested_coverage", "blocking", "Quote provides less coverage than requested");
  }
  if (context.coverageEquivalence.differences.some((difference) => /deductible above/i.test(difference))) {
    pushFlag(flags, "higher_deductible", "blocking", "Quote has a deductible above the confirmed maximum");
  }
  if (quote.discounts.some((discount) => discount.applied && (discount.conditional || !discount.eligibilityConfirmed))) {
    pushFlag(flags, "conditional_discount", "warning", "Displayed price uses a conditional or unconfirmed discount");
  }
  if (context.ignoredPercentageDiscounts) {
    pushFlag(flags, "percentage_discount_not_applied", "warning", "Percentage discount lacks a confirmed fixed-cent value");
  }
  if (context.hasUnverifiedCostEvidence) {
    pushFlag(
      flags,
      "unverified_cost_evidence",
      "blocking",
      "A cost component or applied discount lacks provider-confirmed quote evidence",
    );
  }
  if (
    context.effectiveComparisonCostCents === null &&
    quote.policyTermMonths !== null &&
    quote.premiumComponents.some((component) => component.required && !component.includedInQuotedTotal)
  ) {
    pushFlag(flags, "cost_not_comparable", "blocking", "Policy-term cost could not be confirmed deterministically");
  }

  const hasMonthlyPrice = quote.premiumComponents.some((component) => component.frequency === MONTHLY_FREQUENCY);
  if (
    hasMonthlyPrice &&
    quote.downPaymentCents !== null &&
    context.effectiveComparisonCostCents !== null &&
    BigInt(quote.downPaymentCents) * 100n > BigInt(context.effectiveComparisonCostCents) * LARGE_DOWN_PAYMENT_PERCENT
  ) {
    pushFlag(flags, "large_down_payment", "warning", "Monthly price requires a down payment above 25% of policy-term cost");
  }

  if (quote.evidence.some((evidence) => evidence.verificationStatus === "conflicting")) {
    pushFlag(flags, "unresolved_conflict", "blocking", "Quote evidence contains an unresolved conflict");
  }
  if (quote.specificationHash !== request.specificationHash) {
    pushFlag(flags, "different_specification_hash", "blocking", "Quote used a different specification hash");
  }
  if (quote.workflowId !== request.workflowId || quote.confirmedRequestId !== request.id) {
    pushFlag(flags, "different_quote_request", "blocking", "Quote does not belong to the confirmed workflow request");
  }
  if (!hasProviderEvidence(quote)) {
    pushFlag(flags, "unverified_provider_facts", "warning", "Material quote facts lack provider evidence");
  }
  if (!quote.evidence.some((evidence) => evidence.type === "provider_document")) {
    pushFlag(flags, "no_written_quote", "warning", "No provider document supports this quote");
  }
  if (quote.conditions.some((condition) => MONITORING_PATTERN.test(condition))) {
    pushFlag(flags, "monitoring_pricing_unclear", "warning", "Monitoring may affect future pricing");
  }
  if (quote.conditions.some((condition) => UNDERWRITING_PATTERN.test(condition))) {
    pushFlag(flags, "underwriting_unresolved", "warning", "Price may change after underwriting");
  }
  if (quote.conditions.some((condition) => BUNDLE_PATTERN.test(condition))) {
    pushFlag(flags, "required_bundle", "warning", "Quoted price requires a bundle");
  }
  if (quote.conditions.some((condition) => CANCELLATION_PATTERN.test(condition))) {
    pushFlag(flags, "cancellation_penalty", "warning", "Quote includes a cancellation penalty");
  }
  if (
    quote.exclusions.some((exclusion) => MATERIAL_EXCLUSION_PATTERN.test(exclusion)) ||
    quote.coverageItems.some((coverage) => coverage.exclusions.length > 0)
  ) {
    pushFlag(flags, "material_exclusion", "warning", "Quote includes a material exclusion");
  }

  return flags;
}

function medianTwice(costs: readonly number[]): bigint {
  const sorted = [...costs].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return BigInt(sorted[middle]) * 2n;
  return BigInt(sorted[middle - 1]) + BigInt(sorted[middle]);
}

/** Adds exact >30% comparable-median outlier flags without mutating the input quotes. */
export function addComparableMedianOutlierFlags(quotes: readonly NormalizedQuote[]): NormalizedQuote[] {
  const comparable = quotes.filter(
    (quote) =>
      quote.effectiveComparisonCostCents !== null &&
      ["equivalent", "better_than_requested"].includes(quote.coverageEquivalence.status),
  );
  if (comparable.length < 2) return quotes.map((quote) => ({ ...quote, redFlags: [...quote.redFlags] }));

  const doubledMedian = medianTwice(comparable.map((quote) => quote.effectiveComparisonCostCents as number));
  return quotes.map((quote) => {
    const flags = [...quote.redFlags];
    if (
      quote.effectiveComparisonCostCents !== null &&
      ["equivalent", "better_than_requested"].includes(quote.coverageEquivalence.status)
    ) {
      const doubledCostTimesTen = BigInt(quote.effectiveComparisonCostCents) * 20n;
      if (doubledCostTimesTen < doubledMedian * 7n) {
        pushFlag(flags, "below_comparable_median", "warning", "Cost is more than 30% below the comparable median");
      } else if (doubledCostTimesTen > doubledMedian * 13n) {
        pushFlag(flags, "above_comparable_median", "warning", "Cost is more than 30% above the comparable median");
      }
    }
    return { ...quote, redFlags: flags };
  });
}

export class RedFlagEngine {
  evaluate(rawQuote: unknown, confirmedRequest: unknown, context: RedFlagContext): RedFlag[] {
    return evaluateRedFlags(rawQuote, confirmedRequest, context);
  }

  evaluateBatch(quotes: readonly NormalizedQuote[]): NormalizedQuote[] {
    return addComparableMedianOutlierFlags(quotes);
  }
}
