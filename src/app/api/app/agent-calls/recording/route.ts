import {
  renderNegotiationRecording,
  RecordingError,
} from "@/backend/app/negotiation-recording";

import { appErrorResponse, jsonOk, requireContext } from "../../_lib";

export const runtime = "nodejs";
// Synthesizing six spoken lines takes a few seconds.
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  try {
    const { workflow } = await requireContext();
    const providerId = new URL(request.url).searchParams.get("providerId");
    const call = workflow.agentCalls?.find((item) => item.providerId === providerId);
    if (!call) {
      return jsonOk({ error: { code: "CALL_NOT_FOUND", message: "No agent call for that hotel." } }, 404);
    }

    const audio = await renderNegotiationRecording(call.script, { hotelVoice: call.hotelVoice });
    return new Response(new Uint8Array(audio), {
      status: 200,
      headers: {
        "content-type": "audio/mpeg",
        "content-length": String(audio.byteLength),
        // Per-session demo audio; let the browser reuse it for replays.
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (error) {
    if (error instanceof RecordingError) {
      return jsonOk({ error: { code: error.code, message: error.message } }, error.status);
    }
    return appErrorResponse(error);
  }
}
