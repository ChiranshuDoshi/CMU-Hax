/**
 * BFF orchestration for the integrated demo (Person 2).
 *
 * Drives the proven pipeline in-process — research → 5-quote simulation →
 * recommendation/handoff → negotiation — holding any credentials server-side and
 * projecting results into UI-friendly (whole-dollar) snapshots the browser polls.
 */
import { join } from "node:path";

import { capabilities } from "@/config/env";
import { MockResearchProvider, rankResearchResult } from "@/domain/research";
import { TavilyResearchProvider } from "@/integrations/tavily";
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

import { buildConfirmedRequest, type CarProfile } from "./build-request";
import {
  fetchConversation,
  isLiveNegotiationConfigured,
  issueNegotiationCredential,
  NegotiationCallError,
  type ConversationSnapshot,
  type NegotiationCredential,
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

// ── Stage 1: market research → Top 5 ────────────────────────────────────────
async function mockRanking(
  request: ReturnType<typeof buildConfirmedRequest>,
  evaluatedAt: string,
): Promise<ProviderRankingResult> {
  const result = await new MockResearchProvider().research({
    quoteRequest: request,
    retrievedAt: evaluatedAt,
  });
  return rankResearchResult(request, result, evaluatedAt);
}

export async function runResearch(workflow: WorkflowState, profile: CarProfile): Promise<void> {
  const request = buildConfirmedRequest(workflow.workflowId, profile);
  const evaluatedAt = new Date().toISOString();
  const caps = capabilities();

  let ranking: ProviderRankingResult;
  let live = false;
  if (caps.hasTavily) {
    try {
      const provider = new TavilyResearchProvider({ apiKey: process.env.TAVILY_API_KEY });
      const result = await provider.research({ quoteRequest: request, retrievedAt: evaluatedAt });
      const ranked = rankResearchResult(request, result, evaluatedAt);
      if (ranked.selected.length === 5) {
        ranking = ranked;
        live = true;
      } else {
        ranking = await mockRanking(request, evaluatedAt);
      }
    } catch {
      ranking = await mockRanking(request, evaluatedAt);
    }
  } else {
    ranking = await mockRanking(request, evaluatedAt);
  }

  workflow.profile = profile as unknown as Record<string, unknown>;
  workflow.confirmedRequest = request;
  workflow.ranking = ranking;
  workflow.research = {
    live,
    evaluatedAt,
    providers: ranking.selected.map((brief) => ({
      providerId: brief.providerId,
      providerName: brief.providerName,
      rank: brief.topFiveRank ?? 0,
      rating: brief.rating,
      reviewCount: brief.reviewCount,
      website: brief.website,
      eligibility: brief.eligibilityStatus,
    })),
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
  const vehicle = `${profile.year ?? ""} ${profile.make ?? ""} ${profile.model ?? ""}`
    .replace(/\s+/g, " ")
    .trim();
  const parts = [
    `Customer seeking auto insurance in ${request?.state ?? ""} ${request?.zipCode ?? ""}.`,
    vehicle ? `Vehicle: ${vehicle}.` : "",
    profile.annualMileage ? `Approximately ${profile.annualMileage} annual miles.` : "",
    "Requested coverage: bodily injury 100/300, collision and comprehensive with a $500 deductible.",
    `Desired effective date ${request?.desiredEffectiveDate ?? "on file"}.`,
    "Do not disclose payment details, government identifiers, or any private negotiation target.",
  ];
  const brief = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return brief.slice(0, 8_000) || "Auto insurance quote request.";
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

  const quotes: QuoteView[] = ranking.selected.map((brief) => {
    const quote = byProvider.get(brief.providerId);
    return {
      quoteId: quote?.quoteId ?? `${brief.providerId}-quote`,
      providerId: brief.providerId,
      providerName: brief.providerName,
      rank: brief.topFiveRank ?? 0,
      rating: brief.rating,
      reviewCount: brief.reviewCount,
      effectiveComparisonCostCents: quote?.effectiveComparisonCostCents ?? null,
      annualizedCostCents: quote?.annualizedCostCents ?? null,
      monthlyCents: quote ? monthlyCents(quote) : null,
      deductibleCents: 50_000,
      coverageEquivalence: quote?.coverageEquivalence.status ?? "missing_information",
      redFlags: quote?.redFlags.map((flag) => flag.message) ?? [],
      recommended: quote?.quoteId === recommendedQuoteId,
    };
  });

  workflow.quotes = quotes;
  workflow.recommendedQuoteId = recommendedQuoteId;
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
    { label: "Starting quote", amountCents: originalCents, time: "00:00", impactCents: null },
    { label: "Competitive offer matched", amountCents: p1, time: "01:52", impactCents: p1 - originalCents },
    { label: "Loyalty and telematics discount applied", amountCents: p2, time: "03:29", impactCents: p2 - p1 },
    { label: "Final approved adjustment", amountCents: finalCents, time: "06:11", impactCents: finalCents - p2 },
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
    { time: "05:02", speaker: "PolicyScout", text: "I appreciate you reviewing my client's file." },
    { time: "05:10", speaker: providerName, text: "I can apply the verified safe-driving discount." },
    { time: "05:36", speaker: providerName, text: `That brings the final annual premium to ${finalText}.` },
    {
      time: "05:41",
      speaker: "PolicyScout",
      text: targetMet
        ? "That is within our target. No coverage changes, correct?"
        : "Understood. Confirming no coverage changes at that price?",
    },
    { time: "05:45", speaker: providerName, text: "Correct. The limits and deductibles remain unchanged." },
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

function quoteOriginalCents(quote: QuoteView): number {
  const cents = quote.effectiveComparisonCostCents ?? quote.annualizedCostCents ?? 0;
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
  const originalCents = quoteOriginalCents(selected);
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

// ── Live negotiation call (ElevenLabs over Twilio) ──────────────────────────
function buildDynamicVariables(
  account: Account,
  selected: QuoteView,
  originalCents: number,
): Record<string, string | number | boolean> {
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  // These names must match the negotiator agent's prompt template exactly, or the
  // agent has no price context and breaks character. The private target is never sent.
  return {
    user_display_name: account.displayName,
    selected_provider_name: selected.providerName,
    policy_period_effective_cost: money(originalCents),
    derived_monthly_effective_cost: money(Math.round(originalCents / 12)),
    verified_comparable_monthly_effective_cost: "not available",
    allowed_leverage_text: "No verified comparable quote is available; do not cite competitor pricing.",
    coverage_summary:
      "Bodily injury 100/300, collision and comprehensive with a $500 deductible. Keep all coverage unchanged.",
    quote_disclaimer: "This simulated quote is non-binding and requires human verification.",
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
 * issues the browser voice credential and moves the negotiation to a "ringing"
 * state. The browser answers the call and talks to the ElevenLabs agent directly.
 */
export async function startNegotiationCall(
  workflow: WorkflowState,
  account: Account,
  targetAmountCents: number,
  selectedQuoteId?: string,
): Promise<StartNegotiationCallResult> {
  const selected = resolveSelectedQuote(workflow, selectedQuoteId);
  const originalCents = quoteOriginalCents(selected);
  if (!isLiveNegotiationConfigured()) {
    throw new AppError("NOT_CONFIGURED", "In-app voice negotiation is not configured.", 503);
  }

  const dynamicVariables = buildDynamicVariables(account, selected, originalCents);
  let credential: NegotiationCredential;
  try {
    credential = await issueNegotiationCredential();
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
    steps: [{ label: "Starting quote", amountCents: originalCents, time: "00:00", impactCents: null }],
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

/** Records the ElevenLabs conversation id once the browser call connects. */
export function attachConversation(workflow: WorkflowState, conversationId: string): void {
  const negotiation = workflow.negotiation;
  if (!negotiation || negotiation.mode !== "live") {
    throw new AppError("NO_ACTIVE_CALL", "No live negotiation call is in progress.");
  }
  negotiation.conversationId = conversationId;
  negotiation.callStatus = "in_progress";
  negotiation.errorMessage = null;
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

function secondsToClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Extracts dollar amounts (as cents) from free text, e.g. "$1,428" or "$1428.00". */
function parseDollarAmountsCents(text: string): number[] {
  const amounts: number[] = [];
  const pattern = /\$\s?([0-9][0-9,]{2,})(?:\.(\d{2}))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const whole = Number(match[1].replace(/,/g, ""));
    const cents = whole * 100 + (match[2] ? Number(match[2]) : 0);
    if (Number.isFinite(cents) && cents > 0) amounts.push(cents);
  }
  return amounts;
}

function deriveFinalCents(originalCents: number, targetCents: number, snapshot: ConversationSnapshot): number {
  // 1) A structured data-collection field configured on the agent.
  for (const [key, raw] of Object.entries(snapshot.dataCollection)) {
    if (!/final|negotiat|agreed|premium|price|quote/i.test(key)) continue;
    const [cents] = parseDollarAmountsCents(raw.startsWith("$") ? raw : `$${raw}`);
    if (cents && cents >= originalCents * 0.4 && cents <= originalCents * 1.2) return Math.min(cents, originalCents);
  }
  // 2) Lowest plausible price the agent stated on the call.
  const agentPrices = snapshot.transcript
    .filter((entry) => entry.role === "agent")
    .flatMap((entry) => parseDollarAmountsCents(entry.message))
    .filter((cents) => cents >= originalCents * 0.5 && cents < originalCents);
  if (agentPrices.length > 0) return Math.min(...agentPrices);
  // 3) Fall back to the simulated concession target.
  return simulateConcession(originalCents, targetCents).finalCents;
}

function buildLiveSteps(originalCents: number, finalCents: number, snapshot: ConversationSnapshot): NegotiationStepView[] {
  const intermediate = [
    ...new Set(
      snapshot.transcript
        .filter((entry) => entry.role === "agent")
        .flatMap((entry) => parseDollarAmountsCents(entry.message))
        .filter((cents) => cents > finalCents && cents < originalCents),
    ),
  ]
    .sort((a, b) => b - a)
    .slice(0, 2);

  const steps: NegotiationStepView[] = [
    { label: "Starting quote", amountCents: originalCents, time: "00:00", impactCents: null },
  ];
  let previous = originalCents;
  intermediate.forEach((cents, index) => {
    steps.push({
      label: `Counter ${index + 1} accepted`,
      amountCents: cents,
      time: secondsToClock((index + 1) * 45),
      impactCents: cents - previous,
    });
    previous = cents;
  });
  steps.push({ label: "Final approved adjustment", amountCents: finalCents, time: "on call", impactCents: finalCents - previous });
  return steps;
}

/** Polls a live negotiation call, finalizing the result when the call ends. */
export async function pollNegotiation(workflow: WorkflowState): Promise<boolean> {
  const negotiation = workflow.negotiation;
  if (!negotiation || negotiation.mode !== "live" || !negotiation.conversationId) return false;
  if (negotiation.callStatus === "completed" || negotiation.callStatus === "failed") return false;

  let snapshot: ConversationSnapshot;
  try {
    snapshot = await fetchConversation(negotiation.conversationId);
  } catch (cause) {
    negotiation.errorMessage = cause instanceof Error ? cause.message : "Could not read call status";
    touch(workflow);
    return true;
  }

  negotiation.transcript = snapshot.transcript.map((entry) => ({
    time: secondsToClock(entry.timeInCallSecs),
    speaker: entry.role === "agent" ? negotiation.providerName : "You",
    text: entry.message,
  }));
  negotiation.errorMessage = null;

  if (snapshot.phase === "in_progress" || snapshot.phase === "processing") {
    negotiation.callStatus = snapshot.phase;
    touch(workflow);
    return true;
  }
  if (snapshot.phase === "failed") {
    negotiation.callStatus = "failed";
    negotiation.errorMessage = "The negotiation call did not complete.";
    touch(workflow);
    return true;
  }

  // Call completed — prefer the agent-recorded price, else derive it.
  const finalCents =
    negotiation.recordedFinalCents ??
    deriveFinalCents(negotiation.originalCents, negotiation.targetAmountCents, snapshot);
  const savingsCents = Math.max(0, negotiation.originalCents - finalCents);
  negotiation.finalCents = finalCents;
  negotiation.savingsCents = savingsCents;
  negotiation.savingsPct = negotiation.originalCents > 0 ? Math.round((savingsCents / negotiation.originalCents) * 1000) / 10 : 0;
  negotiation.targetMet = finalCents <= negotiation.targetAmountCents;
  negotiation.steps = buildLiveSteps(negotiation.originalCents, finalCents, snapshot);
  negotiation.callStatus = "completed";
  negotiation.recordingAvailable = snapshot.hasAudio;
  negotiation.callSummary = snapshot.summary;
  if (negotiation.transcript.length === 0) {
    negotiation.transcript = buildTranscript(negotiation.providerName, finalCents, negotiation.targetMet);
  }
  workflow.stage = "result";
  touch(workflow);
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

const DEAL_TRANSCRIPT_PATTERN =
  /\$|%|\b(discount|price|premium|coverage|deductible|waive|deal|agree|confirm|lower|reduc|match|monthly|annual|final|offer|commit|save|saving|term|rate|quote)\b/i;

/** Keeps only the deal-relevant lines (price, concessions, agreement) for the excerpt. */
function selectDealTranscript(transcript: TranscriptLineView[]): TranscriptLineView[] {
  const relevant = transcript.filter((line) => DEAL_TRANSCRIPT_PATTERN.test(line.text));
  const chosen = relevant.length >= 3 ? relevant : transcript;
  return chosen.slice(-12);
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
              deductible: toDollars(quote.deductibleCents),
              recommended: quote.recommended,
              coverageEquivalence: quote.coverageEquivalence,
              redFlags: quote.redFlags,
              rank: quote.rank,
            })),
        }
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
          transcript: selectDealTranscript(workflow.negotiation.transcript),
        }
      : null,
  };
}

export type ClientSnapshot = ReturnType<typeof toClientSnapshot>;
