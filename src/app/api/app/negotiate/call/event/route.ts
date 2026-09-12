import { z } from "zod";

import { recordNegotiationEvent, toClientSnapshot } from "@/backend/app/orchestrator";
import { saveWorkflow } from "@/backend/app/store";

import { appErrorResponse, jsonOk, requireContext } from "../../../_lib";

export const runtime = "nodejs";

const EventSchema = z
  .object({
    finalCostCents: z.coerce.number().int().min(0).max(100_000_000).optional(),
    providerResponse: z.string().max(4000).optional(),
    concessionType: z.string().max(500).optional(),
  })
  .passthrough();

/** The negotiator agent's record_negotiation_event tool posts the confirmed final terms here. */
export async function POST(request: Request): Promise<Response> {
  try {
    const { account, workflow } = await requireContext();
    const body = EventSchema.parse(await request.json());
    recordNegotiationEvent(workflow, body);
    await saveWorkflow(workflow);
    return jsonOk({ snapshot: toClientSnapshot(workflow, account) });
  } catch (error) {
    return appErrorResponse(error);
  }
}
