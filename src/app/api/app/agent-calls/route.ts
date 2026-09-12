import { z } from "zod";

import { runAgentCalls, toClientSnapshot } from "@/backend/app/orchestrator";
import { saveWorkflow } from "@/backend/app/store";

import { appErrorResponse, jsonOk, requireContext } from "../_lib";

export const runtime = "nodejs";
// One hotel is six TTS lines; several hotels in parallel can take a while.
export const maxDuration = 120;

const BodySchema = z.object({
  selectedQuoteIds: z.array(z.string().min(1)).default([]),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const { account, workflow } = await requireContext();
    const body = BodySchema.parse(await request.json().catch(() => ({})));
    await runAgentCalls(workflow, body.selectedQuoteIds);
    await saveWorkflow(workflow);
    return jsonOk({ snapshot: toClientSnapshot(workflow, account) });
  } catch (error) {
    return appErrorResponse(error);
  }
}
