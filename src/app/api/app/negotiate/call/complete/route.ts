import { z } from "zod";

import { completeNegotiationCall, toClientSnapshot } from "@/backend/app/orchestrator";
import { saveWorkflow } from "@/backend/app/store";

import { appErrorResponse, jsonOk, requireContext } from "../../../_lib";

export const runtime = "nodejs";

const CompleteSchema = z.object({
  conversationId: z.string().trim().min(1).max(256).optional(),
  summary: z.string().max(4000).nullable().optional(),
  transcript: z
    .array(
      z.object({
        role: z.enum(["user", "agent"]),
        message: z.string().max(8000),
        timeInCallSecs: z.number().nonnegative().optional(),
      }),
    )
    .max(400)
    .optional(),
});

/** Finalizes a Grok Voice negotiation from the browser-collected transcript. */
export async function POST(request: Request): Promise<Response> {
  try {
    const { account, workflow } = await requireContext();
    const body = CompleteSchema.parse(await request.json());
    if (body.conversationId && workflow.negotiation && !workflow.negotiation.conversationId) {
      workflow.negotiation.conversationId = body.conversationId;
    }
    completeNegotiationCall(workflow, {
      transcript: body.transcript,
      summary: body.summary ?? null,
    });
    await saveWorkflow(workflow);
    return jsonOk({ snapshot: toClientSnapshot(workflow, account) });
  } catch (error) {
    return appErrorResponse(error);
  }
}
