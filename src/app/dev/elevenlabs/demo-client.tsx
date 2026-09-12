"use client";

import { useState } from "react";
import { ConversationProvider } from "@elevenlabs/react";

import {
  useDemoConversation,
  type DemoConversationRequest,
  type NegotiationReference,
  type QuoteCollectionReference,
} from "./use-demo-conversation";

type Purpose = DemoConversationRequest["purpose"];

const NEGOTIATION_REFERENCE_KEYS = [
  "providerId",
  "quoteId",
  "selectedAt",
  "specificationHash",
  "workflowId",
] as const;
const QUOTE_COLLECTION_REFERENCE_KEYS = [
  "collectionId",
  "providerId",
  "specificationHash",
  "workflowId",
] as const;
const SPECIFICATION_HASH_PATTERN = /^[a-f0-9]{64}$/;
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNegotiationReference(text: string): NegotiationReference {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Negotiation reference must be valid JSON.");
  }
  if (!isRecord(value)) throw new Error("Negotiation reference must be a JSON object.");
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== NEGOTIATION_REFERENCE_KEYS.join(",")) {
    throw new Error(`Negotiation reference must contain exactly ${NEGOTIATION_REFERENCE_KEYS.join(", ")}.`);
  }
  for (const key of NEGOTIATION_REFERENCE_KEYS) {
    if (typeof value[key] !== "string" || value[key].trim() === "") {
      throw new Error(`${key} must be a non-empty string.`);
    }
  }
  if (!SPECIFICATION_HASH_PATTERN.test(value.specificationHash as string)) {
    throw new Error("specificationHash must be a 64-character lowercase hexadecimal hash.");
  }
  if (
    !ISO_DATETIME_PATTERN.test(value.selectedAt as string)
    || Number.isNaN(Date.parse(value.selectedAt as string))
  ) {
    throw new Error("selectedAt must be a valid UTC date-time string.");
  }
  return value as unknown as NegotiationReference;
}

export function parseQuoteCollectionReference(text: string): QuoteCollectionReference {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Quote collection reference must be valid JSON.");
  }
  if (!isRecord(value)) throw new Error("Quote collection reference must be a JSON object.");
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== QUOTE_COLLECTION_REFERENCE_KEYS.join(",")) {
    throw new Error(`Quote collection reference must contain exactly ${QUOTE_COLLECTION_REFERENCE_KEYS.join(", ")}.`);
  }
  for (const key of QUOTE_COLLECTION_REFERENCE_KEYS) {
    if (typeof value[key] !== "string" || value[key].trim() === "") {
      throw new Error(`${key} must be a non-empty string.`);
    }
  }
  if (!SPECIFICATION_HASH_PATTERN.test(value.specificationHash as string)) {
    throw new Error("specificationHash must be a 64-character lowercase hexadecimal hash.");
  }
  return value as unknown as QuoteCollectionReference;
}

function formatEffectiveComparisonCost(value: number): string {
  return `$${(value / 100).toFixed(2)}`;
}

function DemoControls() {
  const demo = useDemoConversation();
  const [purpose, setPurpose] = useState<Purpose>("voice_smoke");
  const [negotiationJson, setNegotiationJson] = useState("");
  const [quoteCollectionJson, setQuoteCollectionJson] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const start = async () => {
    setInputError(null);
    try {
      const request: DemoConversationRequest = purpose === "voice_smoke"
        ? { purpose }
        : purpose === "negotiation"
          ? { purpose, negotiationReference: parseNegotiationReference(negotiationJson) }
          : { purpose, quoteCollectionReference: parseQuoteCollectionReference(quoteCollectionJson) };
      await demo.start(request);
    } catch (cause) {
      setInputError(cause instanceof Error ? cause.message : "Conversation input is invalid.");
    }
  };

  const startProvider = async (providerId: string) => {
    const context = demo.quoteCollection?.context;
    if (!context) return;
    const reference = {
      collectionId: context.collectionId,
      workflowId: context.workflowId,
      providerId,
      specificationHash: context.specificationHash,
    } satisfies QuoteCollectionReference;
    setPurpose("quote_collection");
    setQuoteCollectionJson(JSON.stringify(reference, null, 2));
    await demo.start({ purpose: "quote_collection", quoteCollectionReference: reference });
  };

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "3rem auto", padding: "0 1rem" }}>
      <h1>ElevenLabs conversation harness</h1>
      <p>This local demo requests temporary credentials from the server and uses your microphone.</p>

      <fieldset disabled={!demo.canSelectPurpose}>
        <legend>Conversation path</legend>
        <label style={{ marginRight: "1rem" }}>
          <input
            type="radio"
            name="purpose"
            value="voice_smoke"
            checked={purpose === "voice_smoke"}
            disabled={!demo.canStartForPurpose("voice_smoke")}
            onChange={() => setPurpose("voice_smoke")}
          /> Voice smoke
        </label>
        <label style={{ marginRight: "1rem" }}>
          <input
            type="radio"
            name="purpose"
            value="negotiation"
            checked={purpose === "negotiation"}
            disabled={!demo.canStartForPurpose("negotiation")}
            onChange={() => setPurpose("negotiation")}
          /> Negotiation
        </label>
        <label>
          <input
            type="radio"
            name="purpose"
            value="quote_collection"
            checked={purpose === "quote_collection"}
            disabled={!demo.canStartForPurpose("quote_collection")}
            onChange={() => setPurpose("quote_collection")}
          /> Quote collection
        </label>
      </fieldset>

      {purpose === "negotiation" ? (
        <p>
          <label htmlFor="negotiation-json">
            Settled negotiation reference JSON: workflowId, providerId, quoteId, specificationHash, selectedAt
          </label>
          <textarea
            id="negotiation-json"
            value={negotiationJson}
            onChange={(event) => setNegotiationJson(event.target.value)}
            rows={8}
            spellCheck={false}
            disabled={!demo.canStartForPurpose("negotiation")}
            aria-describedby={inputError ? "negotiation-input-error" : undefined}
            style={{ display: "block", boxSizing: "border-box", width: "100%", marginTop: "0.5rem" }}
          />
        </p>
      ) : null}

      {purpose === "quote_collection" ? (
        <p>
          <label htmlFor="quote-collection-json">
            Quote collection reference JSON: collectionId, workflowId, providerId, specificationHash
          </label>
          <textarea
            id="quote-collection-json"
            value={quoteCollectionJson}
            onChange={(event) => setQuoteCollectionJson(event.target.value)}
            rows={7}
            spellCheck={false}
            disabled={!demo.canStartForPurpose("quote_collection")}
            aria-describedby={inputError ? "quote-collection-input-error" : undefined}
            style={{ display: "block", boxSizing: "border-box", width: "100%", marginTop: "0.5rem" }}
          />
        </p>
      ) : null}

      <p role="status" aria-live="polite" data-testid="runtime-state">
        {demo.state} · {demo.sdkStatus} · {demo.mode}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
        <button type="button" onClick={() => void start()} disabled={!demo.canStartForPurpose(purpose)}>Start conversation</button>
        <button type="button" onClick={demo.end} disabled={!demo.canEnd}>End conversation</button>
      </div>
      {inputError ? <p id={purpose === "quote_collection" ? "quote-collection-input-error" : "negotiation-input-error"} role="alert">{inputError}</p> : null}
      {demo.error ? <p role="alert">{demo.error}</p> : null}
      {demo.quoteCollection ? (
        <section aria-labelledby="quote-collection-heading">
          <h2 id="quote-collection-heading">Quote collection</h2>
          <p>Current provider: {demo.quoteCollection.context.providerName}</p>
          {demo.quoteCollection.snapshot ? (
            <>
              <p role="status" aria-live="polite">
                {demo.quoteCollection.snapshot.result
                  ? `Lowest comparable quote selected from ${demo.quoteCollection.snapshot.providers.length} providers.`
                  : `${demo.quoteCollection.snapshot.providers.filter((provider) => provider.status === "captured").length} of ${demo.quoteCollection.snapshot.providers.length} provider quotes captured.`}
              </p>
              <h3>Provider status</h3>
              <ul>
                {demo.quoteCollection.snapshot.providers.map((provider) => (
                  <li key={provider.providerId}>
                    {provider.providerName}: {provider.status}
                    {provider.status === "pending" ? (
                      <button
                        type="button"
                        onClick={() => void startProvider(provider.providerId)}
                        disabled={!demo.canStartForPurpose("quote_collection")}
                        style={{ marginLeft: "0.5rem" }}
                      >
                        Call provider
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {demo.quoteCollection.snapshot.result ? (
                <section aria-labelledby="quote-recommendation-heading">
                  <h3 id="quote-recommendation-heading">Lowest comparable price</h3>
                  <p>
                    {demo.quoteCollection.snapshot.result.recommendedProviderName}: {formatEffectiveComparisonCost(
                      demo.quoteCollection.snapshot.result.effectiveComparisonCostCents,
                    )}
                  </p>
                </section>
              ) : <p>Recommendation will appear after all provider calls are recorded.</p>}
            </>
          ) : <p>Loading collection status…</p>}
        </section>
      ) : null}
      <section aria-labelledby="transcript-heading">
        <h2 id="transcript-heading">Transcript</h2>
        {demo.transcript.length === 0 ? <p>No messages yet.</p> : (
          <ol>
            {demo.transcript.map((entry, index) => (
              <li key={`${entry.recordedAt}-${index}`}><strong>{entry.role}:</strong> {entry.message}</li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

export function ElevenLabsDemoClient() {
  return <ConversationProvider><DemoControls /></ConversationProvider>;
}
