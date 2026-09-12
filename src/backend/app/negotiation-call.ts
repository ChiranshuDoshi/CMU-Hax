/**
 * Browser voice negotiation for the integrated demo (Person 2).
 *
 * Instead of dialing a real phone (Twilio), the negotiator agent talks to the
 * user in the browser via ElevenLabs Conversational AI (an in-app "call"). This
 * module issues the browser voice credential and, after the call, fetches the
 * recorded conversation's transcript, analysis, and audio for the dashboard.
 *
 * Privacy: the private negotiation target/ceiling is NEVER sent to ElevenLabs —
 * only provider-safe context (provider name, current price, coverage summary).
 */
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const SDK_TIMEOUT_SECONDS = 20;
const SDK_MAX_RETRIES = 1;

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

/** True when ElevenLabs is configured to run the in-app voice negotiation. */
export function isLiveNegotiationConfigured(): boolean {
  return Boolean(envValue("ELEVENLABS_API_KEY") && envValue("ELEVENLABS_NEGOTIATOR_AGENT_ID"));
}

interface CallConfig {
  apiKey: string;
  agentId: string;
}

function resolveConfig(): CallConfig {
  const apiKey = envValue("ELEVENLABS_API_KEY");
  const agentId = envValue("ELEVENLABS_NEGOTIATOR_AGENT_ID");
  if (!apiKey || !agentId) {
    throw new NegotiationCallError("NOT_CONFIGURED", "In-app voice negotiation is not configured", 503);
  }
  return { apiKey, agentId };
}

let cachedClient: { apiKey: string; client: ElevenLabsClient } | null = null;
function elevenLabs(apiKey: string): ElevenLabsClient {
  if (!cachedClient || cachedClient.apiKey !== apiKey) {
    cachedClient = {
      apiKey,
      client: new ElevenLabsClient({ apiKey, timeoutInSeconds: SDK_TIMEOUT_SECONDS, maxRetries: SDK_MAX_RETRIES }),
    };
  }
  return cachedClient.client;
}

export type NegotiationCredential =
  | { transport: "webrtc"; conversationToken: string }
  | { transport: "websocket"; signedUrl: string };

/** Mints a short-lived browser credential for the negotiator agent (WebRTC, WS fallback). */
export async function issueNegotiationCredential(): Promise<NegotiationCredential> {
  const { apiKey, agentId } = resolveConfig();
  const client = elevenLabs(apiKey);
  try {
    const { token } = await client.conversationalAi.conversations.getWebrtcToken({ agentId });
    return { transport: "webrtc", conversationToken: token };
  } catch (webrtcError) {
    try {
      const { signedUrl } = await client.conversationalAi.conversations.getSignedUrl({ agentId });
      return { transport: "websocket", signedUrl };
    } catch {
      throw new NegotiationCallError(
        "CREDENTIAL_FAILED",
        webrtcError instanceof Error ? webrtcError.message : "Could not start the voice session",
        502,
      );
    }
  }
}

export type LiveCallPhase = "in_progress" | "processing" | "completed" | "failed";

export interface ConversationSnapshot {
  phase: LiveCallPhase;
  transcript: { role: "user" | "agent"; message: string; timeInCallSecs: number }[];
  summary: string | null;
  hasAudio: boolean;
  dataCollection: Record<string, string>;
}

export async function fetchConversation(conversationId: string): Promise<ConversationSnapshot> {
  const { apiKey } = resolveConfig();
  const conversation = await elevenLabs(apiKey).conversationalAi.conversations.get(conversationId);

  const phase: LiveCallPhase =
    conversation.status === "done"
      ? "completed"
      : conversation.status === "failed"
        ? "failed"
        : conversation.status === "processing"
          ? "processing"
          : "in_progress";

  const transcript = (conversation.transcript ?? [])
    .filter((entry) => (entry.message ?? "").trim().length > 0)
    .map((entry) => ({
      role: entry.role === "agent" ? ("agent" as const) : ("user" as const),
      message: (entry.message ?? "").trim(),
      timeInCallSecs: entry.timeInCallSecs ?? 0,
    }));

  const dataCollection: Record<string, string> = {};
  const results = conversation.analysis?.dataCollectionResults ?? {};
  for (const [key, result] of Object.entries(results)) {
    const value = (result as { value?: unknown } | null)?.value;
    if (value !== undefined && value !== null) dataCollection[key] = String(value);
  }

  return {
    phase,
    transcript,
    summary: conversation.analysis?.transcriptSummary ?? null,
    hasAudio: Boolean(conversation.hasAudio),
    dataCollection,
  };
}

export async function fetchConversationAudio(conversationId: string): Promise<ReadableStream<Uint8Array>> {
  const { apiKey } = resolveConfig();
  return elevenLabs(apiKey).conversationalAi.conversations.audio.get(conversationId);
}
