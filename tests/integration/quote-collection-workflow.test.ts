import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ConversationSessionService,
  QuoteCollectionService,
  type QuoteCapture,
} from "@/server/services/conversations";

import { createConfirmedRequest, SPECIFICATION_HASH } from "../unit/recommendation/factories";
import { createProviderRanking } from "../unit/handoff/factories";

const CREATED_AT = "2026-07-18T12:00:00.000Z";
const QUOTE_VALID_UNTIL = "2030-08-30T12:00:00.000Z";

function context(artifactDirectory = resolve(process.cwd(), ".artifacts", "quote-collection-test")) {
  const quoteRequest = createConfirmedRequest();
  return {
    collectionId: "collection-1",
    quoteRequest,
    providerRanking: createProviderRanking(),
    providerSafeBrief: "Demo customer has a confirmed personal-auto profile. Do not disclose negotiation data.",
    artifactDirectory,
    createdAt: CREATED_AT,
  };
}

async function readJsonArtifact<T>(directory: string, fileName: string): Promise<T> {
  return JSON.parse(await readFile(resolve(directory, fileName), "utf8")) as T;
}

function capture(cost: number, providerResponse: string): QuoteCapture {
  return {
    totalPolicyTermCostCents: cost,
    policyTermMonths: 12,
    feesAndTaxesIncluded: true,
    coverageMatchesRequested: true,
    effectiveDate: "2026-08-01",
    quoteValidUntil: QUOTE_VALID_UNTIL,
    providerResponse,
  };
}

describe("voice quote collection workflow", () => {
  it("simulates a deterministic Top Five collection without creating Negotiator leverage", async () => {
    const artifactDirectory = resolve(process.cwd(), ".artifacts", `quote-collection-test-${randomUUID()}`);
    const prepared = context(artifactDirectory);
    const collections = new QuoteCollectionService({ async load() { return prepared; } });
    const reference = {
      collectionId: prepared.collectionId,
      workflowId: prepared.quoteRequest.workflowId,
      specificationHash: SPECIFICATION_HASH,
    };
    const expectedProviderIds = prepared.providerRanking.selected.map((provider) => provider.providerId);
    const recommendedProvider = prepared.providerRanking.selected[2]!;

    try {
      const firstSnapshot = await collections.simulate(reference);

      expect(firstSnapshot.providers).toHaveLength(5);
      expect(firstSnapshot.providers.map((provider) => provider.status)).toEqual([
        "captured",
        "captured",
        "captured",
        "captured",
        "captured",
      ]);
      expect(firstSnapshot.conversations).toHaveLength(5);
      expect(firstSnapshot.conversations.map((conversation) => conversation.providerId)).toEqual(expectedProviderIds);
      expect(firstSnapshot.conversations.every((conversation) => conversation.simulated)).toBe(true);
      expect(firstSnapshot.conversations.map((conversation) => conversation.conversationId)).toEqual(
        expectedProviderIds.map((providerId) => `simulated-quote-call:${prepared.collectionId}:${providerId}`),
      );
      expect(firstSnapshot.conversations.map((conversation) => (
        conversation.transcript.map((entry) => entry.label)
      ))).toEqual(expectedProviderIds.map(() => [
        "caller_request",
        "provider_quote",
        "caller_confirmation",
        "provider_confirmation",
      ]));
      expect(firstSnapshot.result).toMatchObject({
        recommendedProviderName: recommendedProvider.providerName,
        effectiveComparisonCostCents: 119_900,
        negotiationHandoff: {
          target: {
            providerId: recommendedProvider.providerId,
            sourceConversationId: `simulated-quote-call:${prepared.collectionId}:${recommendedProvider.providerId}`,
            scenarioId: null,
            simulated: true,
            requiresHumanVerification: true,
          },
          verifiedCompetingQuote: null,
        },
      });

      const [rawQuotes, normalizedQuotes, recommendation, handoff, conversations] = await Promise.all([
        readJsonArtifact<{ quotes: Array<{ providerId: string; quoteId: string; simulated: boolean; sourceConversationId: string }> }>(artifactDirectory, "raw-quotes.json"),
        readJsonArtifact<{ quotes: Array<{ providerId: string; quoteId: string; simulated: boolean; sourceConversationId: string }> }>(artifactDirectory, "normalized-quotes.json"),
        readJsonArtifact<{ recommendation: { rankedQualifyingQuotes: Array<{ providerId: string }>; recommendedQuoteId: string }; negotiationHandoff: unknown }>(artifactDirectory, "recommendation.json"),
        readJsonArtifact<{ target: { providerId: string; quoteId: string; simulated: boolean; requiresHumanVerification: boolean }; verifiedCompetingQuote: null }>(artifactDirectory, "person3-handoff.json"),
        readJsonArtifact<{ conversations: typeof firstSnapshot.conversations }>(artifactDirectory, "conversations.json"),
      ]);

      expect(rawQuotes.quotes.map((quote) => quote.providerId)).toEqual(expectedProviderIds);
      expect(normalizedQuotes.quotes.map((quote) => quote.providerId)).toEqual(expectedProviderIds);
      expect(rawQuotes.quotes.every((quote) => quote.simulated)).toBe(true);
      expect(normalizedQuotes.quotes.every((quote) => quote.simulated)).toBe(true);
      expect(normalizedQuotes.quotes.map((quote) => quote.quoteId)).toEqual(rawQuotes.quotes.map((quote) => quote.quoteId));
      expect(normalizedQuotes.quotes.map((quote) => quote.sourceConversationId)).toEqual(
        firstSnapshot.conversations.map((conversation) => conversation.conversationId),
      );
      const rankedProviderIds = recommendation.recommendation.rankedQualifyingQuotes.map((quote) => quote.providerId);
      expect(rankedProviderIds).toHaveLength(5);
      expect(rankedProviderIds[0]).toBe(recommendedProvider.providerId);
      expect([...rankedProviderIds].sort()).toEqual([...expectedProviderIds].sort());
      expect(recommendation.recommendation.recommendedQuoteId).toBe(handoff.target.quoteId);
      expect(recommendation.negotiationHandoff).toEqual(handoff);
      expect(handoff).toMatchObject({
        target: {
          providerId: recommendedProvider.providerId,
          simulated: true,
          requiresHumanVerification: true,
        },
        verifiedCompetingQuote: null,
      });
      expect(conversations.conversations).toEqual(firstSnapshot.conversations);

      const repeatedSnapshot = await collections.simulate(reference);
      expect(repeatedSnapshot).toEqual(firstSnapshot);
      expect(repeatedSnapshot.conversations).toHaveLength(5);
      expect((await readJsonArtifact<{ quotes: unknown[] }>(artifactDirectory, "raw-quotes.json")).quotes).toHaveLength(5);
    } finally {
      await rm(artifactDirectory, { recursive: true, force: true });
    }
  });

  it("captures one transcript-backed quote per Top Five provider and automatically selects the lowest all-in total", async () => {
    const prepared = context();
    const collections = new QuoteCollectionService(
      { async load() { return prepared; } },
      async () => undefined,
    );
    const sessions = new ConversationSessionService();

    for (const [index, provider] of prepared.providerRanking.selected.entries()) {
      const callContext = await collections.prepare({
        collectionId: prepared.collectionId,
        workflowId: prepared.quoteRequest.workflowId,
        providerId: provider.providerId,
        specificationHash: SPECIFICATION_HASH,
      });
      const created = sessions.create("quote_collection", undefined, callContext);
      collections.reserve(sessions.get(created.id));
      sessions.activate(created.id, `conversation-${index + 1}`);
      const providerResponse = `Our all-in 12-month total is $${1_500 - index * 100}; fees and taxes are included, and requested coverage matches.`;
      sessions.appendTranscript(created.id, { role: "user", message: providerResponse });
      await collections.capture(sessions.get(created.id), capture((1_500 - index * 100) * 100, providerResponse));
    }

    const snapshot = collections.get(prepared.collectionId);
    expect(snapshot.providers.every((provider) => provider.status === "captured")).toBe(true);
    expect(snapshot.result).toMatchObject({
      recommendedProviderName: prepared.providerRanking.selected[4]?.providerName,
      effectiveComparisonCostCents: 110_000,
      negotiationHandoff: {
        target: {
          providerId: prepared.providerRanking.selected[4]?.providerId,
          sourceConversationId: "conversation-5",
          scenarioId: null,
          simulated: true,
          requiresHumanVerification: true,
        },
        verifiedCompetingQuote: null,
      },
    });
  });

  it("rejects captures without provider transcript evidence and duplicate provider quotes", async () => {
    const prepared = context();
    const collections = new QuoteCollectionService(
      { async load() { return prepared; } },
      async () => undefined,
    );
    const sessions = new ConversationSessionService();
    const provider = prepared.providerRanking.selected[0]!;
    const callContext = await collections.prepare({
      collectionId: prepared.collectionId,
      workflowId: prepared.quoteRequest.workflowId,
      providerId: provider.providerId,
      specificationHash: SPECIFICATION_HASH,
    });
    const created = sessions.create("quote_collection", undefined, callContext);
    collections.reserve(sessions.get(created.id));
    sessions.activate(created.id, "conversation-1");
    const response = "Our all-in policy term total is $1,500 with fees included and matching coverage.";

    await expect(collections.capture(sessions.get(created.id), capture(150_000, response))).rejects.toMatchObject({
      code: "QUOTE_EVIDENCE_MISSING",
    });
    sessions.appendTranscript(created.id, { role: "user", message: response });
    await collections.capture(sessions.get(created.id), capture(150_000, response));
    await expect(collections.capture(sessions.get(created.id), capture(150_000, response))).rejects.toMatchObject({
      code: "QUOTE_ALREADY_CAPTURED",
    });
  });

  it("reserves one active session per provider and releases an unfinished cancelled call", async () => {
    const prepared = context();
    const collections = new QuoteCollectionService(
      { async load() { return prepared; } },
      async () => undefined,
    );
    const sessions = new ConversationSessionService();
    const provider = prepared.providerRanking.selected[0]!;
    const reference = {
      collectionId: prepared.collectionId,
      workflowId: prepared.quoteRequest.workflowId,
      providerId: provider.providerId,
      specificationHash: SPECIFICATION_HASH,
    };
    const first = sessions.create("quote_collection", undefined, await collections.prepare(reference));
    collections.reserve(first);
    const replay = sessions.create("quote_collection", undefined, await collections.prepare(reference));
    expect(() => collections.reserve(replay)).toThrowError(expect.objectContaining({ code: "QUOTE_CALL_IN_PROGRESS" }));

    collections.release(sessions.cancel(first.id));
    collections.reserve(replay);
    expect(collections.get(prepared.collectionId).providers[0]?.status).toBe("active");
  });
});
