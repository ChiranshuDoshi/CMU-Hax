import { z } from "zod";

import { negotiate, toClientSnapshot } from "@/backend/app/orchestrator";
import { saveWorkflow } from "@/backend/app/store";

import { appErrorResponse, jsonOk, requireContext } from "../_lib";

export const runtime = "nodejs";

const NegotiateSchema = z.object({
  targetAmountCents: z.coerce.number().int().min(0).max(100_000_000),
  selectedQuoteId: z.string().trim().min(1).max(256).optional(),
});

/** Simulated concession (used when in-app voice negotiation is not configured). */
export async function POST(request: Request): Promise<Response> {
  try {
    const { account, workflow } = await requireContext();
    const body = NegotiateSchema.parse(await request.json());
    negotiate(workflow, body.targetAmountCents, body.selectedQuoteId);
    await saveWorkflow(workflow);
    return jsonOk({ snapshot: toClientSnapshot(workflow, account) });
  } catch (error) {
    return appErrorResponse(error);
  }
}
