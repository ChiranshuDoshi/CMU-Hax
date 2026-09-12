import { z } from "zod";

import { createAccount, getWorkflow } from "@/backend/app/store";
import { toClientSnapshot } from "@/backend/app/orchestrator";

import { appErrorResponse, jsonOk, setAccountCookie } from "../_lib";

export const runtime = "nodejs";

const SignupSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const body = SignupSchema.parse(await request.json());
    const account = await createAccount(body.displayName, body.email);
    await setAccountCookie(account.id);
    const workflow = await getWorkflow(account.workflowId);
    if (!workflow) throw new Error("workflow was not created");
    return jsonOk({
      account: { id: account.id, displayName: account.displayName, email: account.email },
      snapshot: toClientSnapshot(workflow, account),
    });
  } catch (error) {
    return appErrorResponse(error);
  }
}
