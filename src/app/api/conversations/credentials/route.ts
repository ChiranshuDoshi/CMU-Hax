import { z } from "zod";

import { jsonError, jsonSuccess, readJsonBody, HttpError } from "@/app/api/_lib/http";
import {
  ElevenLabsConfigurationError,
  ElevenLabsCredentialProvider,
} from "@/integrations/elevenlabs/server";
import type { ConversationCredentialProvider } from "@/integrations/elevenlabs";
import {
  conversationSessions,
  PreparedNegotiationContextError,
  PreparedNegotiationContextService,
  QuoteCollectionService,
  quoteCollections,
  type ConversationSessionService,
  type PreparedNegotiationContextProvider,
} from "@/server/services/conversations";

import { requireLocalDemoRequest, toConversationHttpError } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NegotiationReferenceSchema = z.strictObject({
  workflowId: z.string().min(1),
  providerId: z.string().min(1),
  quoteId: z.string().min(1),
  specificationHash: z.string().regex(/^[a-f0-9]{64}$/),
  selectedAt: z.string().datetime(),
});

const QuoteCollectionReferenceSchema = z.strictObject({
  collectionId: z.string().min(1).max(128),
  workflowId: z.string().min(1).max(128),
  providerId: z.string().min(1).max(128),
  specificationHash: z.string().regex(/^[a-f0-9]{64}$/),
});

const BodySchema = z.discriminatedUnion("purpose", [
  z.strictObject({ purpose: z.literal("voice_smoke") }),
  z.strictObject({
    purpose: z.literal("negotiation"),
    negotiationReference: NegotiationReferenceSchema,
  }),
  z.strictObject({
    purpose: z.literal("quote_collection"),
    quoteCollectionReference: QuoteCollectionReferenceSchema,
  }),
]);

interface Dependencies {
  readonly credentials: ConversationCredentialProvider;
  readonly sessions: ConversationSessionService;
  readonly negotiationContexts: PreparedNegotiationContextProvider;
  readonly quoteCollections?: QuoteCollectionService;
}

export async function handleCredentialRequest(request: Request, dependencies: Dependencies): Promise<Response> {
  try {
    requireLocalDemoRequest(request);
    const body = BodySchema.parse(await readJsonBody(request));
    const negotiation = body.purpose === "negotiation"
      ? await dependencies.negotiationContexts.load(body.negotiationReference)
      : undefined;
    const quoteCollectionService = dependencies.quoteCollections ?? quoteCollections;
    const quoteCollection = body.purpose === "quote_collection"
      ? await quoteCollectionService.prepare(body.quoteCollectionReference)
      : undefined;
    const session = dependencies.sessions.create(body.purpose, negotiation, quoteCollection);
    if (quoteCollection) {
      try {
        quoteCollectionService.reserve(session);
      } catch (error) {
        dependencies.sessions.cancel(session.id);
        throw error;
      }
    }

    try {
      const credential = await dependencies.credentials.issue(body.purpose);
      if (request.signal.aborted) {
        dependencies.sessions.cancel(session.id);
        quoteCollectionService.release(session);
        throw new HttpError(499, "REQUEST_CANCELLED", "Conversation start was cancelled");
      }
      return jsonSuccess({ session, credential }, 201);
    } catch (error) {
      dependencies.sessions.fail(session.id, "CREDENTIAL_ISSUE_FAILED");
      quoteCollectionService.release(session);
      if (error instanceof HttpError) throw error;
      if (error instanceof ElevenLabsConfigurationError) {
        throw new HttpError(503, "ELEVENLABS_NOT_CONFIGURED", "ElevenLabs is not configured");
      }
      throw new HttpError(502, "ELEVENLABS_UNAVAILABLE", "ElevenLabs credential service is unavailable");
    }
  } catch (error) {
    if (error instanceof PreparedNegotiationContextError) {
      const status = error.code === "NEGOTIATION_REFERENCE_MISMATCH" ? 409 : 503;
      return jsonError(new HttpError(status, error.code, error.message));
    }
    return jsonError(toConversationHttpError(error));
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleCredentialRequest(request, {
    credentials: new ElevenLabsCredentialProvider(),
    sessions: conversationSessions,
    negotiationContexts: new PreparedNegotiationContextService(),
    quoteCollections,
  });
}
