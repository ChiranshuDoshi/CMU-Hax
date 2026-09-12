import { jsonError, jsonSuccess } from "@/app/api/_lib/http";
import { quoteCollections } from "@/server/services/conversations";

import { requireLocalDemoRequest, toConversationHttpError } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ collectionId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireLocalDemoRequest(request);
    const { collectionId } = await context.params;
    return jsonSuccess({ collection: quoteCollections.get(collectionId) });
  } catch (error) {
    return jsonError(toConversationHttpError(error));
  }
}
