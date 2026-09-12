import { fetchConversationAudio } from "@/backend/app/negotiation-call";
import { negotiationConversationId } from "@/backend/app/orchestrator";

import { appErrorResponse, requireContext } from "../../_lib";

export const runtime = "nodejs";

/** Streams the ElevenLabs conversation recording (proxied so the API key stays server-side). */
export async function GET(): Promise<Response> {
  try {
    const { workflow } = await requireContext();
    const conversationId = await negotiationConversationId(workflow);
    if (!conversationId) {
      return new Response("Recording not available", { status: 404, headers: { "cache-control": "no-store" } });
    }
    const audio = await fetchConversationAudio(conversationId);
    return new Response(audio, {
      status: 200,
      headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
    });
  } catch (error) {
    return appErrorResponse(error);
  }
}
