import { cookies } from "next/headers";
import { z } from "zod";

import {
  getAccount,
  getWorkflow,
  type Account,
  type WorkflowState,
  LiveCallRateLimitError,
  WORKFLOW_RETENTION_SECONDS,
  WorkflowStoreError,
} from "@/backend/app/store";
import { AppError } from "@/backend/app/orchestrator";

const ACCOUNT_COOKIE = "ps_account";
const COOKIE_MAX_AGE = WORKFLOW_RETENTION_SECONDS;

export async function currentAccount(): Promise<Account | null> {
  const jar = await cookies();
  const id = jar.get(ACCOUNT_COOKIE)?.value;
  if (!id) return null;
  return getAccount(id);
}

export async function requireContext(): Promise<{ account: Account; workflow: WorkflowState }> {
  const account = await currentAccount();
  if (!account) throw new AppError("NOT_AUTHENTICATED", "Sign up to start a workflow.", 401);
  const workflow = await getWorkflow(account.workflowId);
  if (!workflow) throw new AppError("WORKFLOW_NOT_FOUND", "No active workflow for this account.", 404);
  return { account, workflow };
}

export async function setAccountCookie(accountId: string): Promise<void> {
  const jar = await cookies();
  jar.set(ACCOUNT_COOKIE, accountId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE,
  });
}

export function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function appErrorResponse(error: unknown): Response {
  if (error instanceof LiveCallRateLimitError) {
    return jsonOk({ error: { code: error.code, message: error.message } }, error.status);
  }
  if (error instanceof WorkflowStoreError) {
    return jsonOk({ error: { code: error.code, message: error.message } }, 503);
  }
  if (error instanceof AppError) {
    return jsonOk({ error: { code: error.code, message: error.message } }, error.status);
  }
  if (error instanceof z.ZodError) {
    return jsonOk(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
      },
      400,
    );
  }
  console.error("[api/app] unexpected error", error);
  const message = error instanceof Error ? error.message : "Unexpected server error";
  return jsonOk({ error: { code: "INTERNAL_ERROR", message } }, 500);
}
