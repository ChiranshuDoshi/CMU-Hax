import { z } from "zod";

import { attachConversation, toClientSnapshot } from "@/backend/app/orchestrator";
import { saveWorkflow } from "@/backend/app/store";

import { appErrorResponse, jsonOk, requireContext } from "../../../_lib";

export const runtime = "nodejs";

const ConnectedSchema = z.object({
  conversationId: z.string().trim().min(1).max(256),
});

/** Records the ElevenLabs conversation id once the browser call connects. */
export async function POST(request: Request): Promise<Response> {
  try {
    const { account, workflow } = await requireContext();
    const body = ConnectedSchema.parse(await request.json());
    attachConversation(workflow, body.conversationId);
    await saveWorkflow(workflow);
    return jsonOk({ snapshot: toClientSnapshot(workflow, account) });
  } catch (error) {
    return appErrorResponse(error);
  }
}
