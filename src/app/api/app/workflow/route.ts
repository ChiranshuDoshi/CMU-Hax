import { toClientSnapshot } from "@/backend/app/orchestrator";

import { appErrorResponse, currentAccount, jsonOk, requireContext } from "../_lib";

export const runtime = "nodejs";

/** Returns the current workflow snapshot, or `{ snapshot: null }` when signed out. */
export async function GET(): Promise<Response> {
  try {
    const account = await currentAccount();
    if (!account) return jsonOk({ snapshot: null });
    const { workflow } = await requireContext();
    return jsonOk({ snapshot: toClientSnapshot(workflow, account) });
  } catch (error) {
    return appErrorResponse(error);
  }
}
