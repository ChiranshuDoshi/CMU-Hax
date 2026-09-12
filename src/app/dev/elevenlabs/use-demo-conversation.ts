"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";

import type {
  ConversationState,
  SafeNegotiationContext,
  TranscriptEntry,
} from "@/backend/negotiator/services/conversations";

export interface NegotiationReference {
  readonly workflowId: string;
  readonly providerId: string;
  readonly quoteId: string;
  readonly specificationHash: string;
  readonly selectedAt: string;
}

export interface QuoteCollectionReference {
  readonly collectionId: string;
  readonly workflowId: string;
  readonly providerId: string;
  readonly specificationHash: string;
}

export type DemoConversationRequest =
  | { readonly purpose: "voice_smoke" }
  | { readonly purpose: "negotiation"; readonly negotiationReference: NegotiationReference }
  | { readonly purpose: "quote_collection"; readonly quoteCollectionReference: QuoteCollectionReference };

export interface QuoteCapture {
  readonly totalPolicyTermCostCents: number;
  readonly policyTermMonths: number;
  readonly feesAndTaxesIncluded: true;
  readonly coverageMatchesRequested: true;
  readonly effectiveDate: string;
  readonly quoteValidUntil: string;
  readonly providerResponse: string;
}

export interface SafeQuoteCollectionContext {
  readonly collectionId: string;
  readonly workflowId: string;
  readonly specificationHash: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly providerSafeBrief: string;
}

export interface QuoteCollectionProviderStatus {
  readonly providerId: string;
  readonly providerName: string;
  readonly status: string;
}

export interface QuoteCollectionResult {
  readonly recommendedProviderName: string;
  readonly effectiveComparisonCostCents: number;
  readonly negotiationHandoff: unknown;
}

export interface QuoteCollectionSnapshot {
  readonly providers: readonly QuoteCollectionProviderStatus[];
  readonly result: QuoteCollectionResult | null;
}

export interface QuoteCollectionDisplay {
  readonly context: SafeQuoteCollectionContext;
  readonly snapshot: QuoteCollectionSnapshot | null;
}

interface CredentialResponse {
  readonly session: {
    readonly id: string;
    readonly negotiation: SafeNegotiationContext | null;
    readonly quoteCollection: SafeQuoteCollectionContext | null;
  };
  readonly credential:
    | { readonly transport: "webrtc"; readonly conversationToken: string }
    | { readonly transport: "websocket"; readonly signedUrl: string };
}

interface SessionPatchResponse {
  readonly session: unknown;
  readonly collection?: QuoteCollectionSnapshot;
}

interface ErrorResponse {
  readonly error?: { readonly message?: string };
}

type EndIntent = "complete" | "cancel" | "fail" | null;

export type SettledOperation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

export interface LifecycleGeneration {
  readonly id: number;
  isCurrent(): boolean;
  invalidate(): void;
  enqueue<T>(operation: () => Promise<T>): Promise<SettledOperation<T>>;
}

/** Coordinates identity and ordered async work without ever exposing a rejected queue promise. */
export function createConversationLifecycleCoordinator() {
  let currentGeneration = 0;

  return {
    begin(): LifecycleGeneration {
      const id = ++currentGeneration;
      let queue: Promise<void> = Promise.resolve();

      return {
        id,
        isCurrent: () => id === currentGeneration,
        invalidate: () => {
          if (id === currentGeneration) currentGeneration += 1;
        },
        enqueue<T>(operation: () => Promise<T>): Promise<SettledOperation<T>> {
          const pending = queue.then(operation);
          queue = pending.then(() => undefined, () => undefined);
          return pending.then(
            (value) => ({ ok: true, value }),
            (error: unknown) => ({ ok: false, error }),
          );
        },
      };
    },
    invalidate() {
      currentGeneration += 1;
    },
  };
}

interface ActiveSession {
  readonly lifecycle: LifecycleGeneration;
  readonly sessionId: string;
  readonly negotiation: SafeNegotiationContext | null;
  readonly quoteCollection: SafeQuoteCollectionContext | null;
  endIntent: EndIntent;
}

const MAX_START_ATTEMPTS = 3;
const MAX_QUOTE_COLLECTION_START_ATTEMPTS = 10;

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & ErrorResponse;
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed (${response.status})`);
  return body;
}

function microphoneError(cause: unknown): Error {
  if (cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "SecurityError")) {
    return new Error("Microphone access was denied. Allow microphone access for this local page and try again.");
  }
  return cause instanceof Error ? cause : new Error("The microphone could not be opened.");
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function formatCents(value: number | null): string {
  return value === null ? "not available" : `$${(value / 100).toFixed(2)}`;
}

function getQuoteCollectionSnapshot(
  response: QuoteCollectionSnapshot | { readonly collection: QuoteCollectionSnapshot },
): QuoteCollectionSnapshot {
  return "collection" in response ? response.collection : response;
}

export function useDemoConversation() {
  const [state, setState] = useState<ConversationState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [quoteCollection, setQuoteCollection] = useState<QuoteCollectionDisplay | null>(null);
  const [startAttempts, setStartAttempts] = useState(0);
  const [quoteCollectionStartAttempts, setQuoteCollectionStartAttempts] = useState(0);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const startAbortRef = useRef<AbortController | null>(null);
  const coordinatorRef = useRef(createConversationLifecycleCoordinator());
  const activeSessionRef = useRef<ActiveSession | null>(null);
  const quoteCollectionSnapshotVersionRef = useRef(0);

  const patchSession = useCallback(async (sessionId: string, payload: Record<string, unknown>) => {
    const response = await fetch(`/api/conversations/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    return readResponse<SessionPatchResponse>(response);
  }, []);

  const fetchQuoteCollection = useCallback(async (collectionId: string) => {
    const response = await fetch(`/api/conversations/collections/${encodeURIComponent(collectionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    const body = await readResponse<QuoteCollectionSnapshot | { readonly collection: QuoteCollectionSnapshot }>(response);
    return getQuoteCollectionSnapshot(body);
  }, []);

  const conversation = useConversation();
  const { endSession, startSession } = conversation;

  const isCurrent = useCallback((session: ActiveSession) => (
    mountedRef.current && session.lifecycle.isCurrent()
  ), []);

  const updateSession = useCallback(async (
    session: ActiveSession,
    payload: Record<string, unknown>,
    fallbackError: string,
  ) => {
    const result = await session.lifecycle.enqueue(() => patchSession(session.sessionId, payload));
    if (!result.ok && isCurrent(session)) setError(errorMessage(result.error, fallbackError));
    return result.ok;
  }, [isCurrent, patchSession]);

  const makeClientTools = useCallback((session: ActiveSession) => ({
    get_negotiation_goal: () => {
      const context = session.negotiation;
      return JSON.stringify(context ? {
        selectedProviderName: context.selectedProviderName,
        selectedQuoteId: context.selectedQuoteId,
        coverageRule: context.coverageSummary,
        instruction: "Preserve coverage and request human review before accepting final terms.",
      } : { unavailable: true });
    },
    get_verified_competing_quote: () => {
      const context = session.negotiation;
      return JSON.stringify(context ? {
        allowedLeverageText: context.allowedLeverageText,
        verifiedComparableMonthlyEffectiveCost: formatCents(
          context.lowestVerifiedComparableMonthlyEffectiveCostCents,
        ),
      } : { unavailable: true });
    },
    record_negotiation_event: () => JSON.stringify({
      accepted: false,
      requiresHumanReview: true,
      ingested: false,
      message: "Demo results are not ingested automatically.",
    }),
    record_quote: async (capture: QuoteCapture) => {
      if (!session.quoteCollection || !isCurrent(session) || session.endIntent !== null) {
        return JSON.stringify({ error: { message: "Quote collection is not active." } });
      }

      const result = await session.lifecycle.enqueue(() => patchSession(session.sessionId, {
        action: "record_quote",
        capture,
      }));
      if (!result.ok) {
        if (isCurrent(session)) setError(errorMessage(result.error, "Could not record the quote"));
        return JSON.stringify({ error: { message: errorMessage(result.error, "Could not record the quote") } });
      }

      session.endIntent = "complete";
      const snapshotVersion = ++quoteCollectionSnapshotVersionRef.current;
      if (result.value.collection && isCurrent(session)) {
        setQuoteCollection({ context: session.quoteCollection, snapshot: result.value.collection });
      } else {
        void (async () => {
          try {
            const snapshot = await fetchQuoteCollection(session.quoteCollection!.collectionId);
            if (isCurrent(session) && quoteCollectionSnapshotVersionRef.current === snapshotVersion) {
              setQuoteCollection({ context: session.quoteCollection!, snapshot });
            }
          } catch (cause) {
            if (isCurrent(session)) setError(errorMessage(cause, "Could not refresh quote collection status"));
          }
        })();
      }
      return JSON.stringify(result.value);
    },
  }), [fetchQuoteCollection, isCurrent, patchSession]);

  const finalizeDisconnect = useCallback(async (session: ActiveSession) => {
    if (!isCurrent(session)) return;

    if (session.endIntent === "complete") {
      const completed = await updateSession(
        session,
        { action: "complete" },
        "Could not complete the demo session",
      );
      if (isCurrent(session)) setState(completed ? "completed" : "failed");
    } else if (session.endIntent === "cancel") {
      await updateSession(session, { action: "cancel" }, "Could not cancel the demo session");
      if (isCurrent(session)) setState("cancelled");
    } else if (session.endIntent !== "fail") {
      session.endIntent = "fail";
      setState("failed");
      await updateSession(
        session,
        { action: "fail", errorCode: "UNEXPECTED_DISCONNECT" },
        "Could not record the unexpected disconnect",
      );
    }

    if (activeSessionRef.current === session) activeSessionRef.current = null;
  }, [isCurrent, updateSession]);

  const start = useCallback(async (request: DemoConversationRequest) => {
    const isQuoteCollection = request.purpose === "quote_collection";
    const attempts = isQuoteCollection ? quoteCollectionStartAttempts : startAttempts;
    const maxAttempts = isQuoteCollection ? MAX_QUOTE_COLLECTION_START_ATTEMPTS : MAX_START_ATTEMPTS;
    if (
      inFlightRef.current
      || conversation.status !== "disconnected"
      || state === "active"
      || state === "processing"
      || attempts >= maxAttempts
    ) {
      return;
    }

    const lifecycle = coordinatorRef.current.begin();
    inFlightRef.current = true;
    const controller = new AbortController();
    startAbortRef.current = controller;
    if (isQuoteCollection) {
      setQuoteCollectionStartAttempts((current) => current + 1);
    } else {
      setStartAttempts((current) => current + 1);
    }
    activeSessionRef.current = null;
    setState("connecting");
    setError(null);
    setTranscript([]);
    if (!isQuoteCollection) setQuoteCollection(null);
    quoteCollectionSnapshotVersionRef.current += 1;
    let createdSessionId: string | null = null;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone capture is not supported in this browser. Use a current browser on localhost.");
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of stream.getTracks()) track.stop();
      } catch (cause) {
        throw microphoneError(cause);
      }
      if (controller.signal.aborted || !lifecycle.isCurrent()) return;

      const response = await fetch("/api/conversations/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await readResponse<CredentialResponse>(response);
      createdSessionId = body.session.id;
      if (controller.signal.aborted || !lifecycle.isCurrent() || !mountedRef.current) {
        await lifecycle.enqueue(() => patchSession(createdSessionId!, { action: "cancel" }));
        return;
      }

      const session: ActiveSession = {
        lifecycle,
        sessionId: createdSessionId,
        negotiation: body.session.negotiation,
        quoteCollection: body.session.quoteCollection,
        endIntent: null,
      };
      activeSessionRef.current = session;
      if (body.session.quoteCollection) {
        const snapshotVersion = ++quoteCollectionSnapshotVersionRef.current;
        setQuoteCollection((current) => ({
          context: body.session.quoteCollection!,
          snapshot: current?.context.collectionId === body.session.quoteCollection!.collectionId
            ? current.snapshot
            : null,
        }));
        void (async () => {
          try {
            const snapshot = await fetchQuoteCollection(body.session.quoteCollection!.collectionId);
            if (isCurrent(session) && quoteCollectionSnapshotVersionRef.current === snapshotVersion) {
              setQuoteCollection({ context: body.session.quoteCollection!, snapshot });
            }
          } catch (cause) {
            if (isCurrent(session)) setError(errorMessage(cause, "Could not load quote collection status"));
          }
        })();
      }

      const dynamicVariables: Record<string, string | number | boolean> | undefined = body.session.quoteCollection ? {
        quote_provider_name: body.session.quoteCollection.providerName,
        quote_profile_brief: body.session.quoteCollection.providerSafeBrief,
      } : body.session.negotiation ? {
        user_display_name: body.session.negotiation.userDisplayName,
        selected_provider_name: body.session.negotiation.selectedProviderName,
        selected_provider_id: body.session.negotiation.targetProviderId,
        selected_quote_id: body.session.negotiation.selectedQuoteId,
        negotiation_goal_id: body.session.negotiation.negotiationGoalId,
        workflow_id: body.session.negotiation.workflowId,
        specification_hash: body.session.negotiation.specificationHash,
        derived_monthly_effective_cost: formatCents(body.session.negotiation.currentMonthlyEffectiveCostCents),
        policy_period_effective_cost: formatCents(body.session.negotiation.currentPolicyPeriodEffectiveCostCents),
        verified_comparable_monthly_effective_cost: formatCents(
          body.session.negotiation.lowestVerifiedComparableMonthlyEffectiveCostCents,
        ),
        allowed_leverage_text: body.session.negotiation.allowedLeverageText,
        coverage_summary: body.session.negotiation.coverageSummary,
        quote_disclaimer: body.session.negotiation.disclaimer,
        simulated: body.session.negotiation.simulated,
        requires_human_verification: body.session.negotiation.requiresHumanVerification,
      } : undefined;
      const lifecycleCallbacks = {
        clientTools: makeClientTools(session),
        onConnect: ({ conversationId }: { conversationId: string }) => {
          if (!isCurrent(session) || session.endIntent !== null) return;
          setState("active");
          void updateSession(
            session,
            { action: "activate", conversationId },
            "Could not activate the demo session",
          );
        },
        onMessage: ({ message, role }: { message: string; role: "user" | "agent" }) => {
          if (!isCurrent(session) || session.endIntent !== null) return;
          const entry = { role, message, recordedAt: new Date().toISOString() } satisfies TranscriptEntry;
          setTranscript((current) => [...current, entry]);
          void updateSession(
            session,
            { action: "transcript", role, message },
            "Could not save the transcript",
          );
        },
        onError: (message: string) => {
          if (!isCurrent(session) || session.endIntent !== null) return;
          session.endIntent = "fail";
          setError(message);
          setState("failed");
          void updateSession(
            session,
            { action: "fail", errorCode: "ELEVENLABS_CLIENT_ERROR" },
            "Could not record the conversation error",
          );
          endSession();
        },
        onDisconnect: () => {
          if (!isCurrent(session)) return;
          void finalizeDisconnect(session);
        },
      };

      if (body.credential.transport === "webrtc") {
        startSession({
          conversationToken: body.credential.conversationToken,
          connectionType: "webrtc",
          dynamicVariables,
          ...lifecycleCallbacks,
        });
      } else {
        startSession({
          signedUrl: body.credential.signedUrl,
          connectionType: "websocket",
          dynamicVariables,
          ...lifecycleCallbacks,
        });
      }
    } catch (cause) {
      if (createdSessionId) await lifecycle.enqueue(() => patchSession(createdSessionId!, { action: "cancel" }));
      if (controller.signal.aborted || !lifecycle.isCurrent() || !mountedRef.current) return;
      setError(errorMessage(cause, "Could not start the conversation"));
      setState("failed");
    } finally {
      if (lifecycle.isCurrent()) {
        inFlightRef.current = false;
        startAbortRef.current = null;
      }
    }
  }, [
    conversation.status,
    endSession,
    finalizeDisconnect,
    isCurrent,
    makeClientTools,
    patchSession,
    fetchQuoteCollection,
    quoteCollectionStartAttempts,
    startAttempts,
    startSession,
    state,
    updateSession,
  ]);

  const end = useCallback(() => {
    if (state !== "active" && state !== "connecting" && !inFlightRef.current) return;

    startAbortRef.current?.abort();
    startAbortRef.current = null;
    inFlightRef.current = false;
    const session = activeSessionRef.current;

    if (state === "active" && session && isCurrent(session)) {
      session.endIntent = "complete";
      setState("processing");
      void (async () => {
        await updateSession(session, { action: "processing" }, "Could not process the demo session");
        if (isCurrent(session) && session.endIntent === "complete") endSession();
      })();
      return;
    }

    setState("cancelled");
    if (session) {
      session.endIntent = "cancel";
      session.lifecycle.invalidate();
      void session.lifecycle.enqueue(() => patchSession(session.sessionId, { action: "cancel" }));
    } else {
      coordinatorRef.current.invalidate();
    }
    endSession();
  }, [endSession, isCurrent, patchSession, state, updateSession]);

  useEffect(() => {
    const coordinator = coordinatorRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startAbortRef.current?.abort();
      const session = activeSessionRef.current;
      coordinator.invalidate();
      if (session) {
        session.endIntent = "cancel";
        void session.lifecycle.enqueue(() => patchSession(session.sessionId, { action: "cancel" }));
      }
      endSession();
    };
  }, [endSession, patchSession]);

  const sdkDisconnected = conversation.status === "disconnected";
  const canSelectPurpose = sdkDisconnected && !["connecting", "active", "processing"].includes(state);
  const canStartForPurpose = (purpose: DemoConversationRequest["purpose"]) => (
    canSelectPurpose
    && (purpose === "quote_collection"
      ? quoteCollectionStartAttempts < MAX_QUOTE_COLLECTION_START_ATTEMPTS
      : startAttempts < MAX_START_ATTEMPTS)
  );
  return {
    state,
    sdkStatus: conversation.status,
    mode: conversation.mode,
    transcript,
    quoteCollection,
    error,
    canSelectPurpose,
    canStart: canStartForPurpose("voice_smoke"),
    canStartForPurpose,
    canEnd: state === "connecting" || state === "active",
    start,
    end,
  };
}
