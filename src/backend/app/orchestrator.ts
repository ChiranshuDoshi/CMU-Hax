/**
 * BFF orchestration for the integrated demo (Person 2).
 *
 * Drives the proven pipeline in-process — research → 5-quote simulation →
 * recommendation/handoff → negotiation — holding any credentials server-side and
 * projecting results into UI-friendly (whole-dollar) snapshots the browser polls.
 */
import { join } from "node:path";

import { capabilities } from "@/config/env";
import { rankResearchResult } from "@/domain/research";
import {
  HotelQueritResearchProvider,
  OfflineHotelResearchProvider,
  type HotelPriceHint,
} from "@/integrations/querit";
import {
  QuoteCollectionService,
  type QuoteCollectionContextLoader,
} from "@/server/services/conversations";
import type {
  NegotiationHandoff,
  NormalizedQuote,
  ProviderRankingResult,
  Recommendation,
} from "@/domain/schemas/person4";

import {
  assignHotelVoices,
  buildAgentCall,
  summarizeAgentCall,
  type AgentCallView,
} from "./agent-calls";
import { buildConfirmedRequest, type CarProfile } from "./build-request";
import { deriveLiveCallOutcome, secondsToClock } from "./live-call-outcome";
import { isRecordingConfigured, renderNegotiationRecording } from "./negotiation-recording";
import {
  fetchConversation,
  isLiveNegotiationConfigured,
  issueNegotiationCredential,
  NegotiationCallError,
  type NegotiationCredential,
  type NegotiatorSessionVars,
} from "./negotiation-call";
import {
  touch,
  type Account,
  type NegotiationStepView,
  type QuoteView,
  type TranscriptLineView,
  type WorkflowState,
} from "./store";

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

const MAX_DISCOUNT_RATE = 0.15; // negotiation can shave at most ~15% in the demo
const STAY_NIGHTS = 3; // demo stay length used for group savings totals

// ── Stage 1: market research → Top 5 ────────────────────────────────────────
/** Destination-aware offline hotels (demo mode, or when live search finds none). */
async function offlineHotelRanking(
  request: ReturnType<typeof buildConfirmedRequest>,
  profile: CarProfile,
  evaluatedAt: string,
): Promise<ProviderRankingResult> {
  const result = await new OfflineHotelResearchProvider(profile).research({
    quoteRequest: request,
    retrievedAt: evaluatedAt,
  });
  return rankResearchResult(request, result, evaluatedAt);
}

function parsePriceHintsFromBriefs(
  ranking: ProviderRankingResult,
): Map<string, HotelPriceHint> {
  const map = new Map<string, HotelPriceHint>();
  for (const brief of ranking.selected) {
    const nightlyRaw = brief.publicDiscounts.find((item) => item.startsWith("aggregator_nightly_cents:"));
    const roomRaw = brief.publicDiscounts.find((item) => item.startsWith("room_type:"));
    const nightlyCents = nightlyRaw ? Number(nightlyRaw.split(":")[1]) : null;
    const aggregators = brief.publicDiscounts
      .filter((item) => item.startsWith("agg:"))
      .map((item) => {
        const [, rest = ""] = item.split("agg:");
        const eq = rest.lastIndexOf("=");
        const name = eq >= 0 ? rest.slice(0, eq) : rest;
        const cents = eq >= 0 ? Number(rest.slice(eq + 1)) : NaN;
        return {
          name,
          nightlyCents: Number.isFinite(cents) ? cents : nightlyCents ?? 0,
          url: brief.sources.find((source) => source.publisher === name)?.url ?? brief.website ?? "",
          domain: brief.sources.find((source) => source.publisher === name)?.domain ?? "",
        };
      })
      .filter((item) => item.name && item.nightlyCents > 0);

    if (nightlyCents != null && Number.isFinite(nightlyCents) && nightlyCents > 0) {
      map.set(brief.providerId, {
        providerId: brief.providerId,
        nightlyCents,
        roomType: roomRaw?.slice("room_type:".length) || "Deluxe",
        aggregators,
      });
    }
  }
  return map;
}

export async function runResearch(workflow: WorkflowState, profile: CarProfile): Promise<void> {
  const request = buildConfirmedRequest(workflow.workflowId, profile);
  const evaluatedAt = new Date().toISOString();
  const caps = capabilities();

  let ranking: ProviderRankingResult | null = null;
  let live = false;
  let priceHints = new Map<string, HotelPriceHint>();

  if (caps.hasQuerit) {
    try {
      const hotelProvider = new HotelQueritResearchProvider(profile, {
        apiKey: process.env.QUERIT_API_KEY,
        baseUrl: process.env.QUERIT_BASE_URL,
      });
      const result = await hotelProvider.research({ quoteRequest: request, retrievedAt: evaluatedAt });
      const ranked = rankResearchResult(request, result, evaluatedAt);
      if (ranked.selected.length >= 1) {
        ranking = ranked;
        live = true;
        priceHints = new Map(hotelProvider.getPriceHints().map((hint) => [hint.providerId, hint]));
        if (priceHints.size === 0) priceHints = parsePriceHintsFromBriefs(ranked);
      } else {
        console.warn("[atrium] Querit hotel search produced no eligible hotels", result.warnings);
      }
    } catch (error) {
      console.warn(
        "[atrium] Querit hotel search failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (!ranking) {
    ranking = await offlineHotelRanking(request, profile, evaluatedAt);
    priceHints = parsePriceHintsFromBriefs(ranking);
  }

  workflow.profile = profile as unknown as Record<string, unknown>;
  workflow.confirmedRequest = request;
  workflow.ranking = ranking;
  workflow.research = {
    live,
    evaluatedAt,
    providers: ranking.selected.map((brief) => {
      const hint = priceHints.get(brief.providerId);
      return {
        providerId: brief.providerId,
        providerName: brief.providerName,
        rank: brief.topFiveRank ?? 0,
        rating: brief.rating,
        reviewCount: brief.reviewCount,
        website: brief.website,
        eligibility: brief.eligibilityStatus,
        nightlyCents: hint?.nightlyCents ?? null,
        roomType: hint?.roomType ?? null,
        aggregators: (hint?.aggregators ?? []).map((agg) => ({
          name: agg.name,
          nightlyCents: agg.nightlyCents,
          url: agg.url,
        })),
      };
    }),
  };
  workflow.quotes = null;
  workflow.recommendedQuoteId = null;
  workflow.handoff = null;
  workflow.negotiation = null;
  workflow.stage = "research_ready";
  touch(workflow);
}

// ── Stage 2: call all 5 → normalized quotes + recommendation/handoff ────────
function buildProviderBrief(workflow: WorkflowState): string {
  const profile = (workflow.profile ?? {}) as Record<string, unknown>;
  const request = workflow.confirmedRequest;
  const stayHint = `${profile.make ?? ""} ${profile.model ?? ""}`
    .replace(/\s+/g, " ")
    .trim();
  const rooms = profile.annualMileage ? `${profile.annualMileage} rooms` : "group room block";
  const parts = [
    `Group seeking hotel rates in ${request?.state ?? "IL"} ${request?.zipCode ?? "60601"}.`,
    stayHint ? `Stay preference: ${stayHint}.` : "",
    `Group size: ${rooms}.`,
    "Stay baseline: breakfast included, pool and gym access, Wi-Fi included, 14-day flexible cancellation.",
    `Desired check-in ${request?.desiredEffectiveDate ?? "on file"}.`,
    "Do not disclose payment details, government identifiers, or any private negotiation target.",
  ];
  const brief = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return brief.slice(0, 8_000) || "Group hotel booking quote request.";
}

function monthlyCents(quote: NormalizedQuote): number | null {
  const annual = quote.annualizedCostCents ?? quote.effectiveComparisonCostCents;
  return annual === null ? null : Math.round(annual / 12);
}

export async function collectQuotes(workflow: WorkflowState): Promise<void> {
  const request = workflow.confirmedRequest;
  const ranking = workflow.ranking;
  if (!request || !ranking) {
    throw new AppError("RESEARCH_REQUIRED", "Run market research before collecting quotes.");
  }

  const collectionId = `col_${workflow.workflowId}`.slice(0, 128);
  const session = {
    collectionId,
    quoteRequest: request,
    providerRanking: ranking,
    providerSafeBrief: buildProviderBrief(workflow),
    artifactDirectory: join(process.cwd(), ".artifacts", "app", workflow.workflowId),
    createdAt: new Date().toISOString(),
  };
  const loader: QuoteCollectionContextLoader = {
    async load() {
      return session;
    },
  };

  let captured: {
    normalized: readonly NormalizedQuote[];
    recommendation: Recommendation;
    handoff: NegotiationHandoff;
  } | null = null;

  // A capturing persister keeps everything in memory (no disk artifacts).
  const service = new QuoteCollectionService(loader, async (_collection, _raw, normalized, recommendation, handoff) => {
    captured = {
      normalized,
      recommendation: recommendation as Recommendation,
      handoff,
    };
  });

  await service.simulate({
    collectionId,
    workflowId: request.workflowId,
    specificationHash: request.specificationHash,
  });

  if (!captured) {
    throw new AppError("QUOTE_COLLECTION_FAILED", "The quote collection did not produce a result.", 500);
  }
  const { normalized, recommendation, handoff } = captured as {
    normalized: readonly NormalizedQuote[];
    recommendation: Recommendation;
    handoff: NegotiationHandoff;
  };

  const byProvider = new Map(normalized.map((quote) => [quote.providerId, quote]));
  const recommendedQuoteId = recommendation.recommendedQuoteId;
  const priceHints = parsePriceHintsFromBriefs(ranking);
  for (const provider of workflow.research?.providers ?? []) {
    if (provider.nightlyCents != null) {
      priceHints.set(provider.providerId, {
        providerId: provider.providerId,
        nightlyCents: provider.nightlyCents,
        roomType: provider.roomType ?? "Deluxe",
        aggregators: provider.aggregators.map((agg) => ({
          name: agg.name,
          nightlyCents: agg.nightlyCents,
          url: agg.url,
          domain: "",
        })),
      });
    }
  }

  const quotes: QuoteView[] = ranking.selected.map((brief) => {
    const quote = byProvider.get(brief.providerId);
    const hint = priceHints.get(brief.providerId);
    const liveNightly = hint?.nightlyCents ?? null;
    const annualized =
      liveNightly ??
      quote?.annualizedCostCents ??
      quote?.effectiveComparisonCostCents ??
      null;
    return {
      quoteId: quote?.quoteId ?? `${brief.providerId}-quote`,
      providerId: brief.providerId,
      providerName: brief.providerName,
      rank: brief.topFiveRank ?? 0,
      rating: brief.rating,
      reviewCount: brief.reviewCount,
      effectiveComparisonCostCents: annualized,
      annualizedCostCents: annualized,
      monthlyCents: annualized === null ? null : Math.round(annualized / 12),
      deductibleCents: 50_000,
      coverageEquivalence: quote?.coverageEquivalence.status ?? "missing_information",
      redFlags: quote?.redFlags?.map((flag) => flag.message) ?? [],
      recommended: quote?.quoteId === recommendedQuoteId,
      roomType: hint?.roomType ?? null,
      aggregators: (hint?.aggregators ?? []).map((agg) => ({
        name: agg.name,
        nightlyCents: agg.nightlyCents,
        url: agg.url,
      })),
    };
  });

  // Prefer the lowest aggregator-backed nightly rate as the recommendation.
  const lowest = [...quotes].sort(
    (a, b) => (a.annualizedCostCents ?? 9e9) - (b.annualizedCostCents ?? 9e9),
  )[0];
  if (lowest) {
    for (const quote of quotes) quote.recommended = quote.quoteId === lowest.quoteId;
    workflow.recommendedQuoteId = lowest.quoteId;
  } else {
    workflow.recommendedQuoteId = recommendedQuoteId;
  }

  workflow.quotes = quotes;
  workflow.handoff = handoff;
  workflow.negotiation = null;
  workflow.stage = "quotes_ready";
  touch(workflow);
}

// ── Stage 3: negotiate the selected (lowest) quote toward the private target ─
function simulateConcession(
  originalCents: number,
  targetCents: number,
): { finalCents: number; steps: NegotiationStepView[]; targetMet: boolean } {
  const floorCents = Math.round(originalCents * (1 - MAX_DISCOUNT_RATE));
  let finalCents: number;
  let targetMet: boolean;

  if (targetCents >= originalCents) {
    // Already at/under target — apply a small courtesy reduction.
    finalCents = Math.round(originalCents * 0.97);
    targetMet = true;
  } else {
    finalCents = Math.max(targetCents, floorCents);
    targetMet = finalCents <= targetCents;
  }

  const drop = originalCents - finalCents;
  const p1 = originalCents - Math.round(drop * 0.55);
  const p2 = originalCents - Math.round(drop * 0.85);

  const steps: NegotiationStepView[] = [
    { label: "Opening group rate", amountCents: originalCents, time: "00:00", impactCents: null },
    { label: "Competing group offer matched", amountCents: p1, time: "01:52", impactCents: p1 - originalCents },
    { label: "Breakfast package added", amountCents: p2, time: "03:29", impactCents: p2 - p1 },
    { label: "Final group rate approved", amountCents: finalCents, time: "06:11", impactCents: finalCents - p2 },
  ];
  return { finalCents, steps, targetMet };
}

function buildTranscript(
  providerName: string,
  finalCents: number,
  targetMet: boolean,
): TranscriptLineView[] {
  const finalText = `$${(finalCents / 100).toLocaleString("en-US")}`;
  return [
    { time: "05:02", speaker: "Atrium", text: "Thank you for reviewing our group booking request." },
    { time: "05:10", speaker: providerName, text: "I can include the daily breakfast package for your group." },
    { time: "05:36", speaker: providerName, text: `That brings the final group rate to ${finalText} per room, per night.` },
    {
      time: "05:41",
      speaker: "Atrium",
      text: targetMet
        ? "That is within our target. The room count and amenities are unchanged, correct?"
        : "Understood. Confirming the stay details are unchanged at that rate?",
    },
    { time: "05:45", speaker: providerName, text: "Correct. The dates, rooms, and included facilities remain unchanged." },
  ];
}

function resolveSelectedQuote(workflow: WorkflowState, selectedQuoteId?: string): QuoteView {
  const quotes = workflow.quotes;
  if (!quotes || !workflow.recommendedQuoteId) {
    throw new AppError("QUOTES_REQUIRED", "Collect quotes before negotiating.");
  }
  const chosenId = selectedQuoteId ?? workflow.recommendedQuoteId;
  const selected =
    quotes.find((quote) => quote.quoteId === chosenId) ??
    quotes.find((quote) => quote.recommended) ??
    quotes[0];
  if (!selected) throw new AppError("QUOTES_REQUIRED", "No quote is available to negotiate.");
  return selected;
}

function quoteOriginalCents(workflow: WorkflowState, quote: QuoteView): number {
  const agentQuote = workflow.agentCalls?.find((call) => call.quoteId === quote.quoteId)?.agentQuoteCents;
  const cents = agentQuote || quote.effectiveComparisonCostCents || quote.annualizedCostCents || 0;
  if (cents <= 0) throw new AppError("QUOTE_PRICE_MISSING", "The selected quote has no comparable price.");
  return cents;
}

/** Simulated concession path (no phone / live calling not configured). */
export function negotiate(
  workflow: WorkflowState,
  targetAmountCents: number,
  selectedQuoteId?: string,
): void {
  const selected = resolveSelectedQuote(workflow, selectedQuoteId);
  const originalCents = quoteOriginalCents(workflow, selected);
  const { finalCents, steps, targetMet } = simulateConcession(originalCents, targetAmountCents);
  const savingsCents = Math.max(0, originalCents - finalCents);

  workflow.negotiation = {
    selectedQuoteId: selected.quoteId,
    providerId: selected.providerId,
    providerName: selected.providerName,
    targetAmountCents,
    originalCents,
    finalCents,
    savingsCents,
    savingsPct: originalCents > 0 ? Math.round((savingsCents / originalCents) * 1000) / 10 : 0,
    targetMet,
    steps,
    transcript: buildTranscript(selected.providerName, finalCents, targetMet),
    mode: "simulated",
    callStatus: "idle",
    conversationId: null,
    callSid: null,
    recordingAvailable: false,
    callSummary: null,
    errorMessage: null,
    recordedFinalCents: null,
  };
  workflow.stage = "result";
  touch(workflow);
}

// ── Live negotiation call (Grok Voice in-browser) ───────────────────────────
function buildNegotiatorVars(
  account: Account,
  selected: QuoteView,
  originalCents: number,
): NegotiatorSessionVars {
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  // Provider-safe context only — the private target is never sent.
  return {
    userDisplayName: account.displayName,
    providerName: selected.providerName,
    policyPeriodCost: money(originalCents),
    monthlyCost: money(Math.round(originalCents / 12)),
    verifiedComparableMonthly: "not available",
    allowedLeverageText: "No verified comparable group hotel offer is available; do not cite competitor pricing.",
    coverageSummary:
      "Group stay: 24 deluxe rooms, 3 nights in Chicago, breakfast included, pool & gym access, Wi-Fi included. Keep dates, room count, and inclusions unchanged.",
    quoteDisclaimer: "This simulated group rate is non-binding and requires human verification.",
  };
}

function buildDynamicVariables(
  account: Account,
  selected: QuoteView,
  originalCents: number,
): Record<string, string | number | boolean> {
  const vars = buildNegotiatorVars(account, selected, originalCents);
  return {
    user_display_name: vars.userDisplayName,
    selected_provider_name: vars.providerName,
    policy_period_effective_cost: vars.policyPeriodCost,
    derived_monthly_effective_cost: vars.monthlyCost,
    verified_comparable_monthly_effective_cost: vars.verifiedComparableMonthly,
    allowed_leverage_text: vars.allowedLeverageText,
    coverage_summary: vars.coverageSummary,
    quote_disclaimer: vars.quoteDisclaimer,
    simulated: true,
    requires_human_verification: true,
  };
}

export interface StartNegotiationCallResult {
  credential: NegotiationCredential;
  dynamicVariables: Record<string, string | number | boolean>;
}

/**
 * Begins an in-app voice negotiation on the selected (default: lowest) quote:
 * issues a Grok Voice ephemeral credential and moves the negotiation to a
 * "ringing" state. The browser answers and talks to Grok directly.
 */
export async function startNegotiationCall(
  workflow: WorkflowState,
  account: Account,
  targetAmountCents: number,
  selectedQuoteId?: string,
): Promise<StartNegotiationCallResult> {
  const selected = resolveSelectedQuote(workflow, selectedQuoteId);
  const originalCents = quoteOriginalCents(workflow, selected);
  if (!isLiveNegotiationConfigured()) {
    throw new AppError("NOT_CONFIGURED", "In-app voice negotiation is not configured.", 503);
  }

  const dynamicVariables = buildDynamicVariables(account, selected, originalCents);
  let credential: NegotiationCredential;
  try {
    credential = await issueNegotiationCredential(buildNegotiatorVars(account, selected, originalCents));
  } catch (cause) {
    if (cause instanceof NegotiationCallError) throw new AppError(cause.code, cause.message, cause.status);
    throw cause;
  }

  workflow.negotiation = {
    selectedQuoteId: selected.quoteId,
    providerId: selected.providerId,
    providerName: selected.providerName,
    targetAmountCents,
    originalCents,
    finalCents: originalCents,
    savingsCents: 0,
    savingsPct: 0,
    targetMet: false,
    steps: [{ label: "Opening group rate", amountCents: originalCents, time: "00:00", impactCents: null }],
    transcript: [],
    mode: "live",
    callStatus: "ringing",
    conversationId: null,
    callSid: null,
    recordingAvailable: false,
    callSummary: null,
    errorMessage: null,
    recordedFinalCents: null,
  };
  workflow.stage = "negotiating";
  touch(workflow);
  return { credential, dynamicVariables };
}

/** Records the Grok Voice session id once the browser call connects. */
export function attachConversation(workflow: WorkflowState, conversationId: string): void {
  const negotiation = workflow.negotiation;
  if (!negotiation || negotiation.mode !== "live") {
    throw new AppError("NO_ACTIVE_CALL", "No live negotiation call is in progress.");
  }
  negotiation.conversationId = conversationId;
  if (negotiation.callStatus !== "completed" && negotiation.callStatus !== "failed") {
    negotiation.callStatus = "in_progress";
  }
  negotiation.errorMessage = null;
  touch(workflow);
}

export interface ClientCallTranscriptLine {
  role: "user" | "agent";
  message: string;
  timeInCallSecs?: number;
}

/**
 * Finalizes a live Grok Voice call from the browser-collected transcript
 * (Grok has no ElevenLabs-style server conversation fetch for this demo).
 */
export function completeNegotiationCall(
  workflow: WorkflowState,
  input: { transcript?: ClientCallTranscriptLine[]; summary?: string | null },
): void {
  const negotiation = workflow.negotiation;
  if (!negotiation || negotiation.mode !== "live") {
    throw new AppError("NO_ACTIVE_CALL", "No live negotiation call is in progress.");
  }

  const liveTranscript = (input.transcript ?? [])
    .filter((entry) => entry.message.trim().length > 0)
    .map((entry, index) => ({
      role: entry.role,
      message: entry.message.trim(),
      timeInCallSecs: entry.timeInCallSecs ?? index * 8,
    }));

  if (negotiation.callStatus === "completed" && liveTranscript.length === 0) return;

  const outcome = deriveLiveCallOutcome({
    originalCents: negotiation.originalCents,
    targetCents: negotiation.targetAmountCents,
    transcript: liveTranscript,
    recordedFinalCents: negotiation.recordedFinalCents,
    providerName: negotiation.providerName,
  });

  negotiation.transcript = outcome.transcript.map((entry) => ({
    time: secondsToClock(entry.timeInCallSecs),
    speaker: entry.role === "agent" ? "Atrium" : negotiation.providerName,
    text: entry.message,
  }));

  const savingsCents = Math.max(0, negotiation.originalCents - outcome.finalCents);
  negotiation.finalCents = outcome.finalCents;
  negotiation.savingsCents = savingsCents;
  negotiation.savingsPct =
    negotiation.originalCents > 0 ? Math.round((savingsCents / negotiation.originalCents) * 1000) / 10 : 0;
  negotiation.targetMet = outcome.targetMet;
  negotiation.steps = outcome.steps;
  negotiation.callStatus = "completed";
  negotiation.recordingAvailable = false;
  negotiation.callSummary = input.summary?.trim() || outcome.summary;
  negotiation.errorMessage = null;
  workflow.stage = "result";
  touch(workflow);
}

/** Captures the exact final price the agent recorded on the call (record_negotiation_event). */
export function recordNegotiationEvent(
  workflow: WorkflowState,
  event: { finalCostCents?: number; providerResponse?: string; concessionType?: string },
): void {
  const negotiation = workflow.negotiation;
  if (!negotiation || negotiation.mode !== "live") {
    throw new AppError("NO_ACTIVE_CALL", "No live negotiation call is in progress.");
  }
  const finalCents = Math.round(Number(event.finalCostCents));
  if (Number.isFinite(finalCents) && finalCents > 0 && finalCents <= negotiation.originalCents * 1.2) {
    negotiation.recordedFinalCents = Math.min(finalCents, negotiation.originalCents);
  }
  const note = String(event.providerResponse ?? event.concessionType ?? "").trim();
  if (note) negotiation.callSummary = note.slice(0, 1000);
  touch(workflow);
}

/**
 * Polls a live negotiation. With Grok Voice the browser finalizes via
 * completeNegotiationCall; this only refreshes in-progress state.
 */
export async function pollNegotiation(workflow: WorkflowState): Promise<boolean> {
  const negotiation = workflow.negotiation;
  if (!negotiation || negotiation.mode !== "live") return false;
  if (negotiation.callStatus === "completed" || negotiation.callStatus === "failed") return false;
  if (!negotiation.conversationId) return false;

  // Keep the UI in "processing" after hangup until completeNegotiationCall lands.
  if (negotiation.callStatus === "in_progress" || negotiation.callStatus === "processing") {
    touch(workflow);
    return true;
  }

  // Legacy path (unused for Grok): attempt a server conversation fetch.
  try {
    const snapshot = await fetchConversation(negotiation.conversationId);
    if (snapshot.phase === "completed") {
      completeNegotiationCall(workflow, {
        transcript: snapshot.transcript,
        summary: snapshot.summary,
      });
    }
  } catch (cause) {
    negotiation.errorMessage = cause instanceof Error ? cause.message : "Could not read call status";
    touch(workflow);
  }
  return true;
}

/** Server-side handle for the recording proxy route. */
export async function negotiationConversationId(workflow: WorkflowState): Promise<string | null> {
  const negotiation = workflow.negotiation;
  if (!negotiation || negotiation.mode !== "live" || !negotiation.recordingAvailable) return null;
  return negotiation.conversationId;
}

// ── UI projection (cents → whole dollars, display formatting) ───────────────
function toDollars(cents: number | null): number | null {
  return cents === null ? null : Math.round(cents / 100);
}

function shortName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

function formatReviews(count: number | null): string {
  if (count === null) return "—";
  return count >= 1_000 ? `${(count / 1_000).toFixed(1)}k` : String(count);
}

/**
 * Stage 2.5: the agent "calls" the hotels the user shortlisted and returns a
 * negotiated nightly rate below the best aggregator price. No real call is
 * placed — see `agent-calls.ts`.
 */
export async function runAgentCalls(
  workflow: WorkflowState,
  selectedQuoteIds: readonly string[],
): Promise<void> {
  const quotes = workflow.quotes;
  if (!quotes || quotes.length === 0) {
    throw new AppError("QUOTES_REQUIRED", "Collect hotel rates before calling hotels.");
  }

  const wanted = new Set(selectedQuoteIds);
  const chosen = wanted.size > 0 ? quotes.filter((quote) => wanted.has(quote.quoteId)) : quotes;
  if (chosen.length === 0) {
    throw new AppError("NO_HOTELS_SELECTED", "Select at least one hotel for Atrium to call.");
  }

  const profile = workflow.profile as { annualMileage?: number } | null;
  const rooms = profile?.annualMileage && profile.annualMileage > 0 ? profile.annualMileage : 24;
  const drafted = chosen
    .map((quote) => buildAgentCall(quote, { rooms, nights: STAY_NIGHTS }))
    .filter((call): call is AgentCallView => call !== null);
  const voices = assignHotelVoices(drafted.map((call) => call.providerId));
  const calls = drafted
    .map((call) => ({
      ...call,
      hotelVoice: voices.get(call.providerId) ?? call.hotelVoice,
      recordingAvailable: false,
    }))
    .sort((a, b) => a.agentQuoteCents - b.agentQuoteCents);

  if (calls.length === 0) {
    throw new AppError("NO_RATES", "The selected hotels have no nightly rate to negotiate against.");
  }

  if (isRecordingConfigured()) {
    await Promise.all(
      calls.map(async (call) => {
        try {
          await renderNegotiationRecording(call.script, { hotelVoice: call.hotelVoice });
          call.recordingAvailable = true;
        } catch (error) {
          console.warn(
            "[atrium] Grok recording failed for",
            call.providerName,
            error instanceof Error ? error.message : error,
          );
        }
      }),
    );
  }

  workflow.agentCalls = calls;
  workflow.updatedAt = new Date().toISOString();
}

export function toClientSnapshot(workflow: WorkflowState, account: Account) {
  return {
    displayName: account.displayName,
    workflowId: workflow.workflowId,
    stage: workflow.stage,
    liveAvailable: isLiveNegotiationConfigured(),
    research: workflow.research
      ? {
          live: workflow.research.live,
          providers: workflow.research.providers.map((provider) => ({
            id: provider.providerId,
            name: provider.providerName,
            shortName: shortName(provider.providerName),
            rating: provider.rating,
            reviews: formatReviews(provider.reviewCount),
            rank: provider.rank,
            website: provider.website,
            nightly: toDollars(provider.nightlyCents),
            roomType: provider.roomType,
            aggregators: provider.aggregators.map((agg) => ({
              name: agg.name,
              nightly: toDollars(agg.nightlyCents),
              url: agg.url,
            })),
          })),
        }
      : null,
    quotes: workflow.quotes
      ? {
          recommendedQuoteId: workflow.recommendedQuoteId,
          items: [...workflow.quotes]
            .sort((a, b) => (a.effectiveComparisonCostCents ?? 9e9) - (b.effectiveComparisonCostCents ?? 9e9))
            .map((quote) => ({
              id: quote.quoteId,
              providerId: quote.providerId,
              name: quote.providerName,
              shortName: shortName(quote.providerName),
              rating: quote.rating,
              reviews: formatReviews(quote.reviewCount),
              annual: toDollars(quote.annualizedCostCents ?? quote.effectiveComparisonCostCents),
              monthly: toDollars(quote.monthlyCents),
              deductible: quote.roomType ?? toDollars(quote.deductibleCents),
              recommended: quote.recommended,
              coverageEquivalence: quote.coverageEquivalence,
              redFlags: quote.redFlags,
              rank: quote.rank,
              roomType: quote.roomType,
              aggregators: quote.aggregators.map((agg) => ({
                name: agg.name,
                nightly: toDollars(agg.nightlyCents),
                url: agg.url,
              })),
            })),
        }
      : null,
    agentCalls: workflow.agentCalls
      ? workflow.agentCalls.map((call) => ({
          providerId: call.providerId,
          quoteId: call.quoteId,
          name: call.providerName,
          shortName: shortName(call.providerName),
          aggregatorLow: toDollars(call.aggregatorLowCents),
          aggregatorName: call.aggregatorName,
          agentQuote: toDollars(call.agentQuoteCents),
          saved: toDollars(call.savedCents),
          savedPct: call.savedPct,
          totalSaved: toDollars(call.totalSavedCents),
          concession: call.concession,
          roomType: call.roomType,
          rooms: call.rooms,
          nights: call.nights,
          summary: summarizeAgentCall(call),
          script: call.script,
          recordingUrl: call.recordingAvailable
            ? `/api/app/agent-calls/recording?providerId=${encodeURIComponent(call.providerId)}`
            : null,
        }))
      : null,
    negotiation: workflow.negotiation
      ? {
          selectedQuoteId: workflow.negotiation.selectedQuoteId,
          providerName: workflow.negotiation.providerName,
          target: toDollars(workflow.negotiation.targetAmountCents),
          original: toDollars(workflow.negotiation.originalCents),
          final: toDollars(workflow.negotiation.finalCents),
          savings: toDollars(workflow.negotiation.savingsCents),
          savingsPct: workflow.negotiation.savingsPct,
          targetMet: workflow.negotiation.targetMet,
          mode: workflow.negotiation.mode,
          callStatus: workflow.negotiation.callStatus,
          recordingUrl: workflow.negotiation.recordingAvailable ? "/api/app/negotiate/recording" : null,
          callSummary: workflow.negotiation.callSummary,
          errorMessage: workflow.negotiation.errorMessage,
          steps: workflow.negotiation.steps.map((step) => ({
            price: toDollars(step.amountCents),
            label: step.label,
            time: step.time,
            impact: step.impactCents === null ? null : toDollars(step.impactCents),
          })),
          transcript: workflow.negotiation.transcript,
        }
      : null,
  };
}

export type ClientSnapshot = ReturnType<typeof toClientSnapshot>;
