import { z } from "zod";

import { jsonError, jsonSuccess, readJsonBody } from "@/app/api/_lib/http";
import { conversationSessions, quoteCollections, type QuoteCollectionService } from "@/server/services/conversations";

import { requireLocalDemoRequest, toConversationHttpError } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("activate"), conversationId: z.string().min(1).max(256) }),
  z.strictObject({
    action: z.literal("transcript"),
    role: z.enum(["user", "agent"]),
    message: z.string().min(1).max(4_000),
  }),
  z.strictObject({ action: z.literal("processing") }),
  z.strictObject({ action: z.literal("complete") }),
  z.strictObject({ action: z.literal("cancel") }),
  z.strictObject({ action: z.literal("fail"), errorCode: z.string().min(1).max(128) }),
  z.strictObject({ action: z.literal("retry") }),
  z.strictObject({
    action: z.literal("record_quote"),
    capture: z.strictObject({
      totalPolicyTermCostCents: z.number().int().positive(),
      policyTermMonths: z.number().int().positive().max(24),
      feesAndTaxesIncluded: z.literal(true),
      coverageMatchesRequested: z.literal(true),
      effectiveDate: z.string().date(),
      quoteValidUntil: z.string().datetime(),
      providerResponse: z.string().min(1).max(4_000),
    }),
  }),
]);

interface RouteContext {
  readonly params: Promise<{ sessionId: string }>;
}

export async function handleSessionPatch(
  request: Request,
  context: RouteContext,
  sessions: typeof conversationSessions,
  collections: QuoteCollectionService = quoteCollections,
): Promise<Response> {
  try {
    requireLocalDemoRequest(request);
    const { sessionId } = await context.params;
    const body = ActionSchema.parse(await readJsonBody(request));
    const session = (() => {
      switch (body.action) {
        case "activate": return sessions.activate(sessionId, body.conversationId);
        case "transcript": return sessions.appendTranscript(sessionId, body);
        case "processing": return sessions.beginProcessing(sessionId);
        case "complete": return sessions.complete(sessionId);
        case "cancel": return sessions.cancel(sessionId);
        case "fail": return sessions.fail(sessionId, body.errorCode);
        case "retry": return sessions.retry(sessionId);
        case "record_quote": return sessions.get(sessionId);
      }
    })();
    const collection = body.action === "record_quote"
      ? await collections.capture(session, body.capture)
      : undefined;
    if (body.action === "cancel" || body.action === "fail" || body.action === "complete") {
      collections.release(session);
    }
    return jsonSuccess({ session, ...(collection ? { collection } : {}) });
  } catch (error) {
    return jsonError(toConversationHttpError(error));
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleSessionPatch(request, context, conversationSessions);
}
