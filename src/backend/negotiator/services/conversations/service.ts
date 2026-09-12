import { randomUUID } from "node:crypto";

import {
  validateNegotiationEvent,
  type NegotiationEventValidationInput,
  type ValidatedNegotiationEvent,
} from "@/domain/negotiation";
import type { ConversationPurpose } from "@/integrations/elevenlabs";

import { buildSafeNegotiationContext, ConversationInvariantError } from "./negotiation-context";
import type {
  ConversationSession,
  ConversationState,
  NegotiationSessionInput,
  QuoteCollectionSessionInput,
  TranscriptEntry,
} from "./types";

const MAX_RETRIES = 2;
const MAX_DURATION_MS = 10 * 60 * 1000;
const MAX_TRANSCRIPT_ENTRIES = 500;
const MAX_TRANSCRIPT_MESSAGE_LENGTH = 4_000;
const TERMINAL_STATES = new Set<ConversationState>(["completed", "failed", "cancelled"]);

type MutableSession = {
  -readonly [Key in keyof ConversationSession]: Key extends "transcript"
    ? TranscriptEntry[]
    : ConversationSession[Key];
};

export class ConversationSessionService {
  private readonly sessions = new Map<string, MutableSession>();

  create(
    purpose: ConversationPurpose,
    negotiation?: NegotiationSessionInput,
    quoteCollection?: QuoteCollectionSessionInput,
  ): ConversationSession {
    if (purpose === "negotiation" && !negotiation) {
      throw new ConversationInvariantError("NEGOTIATION_CONTEXT_REQUIRED", "Negotiation context is required");
    }
    if (purpose === "voice_smoke" && negotiation) {
      throw new ConversationInvariantError("UNEXPECTED_NEGOTIATION_CONTEXT", "Voice smoke sessions cannot negotiate");
    }
    if (purpose === "quote_collection" && !quoteCollection) {
      throw new ConversationInvariantError("QUOTE_COLLECTION_CONTEXT_REQUIRED", "Quote collection context is required");
    }
    if (purpose !== "quote_collection" && quoteCollection) {
      throw new ConversationInvariantError("UNEXPECTED_QUOTE_COLLECTION_CONTEXT", "Quote collection context is not allowed");
    }
    if (purpose === "quote_collection" && negotiation) {
      throw new ConversationInvariantError("UNEXPECTED_NEGOTIATION_CONTEXT", "Quote collection sessions cannot negotiate");
    }

    const now = new Date();
    const session: MutableSession = {
      id: randomUUID(),
      purpose,
      state: "connecting",
      retryCount: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + MAX_DURATION_MS).toISOString(),
      conversationId: null,
      transcript: [],
      errorCode: null,
      negotiation: negotiation ? buildSafeNegotiationContext(negotiation) : null,
      quoteCollection: quoteCollection ? Object.freeze({ ...quoteCollection }) : null,
    };
    this.sessions.set(session.id, session);
    return this.snapshot(session);
  }

  get(id: string): ConversationSession {
    return this.snapshot(this.requireCurrent(id));
  }

  activate(id: string, conversationId: string): ConversationSession {
    const session = this.requireCurrent(id);
    if (session.state !== "connecting") throw this.invalidTransition(session.state, "active");
    if (!conversationId.trim()) throw new ConversationInvariantError("INVALID_CONVERSATION_ID", "Conversation ID is required");
    session.conversationId = conversationId.trim();
    return this.transition(session, "active");
  }

  appendTranscript(id: string, entry: Omit<TranscriptEntry, "recordedAt">): ConversationSession {
    const session = this.requireCurrent(id);
    if (session.state !== "active" && session.state !== "processing") {
      throw new ConversationInvariantError("INVALID_TRANSCRIPT_STATE", "Transcript cannot be added in this state");
    }
    const message = entry.message.trim();
    if (!message || message.length > MAX_TRANSCRIPT_MESSAGE_LENGTH) {
      throw new ConversationInvariantError("INVALID_TRANSCRIPT", "Transcript message is empty or too long");
    }
    if (session.transcript.length >= MAX_TRANSCRIPT_ENTRIES) {
      throw new ConversationInvariantError("TRANSCRIPT_LIMIT", "Transcript entry limit reached");
    }
    session.transcript.push({ ...entry, message, recordedAt: new Date().toISOString() });
    session.updatedAt = new Date().toISOString();
    return this.snapshot(session);
  }

  beginProcessing(id: string): ConversationSession {
    const session = this.requireCurrent(id);
    if (session.state !== "active") throw this.invalidTransition(session.state, "processing");
    return this.transition(session, "processing");
  }

  complete(id: string): ConversationSession {
    const session = this.require(id);
    if (session.state === "completed") return this.snapshot(session);
    this.ensureNotExpired(session);
    if (session.state !== "active" && session.state !== "processing") {
      throw this.invalidTransition(session.state, "completed");
    }
    return this.transition(session, "completed");
  }

  completeNegotiation(
    id: string,
    input: NegotiationEventValidationInput,
  ): { readonly session: ConversationSession; readonly result: ValidatedNegotiationEvent } {
    const session = this.requireCurrent(id);
    if (session.purpose !== "negotiation" || session.negotiation === null) {
      throw new ConversationInvariantError("NOT_NEGOTIATION_SESSION", "Session is not a negotiation");
    }
    if (session.conversationId === null) {
      throw new ConversationInvariantError("CONVERSATION_NOT_ACTIVE", "Negotiation has no conversation ID");
    }

    // Person 4 validation requires provider-confirmed evidence for the exact final cost and
    // recomputes the offer from changed fees/discounts/coverage, so a fabricated base-premium
    // replacement cannot be used to complete a negotiation.
    const result = validateNegotiationEvent(input);
    if (result.event.negotiationConversationId !== session.conversationId) {
      throw new ConversationInvariantError(
        "CONVERSATION_MISMATCH",
        "Negotiation event belongs to another conversation",
      );
    }
    if (
      result.event.workflowId !== session.negotiation.workflowId ||
      result.event.originalQuoteId !== session.negotiation.selectedQuoteId ||
      result.event.targetProviderId !== session.negotiation.targetProviderId ||
      result.event.specificationHash !== session.negotiation.specificationHash
    ) {
      throw new ConversationInvariantError("NEGOTIATION_RESULT_MISMATCH", "Negotiation result does not match the session");
    }

    return { session: this.complete(id), result };
  }

  retry(id: string): ConversationSession {
    const session = this.require(id);
    this.ensureNotExpired(session);
    if (session.state !== "failed") throw this.invalidTransition(session.state, "connecting");
    if (session.retryCount >= MAX_RETRIES) {
      throw new ConversationInvariantError("RETRY_LIMIT", "Conversation retry limit reached");
    }
    session.retryCount += 1;
    session.errorCode = null;
    session.conversationId = null;
    return this.transition(session, "connecting");
  }

  fail(id: string, errorCode: string): ConversationSession {
    const session = this.require(id);
    if (TERMINAL_STATES.has(session.state)) return this.snapshot(session);
    session.errorCode = errorCode.trim() || "CONVERSATION_FAILED";
    return this.transition(session, "failed");
  }

  cancel(id: string): ConversationSession {
    const session = this.require(id);
    if (TERMINAL_STATES.has(session.state)) return this.snapshot(session);
    return this.transition(session, "cancelled");
  }

  private require(id: string): MutableSession {
    const session = this.sessions.get(id);
    if (!session) throw new ConversationInvariantError("SESSION_NOT_FOUND", "Conversation session was not found");
    return session;
  }

  private requireCurrent(id: string): MutableSession {
    const session = this.require(id);
    this.ensureNotExpired(session);
    return session;
  }

  private ensureNotExpired(session: MutableSession): void {
    if (!TERMINAL_STATES.has(session.state) && Date.now() >= Date.parse(session.expiresAt)) {
      session.errorCode = "DURATION_LIMIT";
      this.transition(session, "failed");
      throw new ConversationInvariantError("DURATION_LIMIT", "Conversation duration limit reached");
    }
  }

  private transition(session: MutableSession, state: ConversationState): ConversationSession {
    session.state = state;
    session.updatedAt = new Date().toISOString();
    return this.snapshot(session);
  }

  private snapshot(session: MutableSession): ConversationSession {
    return Object.freeze({
      ...session,
      transcript: Object.freeze(session.transcript.map((entry) => Object.freeze({ ...entry }))),
    });
  }

  private invalidTransition(from: ConversationState, to: ConversationState): ConversationInvariantError {
    return new ConversationInvariantError("INVALID_STATE_TRANSITION", `Cannot transition from ${from} to ${to}`);
  }
}

export const conversationSessions = new ConversationSessionService();
