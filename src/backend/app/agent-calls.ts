/**
 * Simulated first-round agent calls for the Atrium demo.
 *
 * After the user picks which hotels to call, Atrium "phones" each one and
 * comes back with a negotiated group rate below the best aggregator price. No
 * real call is placed here — the quote is derived deterministically from the
 * hotel id so a given hotel always returns the same number, and the dialogue is
 * rendered to audio with Grok TTS (see `negotiation-recording.ts`).
 *
 * The live, user-driven negotiation in `negotiation-call.ts` is unchanged; this
 * stage only produces the starting rates the user chooses between.
 */
import { createHash } from "node:crypto";

import type { AggregatorPriceView, QuoteView } from "./store";

/** Reduction band the simulated agent achieves against the aggregator price. */
const MIN_REDUCTION_PCT = 10;
const MAX_REDUCTION_PCT = 18;

export interface AgentCallLine {
  speaker: "agent" | "hotel";
  text: string;
}

export interface AgentCallView {
  providerId: string;
  quoteId: string;
  providerName: string;
  /** Best aggregator nightly rate the agent negotiated against. */
  aggregatorLowCents: number;
  aggregatorName: string;
  /** Nightly rate the agent secured on the call. */
  agentQuoteCents: number;
  savedCents: number;
  savedPct: number;
  concession: string;
  roomType: string | null;
  rooms: number;
  nights: number;
  totalSavedCents: number;
  script: AgentCallLine[];
  recordingAvailable: boolean;
  /** Grok TTS voice used for the hotel-sales side of this recording. */
  hotelVoice: string;
}

/** Hotel-rep voices. Atrium stays on `rex` so each call sounds like a new person. */
export const HOTEL_REP_VOICES = ["eve", "ara", "sal", "leo"] as const;

/** Stable 0–1 value derived from a hotel id, so rates never jitter. */
function seededFraction(seed: string): number {
  const digest = createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

/** Deterministic reduction percentage inside the demo band. */
export function reductionPctFor(seed: string): number {
  const span = MAX_REDUCTION_PCT - MIN_REDUCTION_PCT;
  return Math.round((MIN_REDUCTION_PCT + seededFraction(seed) * span) * 10) / 10;
}

const CONCESSIONS = [
  "Group rate with breakfast held for 24 guests",
  "Resort fee waived for the full block",
  "Breakfast plus late checkout for the block",
  "Group discount with complimentary meeting room",
  "Waived amenity fee and upgraded two rooms",
];

function pickConcession(seed: string): string {
  const digest = createHash("sha256").update(`${seed}:concession`).digest();
  return CONCESSIONS[digest[0] % CONCESSIONS.length]!;
}

function dollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

/** Spoken form so TTS reads "$146" as words rather than symbols. */
function spokenDollars(cents: number): string {
  return `${Math.round(cents / 100)} dollars`;
}

/**
 * Two-party negotiation dialogue. Kept short (six turns) so a recording
 * synthesizes in a few seconds, and grounded in the real numbers on screen.
 */
export function buildAgentCallScript(input: {
  providerName: string;
  aggregatorLowCents: number;
  aggregatorName: string;
  agentQuoteCents: number;
  concession: string;
  rooms: number;
  nights: number;
  roomType: string | null;
}): AgentCallLine[] {
  const room = input.roomType?.toLowerCase() || "standard";
  return [
    {
      speaker: "hotel",
      text: `Good afternoon, ${input.providerName}, group sales. How can I help you?`,
    },
    {
      speaker: "agent",
      text: `Hi, this is Atrium calling on behalf of a group organizer. We need ${input.rooms} ${room} rooms for ${input.nights} nights. ${input.aggregatorName} is showing ${spokenDollars(input.aggregatorLowCents)} per night. What can you do for a block that size?`,
    },
    {
      speaker: "hotel",
      text: `That public rate is for single rooms. For ${input.rooms} rooms I can look at our group tier. Are the dates firm?`,
    },
    {
      speaker: "agent",
      text: `The dates are firm and the group is ready to commit. We're comparing several properties on the same dates and inclusions, so the nightly rate is what decides it.`,
    },
    {
      speaker: "hotel",
      text: `Understood. I can bring it to ${spokenDollars(input.agentQuoteCents)} per night for the block, and I'll include ${input.concession.toLowerCase()}. Every other inclusion stays exactly as quoted.`,
    },
    {
      speaker: "agent",
      text: `That works as a starting point. I'll hold ${spokenDollars(input.agentQuoteCents)} per night with those inclusions and bring it back to the organizer for a final decision.`,
    },
  ];
}

/**
 * Builds the simulated agent quote for one shortlisted hotel. Returns null when
 * the hotel has no usable nightly rate to negotiate against.
 */
export function buildAgentCall(
  quote: QuoteView,
  options: { rooms: number; nights: number },
): AgentCallView | null {
  const aggregators = quote.aggregators ?? [];
  const cheapest = aggregators.reduce<AggregatorPriceView | null>(
    (best, current) =>
      current.nightlyCents > 0 && (!best || current.nightlyCents < best.nightlyCents) ? current : best,
    null,
  );
  const aggregatorLowCents =
    cheapest?.nightlyCents ?? quote.effectiveComparisonCostCents ?? quote.annualizedCostCents ?? 0;
  if (aggregatorLowCents <= 0) return null;

  // Round to whole dollars so the spoken rate matches the displayed rate, then
  // report the reduction actually achieved rather than the requested one.
  const targetPct = reductionPctFor(quote.providerId);
  const agentQuoteCents = Math.max(
    100,
    Math.round((aggregatorLowCents * (100 - targetPct)) / 100 / 100) * 100,
  );
  const savedCents = aggregatorLowCents - agentQuoteCents;
  const savedPct = Math.round((savedCents / aggregatorLowCents) * 1000) / 10;
  const concession = pickConcession(quote.providerId);

  return {
    providerId: quote.providerId,
    quoteId: quote.quoteId,
    providerName: quote.providerName,
    aggregatorLowCents,
    aggregatorName: cheapest?.name ?? "Market estimate",
    agentQuoteCents,
    savedCents,
    savedPct,
    concession,
    roomType: quote.roomType,
    rooms: options.rooms,
    nights: options.nights,
    totalSavedCents: savedCents * options.rooms * options.nights,
    script: buildAgentCallScript({
      providerName: quote.providerName,
      aggregatorLowCents,
      aggregatorName: cheapest?.name ?? "the public rate",
      agentQuoteCents,
      concession,
      rooms: options.rooms,
      nights: options.nights,
      roomType: quote.roomType,
    }),
    recordingAvailable: false,
    hotelVoice: "ara",
  };
}

/**
 * Gives each hotel a different sales-rep voice. The first four shortlisted
 * hotels get unique voices; extras wrap.
 */
export function assignHotelVoices(providerIds: readonly string[]): Map<string, string> {
  const assigned = new Map<string, string>();
  const used = new Set<string>();
  for (const id of [...providerIds].sort((left, right) => left.localeCompare(right))) {
    const preferred = [...HOTEL_REP_VOICES]
      .map((voice) => ({ voice, rank: seededFraction(`${id}:${voice}`) }))
      .sort((left, right) => left.rank - right.rank);
    const voice =
      preferred.find((item) => !used.has(item.voice))?.voice ??
      HOTEL_REP_VOICES[assigned.size % HOTEL_REP_VOICES.length]!;
    used.add(voice);
    assigned.set(id, voice);
  }
  return assigned;
}

/** Human-readable summary used in the UI and transcript panels. */
export function summarizeAgentCall(call: AgentCallView): string {
  return `${call.providerName} moved from ${dollars(call.aggregatorLowCents)} to ${dollars(
    call.agentQuoteCents,
  )} per night (${call.savedPct}% under ${call.aggregatorName}). ${call.concession}.`;
}
