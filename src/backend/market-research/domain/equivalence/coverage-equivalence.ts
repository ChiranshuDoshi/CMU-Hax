import {
  ConfirmedQuoteRequestSchema,
  RawQuoteOutcomeSchema,
  type ConfirmedQuoteRequest,
  type NormalizedQuote,
  type RawQuoteOutcome,
} from "@/domain/schemas/person4";
import { getInsuranceLineConfig } from "@/config/insurance-lines";

export type CoverageEquivalenceResult = NormalizedQuote["coverageEquivalence"];

const FEE_CLAIM_PATTERN = /(?:^|[._-])(fee|fees|tax|taxes)(?:$|[._-])/i;
const MATERIAL_TERM_PATTERN = /underwrit|price may change|subject to (?:review|approval)|quote range/i;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isConfirmedFeeDisclosure(quote: RawQuoteOutcome): boolean {
  if (quote.feeComponents.length > 0 || quote.taxComponents.length > 0) return true;

  return quote.evidence.some(
    (evidence) =>
      FEE_CLAIM_PATTERN.test(evidence.claimKey) &&
      evidence.type !== "web_source" &&
      ["user_confirmed", "provider_confirmed", "not_applicable"].includes(evidence.verificationStatus),
  );
}

function hasMaterialTermMismatch(quote: RawQuoteOutcome): boolean {
  if (!quote.effectiveDate || !quote.expirationDate || quote.policyTermMonths === null) return false;

  const effectiveDate = new Date(`${quote.effectiveDate}T00:00:00.000Z`);
  const expectedExpiration = new Date(effectiveDate);
  expectedExpiration.setUTCMonth(expectedExpiration.getUTCMonth() + quote.policyTermMonths);
  const expirationDate = new Date(`${quote.expirationDate}T00:00:00.000Z`);
  const differenceDays = Math.abs(expirationDate.getTime() - expectedExpiration.getTime()) / 86_400_000;

  // Policy expiration dates commonly use the day before an anniversary.
  return differenceDays > 3;
}

function compareRequiredCoverage(
  request: ConfirmedQuoteRequest,
  quote: RawQuoteOutcome,
): { worse: string[]; missing: string[]; better: boolean } {
  const worse: string[] = [];
  const missing: string[] = [];
  let better = false;

  const configuredDifferences = request.insuranceLines.flatMap((line) =>
    getInsuranceLineConfig(line).compareCoverage(request, quote.coverageItems),
  );

  for (const difference of configuredDifferences) {
    const coverageCode = difference.split(": ")[1];
    const offeredItems = quote.coverageItems.filter(
      (coverage) => coverage.coverageCode === coverageCode && coverage.included,
    );
    if (/coverage limit below minimum/i.test(difference) && offeredItems.some((coverage) => coverage.limitCents === null)) {
      missing.push(`Coverage limit is unknown: ${coverageCode}`);
    } else if (
      /deductible above maximum/i.test(difference) &&
      offeredItems.some((coverage) => coverage.deductibleCents === null)
    ) {
      missing.push(`Coverage deductible is unknown: ${coverageCode}`);
    } else {
      worse.push(difference);
    }
  }

  for (const required of request.requestedCoverage.filter((coverage) => coverage.required)) {
    const offeredItems = quote.coverageItems.filter(
      (coverage) => coverage.coverageCode === required.coverageCode && coverage.included,
    );

    if (offeredItems.length === 0) {
      continue;
    }

    const coveredEntities = new Set(offeredItems.flatMap((coverage) => coverage.insuredEntityIds));
    const missingEntities = required.insuredEntityIds.filter((entityId) => !coveredEntities.has(entityId));
    if (
      missingEntities.length > 0 &&
      !worse.some((difference) => difference === `Coverage omits insured entities: ${required.coverageCode}`)
    ) {
      worse.push(`Coverage omits insured entities: ${required.coverageCode} (${missingEntities.join(", ")})`);
    }

    if (required.minimumLimitCents !== null) {
      const limits = offeredItems.map((coverage) => coverage.limitCents);
      if (!limits.some((limit) => limit === null)) {
        const lowestLimit = Math.min(...(limits as number[]));
        if (lowestLimit > required.minimumLimitCents) better = true;
      }
    }

    if (required.maximumDeductibleCents !== null) {
      const deductibles = offeredItems.map((coverage) => coverage.deductibleCents);
      if (!deductibles.some((deductible) => deductible === null)) {
        const highestDeductible = Math.max(...(deductibles as number[]));
        if (highestDeductible < required.maximumDeductibleCents) better = true;
      }
    }
  }

  return { worse, missing, better };
}

/** Compares an untrusted quote outcome against the immutable confirmed request. */
export function evaluateCoverageEquivalence(
  rawQuote: RawQuoteOutcome,
  confirmedRequest: ConfirmedQuoteRequest,
): CoverageEquivalenceResult;
export function evaluateCoverageEquivalence(rawQuote: unknown, confirmedRequest: unknown): CoverageEquivalenceResult;
export function evaluateCoverageEquivalence(rawQuote: unknown, confirmedRequest: unknown): CoverageEquivalenceResult {
  const quote = RawQuoteOutcomeSchema.parse(rawQuote);
  const request = ConfirmedQuoteRequestSchema.parse(confirmedRequest);
  const incomparable: string[] = [];
  const worse: string[] = [];
  const missing: string[] = [];
  const partial: string[] = [];

  if (quote.workflowId !== request.workflowId) incomparable.push("Quote belongs to a different workflow");
  if (quote.confirmedRequestId !== request.id) incomparable.push("Quote references a different confirmed request");
  if (quote.specificationHash !== request.specificationHash) incomparable.push("Different specification hash");

  const missingQuoteEntities = request.insuredEntityIds.filter((entityId) => !quote.coveredEntityIds.includes(entityId));
  if (missingQuoteEntities.length > 0) worse.push(`Missing insured entities: ${missingQuoteEntities.join(", ")}`);

  const coverageComparison = compareRequiredCoverage(request, quote);
  worse.push(...coverageComparison.worse);
  missing.push(...coverageComparison.missing);

  if (quote.policyTermMonths === null) missing.push("Policy term is unknown");
  if (quote.effectiveDate === null) missing.push("Effective date is unknown");
  if (quote.expirationDate === null) missing.push("Expiration date is unknown");
  if (quote.premiumComponents.filter((component) => component.required && !component.includedInQuotedTotal).length === 0) {
    missing.push("Required premium is unknown");
  }
  if (!isConfirmedFeeDisclosure(quote)) missing.push("Material fees and taxes are unknown");
  if (hasMaterialTermMismatch(quote)) partial.push("Policy term conflicts with the effective and expiration dates");

  if (quote.discounts.some((discount) => discount.applied && (discount.conditional || !discount.eligibilityConfirmed))) {
    partial.push("Applied price depends on a conditional or unconfirmed discount");
  }
  if (quote.premiumComponents.some((component) => component.required && component.conditional)) {
    partial.push("Required premium remains conditional");
  }
  if (quote.exclusions.length > 0 || quote.coverageItems.some((coverage) => coverage.included && coverage.exclusions.length > 0)) {
    partial.push("Quote contains material exclusions requiring review");
  }
  if (quote.conditions.some((condition) => MATERIAL_TERM_PATTERN.test(condition))) {
    partial.push("Underwriting or future pricing remains unresolved");
  }
  if (quote.evidence.some((evidence) => evidence.verificationStatus === "conflicting")) {
    partial.push("Quote evidence contains an unresolved conflict");
  }
  if (quote.status !== "complete") missing.push(`Quote status is ${quote.status}`);

  if (incomparable.length > 0) return { status: "not_comparable", differences: unique(incomparable) };
  if (worse.length > 0) return { status: "worse_than_requested", differences: unique([...worse, ...missing, ...partial]) };
  if (missing.length > 0) return { status: "missing_information", differences: unique([...missing, ...partial]) };
  if (partial.length > 0) return { status: "partially_comparable", differences: unique(partial) };
  if (coverageComparison.better) {
    return { status: "better_than_requested", differences: ["Required coverage is better than requested"] };
  }

  return { status: "equivalent", differences: [] };
}

export class CoverageEquivalenceEngine {
  evaluate(rawQuote: unknown, confirmedRequest: unknown): CoverageEquivalenceResult {
    return evaluateCoverageEquivalence(rawQuote, confirmedRequest);
  }
}
