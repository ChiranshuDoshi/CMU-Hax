import { CarProfileSchema } from "@/backend/app/build-request";
import { runResearch, toClientSnapshot } from "@/backend/app/orchestrator";
import { saveWorkflow } from "@/backend/app/store";

import { appErrorResponse, jsonOk, requireContext } from "../_lib";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const { account, workflow } = await requireContext();
    const profile = CarProfileSchema.parse(await request.json());
    await runResearch(workflow, profile);
    await saveWorkflow(workflow);
    return jsonOk({ snapshot: toClientSnapshot(workflow, account) });
  } catch (error) {
    return appErrorResponse(error);
  }
}
