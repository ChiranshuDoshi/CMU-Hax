/**
 * Browser voice negotiation for the integrated demo (Person 2).
 *
 * Instead of dialing a real phone (Twilio), the negotiator agent talks to the
 * user in the browser via xAI Grok Voice (an in-app "call"). This module mints
 * an ephemeral client secret with a bound session (instructions + tools) and
 * never exposes XAI_API_KEY to the browser.
 *
 * Privacy: the private negotiation target/ceiling is NEVER sent to Grok —
 * only provider-safe context (provider name, current price, coverage summary).
 */

const CLIENT_SECRETS_URL = "https://api.x.ai/v1/realtime/client_secrets";
const REALTIME_WS_URL = "wss://api.x.ai/v1/realtime";
const GROK_VOICE_MODEL = "grok-voice-latest";
const TOKEN_TTL_SECONDS = 600;
const DEFAULT_VOICE = "atlas";

export class NegotiationCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "NegotiationCallError";
  }
}

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

/** True when Grok Voice is configured to run the in-app voice negotiation. */
export function isLiveNegotiationConfigured(): boolean {
  return Boolean(envValue("XAI_API_KEY"));
}

export type NegotiationCredential = {
  transport: "grok";
  clientSecret: string;
  model: string;
  websocketUrl: string;
  voice: string;
  /** Present when the server could not bind session to the secret; client applies via session.update. */
  session?: ReturnType<typeof buildNegotiatorSessionConfig>;
};

export type LiveCallPhase = "in_progress" | "processing" | "completed" | "failed";

export interface ConversationSnapshot {
  phase: LiveCallPhase;
  transcript: { role: "user" | "agent"; message: string; timeInCallSecs: number }[];
  summary: string | null;
  hasAudio: boolean;
  dataCollection: Record<string, string>;
}

export interface NegotiatorSessionVars {
  userDisplayName: string;
  providerName: string;
  policyPeriodCost: string;
  monthlyCost: string;
  coverageSummary: string;
  quoteDisclaimer: string;
  allowedLeverageText: string;
  verifiedComparableMonthly: string;
}

const NEGOTIATOR_TOOLS = [
  {
    type: "function",
    name: "get_verified_competing_quote",
    description:
      "Load only verified allowed leverage; an empty result means no competitor may be mentioned.",
    parameters: { type: "object", properties: {}, required: [] as string[] },
  },
  {
    type: "function",
    name: "record_negotiation_event",
    description:
      "Browser-side human-review-only improved-terms recording from exact provider transcript evidence. Call at most once after the provider confirms every improved term. Never call for no-change or callback.",
    parameters: {
      type: "object",
      required: [
        "outcome",
        "providerResponse",
        "finalCostCents",
        "derivedMonthlyEffectiveCostCents",
        "coverageUnchanged",
        "concessionType",
        "addedFeesCents",
        "bindingStatus",
      ],
      properties: {
        outcome: { type: "string", enum: ["improved_terms"] },
        providerResponse: { type: "string" },
        finalCostCents: { type: "integer" },
        derivedMonthlyEffectiveCostCents: { type: "integer" },
        coverageUnchanged: { type: "boolean" },
        concessionType: { type: "string" },
        addedFeesCents: { type: "integer", minimum: 0 },
        bindingStatus: {
          type: "string",
          enum: ["binding", "non_binding", "pending_callback", "pending_review"],
        },
      },
    },
  },
] as const;

export function buildNegotiatorInstructions(vars: NegotiatorSessionVars): string {
  const open =
    `Hi, I'm StayScout, an AI agent working on behalf of ${vars.userDisplayName}. ` +
    `We're reviewing ${vars.providerName}'s group rate—what can you do to lower the nightly price without changing the stay details?`;

  return `You are StayScout, negotiating ${vars.providerName}'s group hotel booking on behalf of ${vars.userDisplayName}.
Improve the per-room nightly group rate without changing dates, room count, or inclusions. Price first; then free breakfast, amenity fees, late checkout, or sales-manager review.

Context (provider-safe only — never invent beyond this):
- Current group nightly rate (policy-period field): ${vars.policyPeriodCost}
- Derived per-guest nightly estimate: ${vars.monthlyCost}
- Stay package: ${vars.coverageSummary}
- Verified comparable nightly: ${vars.verifiedComparableMonthly}
- Allowed leverage text: ${vars.allowedLeverageText}
- Quote disclaimer: ${vars.quoteDisclaimer}
- Simulated / requires human verification: true

Opening: on your first spoken turn, say exactly once (do not repeat later):
"${open}"

Rules:
- Ordinary turns: at most two sentences, ~35 words, one How/What question. End with terminal punctuation.
- Never disclose a private target, range, ceiling, or internal ranking.
- Never bluff or invent competing hotel offers, discounts, deadlines, or inventory facts.
- Call get_verified_competing_quote before any competitor language. If it says none available, do not cite competitors.
- Call record_negotiation_event at most once, only after hotel sales explicitly confirms final nightly cost, derived monthly-equivalent field, unchanged stay package, concession, fees, and binding status.
- After confirmation: one short close, then stop. Never re-summarize or loop.
- If the hotel refuses two distinct concession paths, close with no change (do not call record_negotiation_event).
- The user is role-playing the hotel sales representative. Negotiate with them accordingly.`;
}

export function buildNegotiatorSessionConfig(vars: NegotiatorSessionVars) {
  const voice = envValue("XAI_NEGOTIATOR_VOICE") ?? DEFAULT_VOICE;
  return {
    voice,
    instructions: buildNegotiatorInstructions(vars),
    turn_detection: {
      type: "server_vad",
      silence_duration_ms: 700,
    },
    tools: NEGOTIATOR_TOOLS,
    audio: {
      input: {
        format: { type: "audio/pcm", rate: 24000 },
        transcription: { model: "grok-transcribe" },
      },
      output: {
        format: { type: "audio/pcm", rate: 24000 },
      },
    },
  };
}

/** Mints a short-lived browser credential with a bound Grok Voice session. */
export async function issueNegotiationCredential(
  vars: NegotiatorSessionVars,
): Promise<NegotiationCredential> {
  const apiKey = envValue("XAI_API_KEY");
  if (!apiKey) {
    throw new NegotiationCallError("NOT_CONFIGURED", "In-app voice negotiation is not configured", 503);
  }

  const session = buildNegotiatorSessionConfig(vars);
  const apiKeyHeader = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  async function mint(body: Record<string, unknown>) {
    const response = await fetch(CLIENT_SECRETS_URL, {
      method: "POST",
      headers: apiKeyHeader,
      body: JSON.stringify(body),
    });
    return response;
  }

  let response: Response;
  let sessionBound = true;
  try {
    response = await mint({
      expires_after: { seconds: TOKEN_TTL_SECONDS },
      model: GROK_VOICE_MODEL,
      session,
    });
    // Older xAI accounts may reject bound sessions — fall back to a bare secret.
    if (!response.ok) {
      sessionBound = false;
      response = await mint({
        expires_after: { seconds: TOKEN_TTL_SECONDS },
      });
    }
  } catch (cause) {
    throw new NegotiationCallError(
      "CREDENTIAL_FAILED",
      cause instanceof Error ? cause.message : "Could not reach Grok Voice",
      502,
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new NegotiationCallError(
      "CREDENTIAL_FAILED",
      detail.slice(0, 240) || `Grok Voice credential failed (${response.status})`,
      502,
    );
  }

  const payload = (await response.json()) as { value?: string };
  const clientSecret = payload.value?.trim();
  if (!clientSecret) {
    throw new NegotiationCallError("CREDENTIAL_FAILED", "Grok Voice returned an empty client secret", 502);
  }

  return {
    transport: "grok",
    clientSecret,
    model: GROK_VOICE_MODEL,
    websocketUrl: `${REALTIME_WS_URL}?model=${GROK_VOICE_MODEL}`,
    voice: session.voice,
    ...(sessionBound ? {} : { session }),
  };
}

/** Grok does not expose a server-side conversation recording API for this demo. */
export async function fetchConversation(_conversationId: string): Promise<ConversationSnapshot> {
  return {
    phase: "in_progress",
    transcript: [],
    summary: null,
    hasAudio: false,
    dataCollection: {},
  };
}

export async function fetchConversationAudio(_conversationId: string): Promise<ReadableStream<Uint8Array>> {
  throw new NegotiationCallError("NOT_SUPPORTED", "Grok Voice call recordings are not available", 404);
}
