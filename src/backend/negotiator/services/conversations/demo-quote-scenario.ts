import type { QuoteCapture, TranscriptEntry } from "./types";

const POLICY_TERM_MONTHS = 12;
const QUOTE_VALID_UNTIL = "2099-12-31T23:59:59.000Z";
const TRANSCRIPT_RECORDED_AT = "2026-07-18T12:00:00.000Z";

export const DEMO_QUOTE_OFFERS = [
  { topFiveRank: 1, totalPolicyTermCostCents: 148_500 },
  { topFiveRank: 2, totalPolicyTermCostCents: 137_200 },
  { topFiveRank: 3, totalPolicyTermCostCents: 119_900 },
  { topFiveRank: 4, totalPolicyTermCostCents: 141_800 },
  { topFiveRank: 5, totalPolicyTermCostCents: 128_600 },
] as const;

export type DemoQuoteTranscriptLabel =
  | "caller_request"
  | "provider_quote"
  | "caller_confirmation"
  | "provider_confirmation";

export interface DemoQuoteTranscriptEntry extends TranscriptEntry {
  readonly label: DemoQuoteTranscriptLabel;
}

export interface DemoQuoteScenarioCall {
  readonly conversationId: string;
  readonly capture: QuoteCapture;
  readonly transcript: readonly DemoQuoteTranscriptEntry[];
}

export interface DemoQuoteScenarioProvider {
  readonly collectionId: string;
  readonly providerId: string;
  readonly topFiveRank: number | null;
  readonly effectiveDate: string;
}

function formatCurrency(totalPolicyTermCostCents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(totalPolicyTermCostCents / 100);
}

function offerForRank(topFiveRank: number | null): (typeof DEMO_QUOTE_OFFERS)[number] {
  const offer = DEMO_QUOTE_OFFERS.find((candidate) => candidate.topFiveRank === topFiveRank);
  if (!offer) {
    throw new RangeError("The deterministic quote scenario requires Top Five ranks 1 through 5");
  }
  return offer;
}

/**
 * Builds a stable, provider-safe quote conversation. It deliberately omits
 * internal rankings, negotiation targets, and leverage information.
 */
export function buildDemoQuoteScenarioCall(provider: DemoQuoteScenarioProvider): DemoQuoteScenarioCall {
  const offer = offerForRank(provider.topFiveRank);
  const total = formatCurrency(offer.totalPolicyTermCostCents);
  const providerConfirmation = [
    `Provider confirmation: Confirmed simulated ${POLICY_TERM_MONTHS}-month all-in total: ${total}.`,
    "Fees and taxes are included, and the requested coverage matches.",
    `The effective date is ${provider.effectiveDate}; this non-binding quote is valid until ${QUOTE_VALID_UNTIL}.`,
    "Human verification is required before any policy is issued.",
  ].join(" ");

  return Object.freeze({
    conversationId: `simulated-quote-call:${provider.collectionId}:${provider.providerId}`,
    capture: Object.freeze({
      totalPolicyTermCostCents: offer.totalPolicyTermCostCents,
      policyTermMonths: POLICY_TERM_MONTHS,
      feesAndTaxesIncluded: true,
      coverageMatchesRequested: true,
      effectiveDate: provider.effectiveDate,
      quoteValidUntil: QUOTE_VALID_UNTIL,
      providerResponse: providerConfirmation,
    }),
    transcript: Object.freeze([
      Object.freeze({
        label: "caller_request" as const,
        role: "user" as const,
        message: "Caller request: Please provide a simulated 12-month quote for the confirmed customer profile and requested coverage, with one all-in total that includes all fees and taxes.",
        recordedAt: TRANSCRIPT_RECORDED_AT,
      }),
      Object.freeze({
        label: "provider_quote" as const,
        role: "agent" as const,
        message: `Provider total: The simulated 12-month all-in total is ${total}; fees and taxes are included, and the requested coverage matches.`,
        recordedAt: TRANSCRIPT_RECORDED_AT,
      }),
      Object.freeze({
        label: "caller_confirmation" as const,
        role: "user" as const,
        message: `Caller confirmation: Please confirm that ${total} includes all fees and taxes, matches the requested coverage, is effective ${provider.effectiveDate}, and is valid until ${QUOTE_VALID_UNTIL}.`,
        recordedAt: TRANSCRIPT_RECORDED_AT,
      }),
      Object.freeze({
        label: "provider_confirmation" as const,
        role: "agent" as const,
        message: providerConfirmation,
        recordedAt: TRANSCRIPT_RECORDED_AT,
      }),
    ]),
  });
}
