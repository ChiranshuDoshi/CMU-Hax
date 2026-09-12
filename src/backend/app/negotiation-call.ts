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

export function buildNegotiatorInstructions(vars: NegotiatorSessionVars): string {
  const open =
    `Hi, I'm Atrium, calling on behalf of ${vars.userDisplayName}. ` +
    `We're reviewing ${vars.providerName}'s group rate—what can you do to lower the nightly price without changing the stay details?`;

  return `You are Atrium, negotiating ${vars.providerName}'s group hotel booking on behalf of ${vars.userDisplayName}.
Improve the per-room nightly group rate without changing dates, room count, or inclusions. Price first; then free breakfast, amenity fees, late checkout, or sales-manager review.

Context (provider-safe only — never invent beyond this):
- Current group nightly rate: ${vars.policyPeriodCost}
- Stay package: ${vars.coverageSummary}
- Verified comparable nightly: ${vars.verifiedComparableMonthly}
- Allowed leverage: ${vars.allowedLeverageText}
- Quote disclaimer: ${vars.quoteDisclaimer}

Opening: on your first spoken turn, say exactly once (do not repeat later):
"${open}"

Rules:
- Ordinary turns: at most two sentences, ~35 words, one How/What question. End with terminal punctuation.
- Never disclose a private target, range, ceiling, or internal ranking.
- Never bluff or invent competing hotel offers, discounts, deadlines, or inventory facts.
- After the hotel confirms a final nightly rate, or refuses two distinct concession paths: speak one short close with no question. Then call end_call. Do not wait for another reply.
- Never call end_call until that close has been spoken. Never re-summarize or loop after the close.
- The user is role-playing the hotel sales representative. Negotiate with them accordingly.`;
}

export const END_CALL_TOOL = {
  type: "function",
  name: "end_call",
  description:
    "Hang up after you have spoken a final closing sentence. Call only when the nightly rate is confirmed or the hotel has refused twice.",
  parameters: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "confirmed_rate or no_concession",
      },
    },
    required: ["reason"],
  },
} as const;

export function buildNegotiatorSessionConfig(vars: NegotiatorSessionVars) {
  const voice = envValue("XAI_NEGOTIATOR_VOICE") ?? DEFAULT_VOICE;
  return {
    voice,
    instructions: buildNegotiatorInstructions(vars),
    tools: [END_CALL_TOOL],
    turn_detection: {
      type: "server_vad",
      threshold: 0.85,
      silence_duration_ms: 900,
    },
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
