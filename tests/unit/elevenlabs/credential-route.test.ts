import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { handleCredentialRequest } from "@/app/api/conversations/credentials/route";
import { requireLocalDemoRequest } from "@/app/api/conversations/_lib";
import type { NegotiationGoal, NegotiationHandoff } from "@/domain/schemas/person4";
import type { ConversationCredentialProvider } from "@/integrations/elevenlabs";
import {
  ConversationSessionService,
  FixedFilePreparedNegotiationContextLoader,
  PreparedNegotiationContextService,
  type PreparedNegotiationContextProvider,
} from "@/server/services/conversations";

const originalDemoMode = process.env.DEMO_MODE;
const specificationHash = "a".repeat(64);

const negotiationHandoff: NegotiationHandoff = {
  workflowId: "workflow-route",
  specificationHash,
  target: {
    providerId: "provider-selected",
    providerName: "Selected Demo Carrier",
    quoteId: "quote-selected",
    scenarioId: "scenario-selected",
    currency: "USD",
    effectiveComparisonCostCents: 60_000,
    annualizedCostCents: 120_000,
    policyTermMonths: 6,
    quoteValidUntil: "2030-01-01T00:00:00.000Z",
    coverageEquivalence: { status: "equivalent", differences: [] },
    recommendationScore: 90,
    selectionExplanation: "Internal ranking rationale",
    evidenceIds: ["target-evidence"],
    simulated: true,
    requiresHumanVerification: true,
    disclaimer: "Simulated quote not supplied by the insurer and not binding.",
  },
  verifiedCompetingQuote: null,
  requestedOutcome: "lower_price_with_same_or_better_coverage",
  selectionSource: "system_recommendation",
  generatedAt: "2029-01-01T00:00:00.000Z",
};

const negotiationGoal: NegotiationGoal = {
  id: "goal-route",
  workflowId: "workflow-route",
  selectedQuoteId: "quote-selected",
  targetProviderId: "provider-selected",
  targetAmountCents: 50_001,
  targetRangeMinCents: null,
  targetRangeMaxCents: null,
  billingFrequency: "semiannual",
  desiredNonPriceImprovements: [],
  allowedTradeoffs: [],
  hardStops: ["private ceiling 70001"],
  verifiedCompetingQuoteId: null,
  disclosurePolicy: "do_not_reveal_ceiling",
  confirmedAt: "2029-01-01T00:01:00.000Z",
};

afterEach(() => {
  if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = originalDemoMode;
});

function localHeaders(): HeadersInit {
  return { "Content-Type": "application/json", Origin: "http://localhost" };
}

const explicitSelection = {
  quoteId: "quote-selected",
  providerId: "provider-selected",
  specificationHash,
  selectedAt: "2029-01-01T00:02:00.000Z",
};

const negotiationReference = {
  workflowId: "workflow-route",
  providerId: "provider-selected",
  quoteId: "quote-selected",
  specificationHash,
  selectedAt: "2029-01-01T00:02:00.000Z",
};
const participant = { displayName: "Alex Morgan" };

function preparedContexts(
  prepared: unknown = { participant, handoff: negotiationHandoff, goal: negotiationGoal, explicitSelection },
): PreparedNegotiationContextProvider {
  return new PreparedNegotiationContextService({ async load() { return prepared; } });
}

describe("ElevenLabs credential route", () => {
  it("binds the supported development server to localhost", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { scripts?: { dev?: string } };

    expect(packageJson.scripts?.dev).toMatch(/(?:^|\s)(?:-H|--hostname)(?:=|\s+)localhost(?:\s|$)/);
  });

  it("issues only the purpose-mapped temporary credential and no API key", async () => {
    process.env.DEMO_MODE = "true";
    const seenPurposes: string[] = [];
    const credentials: ConversationCredentialProvider = {
      async issue(purpose) {
        seenPurposes.push(purpose);
        return { transport: "webrtc", conversationToken: "temporary-token" };
      },
    };

    const response = await handleCredentialRequest(
      new Request("http://localhost/api/conversations/credentials", {
        method: "POST",
        headers: localHeaders(),
        body: JSON.stringify({ purpose: "voice_smoke" }),
      }),
      { credentials, sessions: new ConversationSessionService(), negotiationContexts: preparedContexts() },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(seenPurposes).toEqual(["voice_smoke"]);
    expect(body.credential).toEqual({ transport: "webrtc", conversationToken: "temporary-token" });
    expect(JSON.stringify(body)).not.toContain("apiKey");
  });

  it("rejects arbitrary purposes and fails closed outside demo mode", async () => {
    delete process.env.DEMO_MODE;
    const credentials: ConversationCredentialProvider = {
      async issue() {
        throw new Error("must not be called");
      },
    };
    const response = await handleCredentialRequest(
      new Request("http://localhost/api/conversations/credentials", {
        method: "POST",
        headers: localHeaders(),
        body: JSON.stringify({ purpose: "arbitrary", agentId: "attacker-agent" }),
      }),
      { credentials, sessions: new ConversationSessionService(), negotiationContexts: preparedContexts() },
    );

    expect(response.status).toBe(404);
  });

  it("serializes only client-safe negotiation context with effective-cost names", async () => {
    process.env.DEMO_MODE = "true";
    const credentials: ConversationCredentialProvider = {
      async issue() {
        return { transport: "websocket", signedUrl: "wss://example.test/temporary" };
      },
    };
    const response = await handleCredentialRequest(
      new Request("http://localhost/api/conversations/credentials", {
        method: "POST",
        headers: localHeaders(),
        body: JSON.stringify({
          purpose: "negotiation",
          negotiationReference,
        }),
      }),
      { credentials, sessions: new ConversationSessionService(), negotiationContexts: preparedContexts() },
    );
    const body = await response.json();
    const context = body.session.negotiation as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(201);
    expect(Object.keys(context).sort()).toEqual([
      "aiDisclosure",
      "allowedLeverageText",
      "coverageSummary",
      "currentMonthlyEffectiveCostCents",
      "currentPolicyPeriodEffectiveCostCents",
      "disclaimer",
      "lowestVerifiedComparableMonthlyEffectiveCostCents",
      "negotiationGoalId",
      "requiresHumanVerification",
      "selectedProviderName",
      "selectedQuoteId",
      "simulated",
      "specificationHash",
      "targetProviderId",
      "userDisplayName",
      "workflowId",
    ].sort());
    expect(context.currentMonthlyEffectiveCostCents).toBe(10_000);
    expect(context.negotiationGoalId).toBe("goal-route");
    expect(context.userDisplayName).toBe("Alex Morgan");
    expect(serialized).not.toContain("targetAmountCents");
    expect(serialized).not.toContain("targetRange");
    expect(serialized).not.toContain("50001");
    expect(serialized).not.toContain("70001");
    expect(serialized).not.toContain("hardStops");
    expect(serialized).not.toContain("Internal ranking rationale");
    expect(serialized).not.toContain("PremiumCents");
  });

  it("rejects client-supplied goal data before loading prepared context", async () => {
    process.env.DEMO_MODE = "true";
    let loaded = false;
    const response = await handleCredentialRequest(
      new Request("http://localhost/api/conversations/credentials", {
        method: "POST",
        headers: localHeaders(),
        body: JSON.stringify({
          purpose: "negotiation",
          negotiationReference: { ...negotiationReference, targetAmountCents: 1 },
          goal: negotiationGoal,
        }),
      }),
      {
        credentials: { async issue() { throw new Error("must not be called"); } },
        sessions: new ConversationSessionService(),
        negotiationContexts: { async load() { loaded = true; throw new Error("must not load"); } },
      },
    );

    expect(response.status).toBe(400);
    expect(loaded).toBe(false);
    expect(JSON.stringify(await response.json())).not.toContain("50001");
  });

  it("rejects a reference that does not exactly match the prepared selection", async () => {
    process.env.DEMO_MODE = "true";
    const response = await handleCredentialRequest(
      new Request("http://localhost/api/conversations/credentials", {
        method: "POST",
        headers: localHeaders(),
        body: JSON.stringify({
          purpose: "negotiation",
          negotiationReference: { ...negotiationReference, selectedAt: "2029-01-01T00:03:00.000Z" },
        }),
      }),
      {
        credentials: { async issue() { throw new Error("must not be called"); } },
        sessions: new ConversationSessionService(),
        negotiationContexts: preparedContexts(),
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "NEGOTIATION_REFERENCE_MISMATCH",
        message: "Negotiation reference does not match the prepared context",
      },
    });
  });

  it.each([
    ["missing", new PreparedNegotiationContextService(
      new FixedFilePreparedNegotiationContextLoader("/tmp/person3-context-that-does-not-exist.json"),
    ), "PREPARED_CONTEXT_UNAVAILABLE"],
    ["malformed", preparedContexts({ goal: negotiationGoal }), "PREPARED_CONTEXT_INVALID"],
  ])("returns a sanitized 503 for %s prepared context", async (_label, negotiationContexts, code) => {
    process.env.DEMO_MODE = "true";
    const response = await handleCredentialRequest(
      new Request("http://localhost/api/conversations/credentials", {
        method: "POST",
        headers: localHeaders(),
        body: JSON.stringify({ purpose: "negotiation", negotiationReference }),
      }),
      {
        credentials: { async issue() { throw new Error("must not be called"); } },
        sessions: new ConversationSessionService(),
        negotiationContexts,
      },
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(serialized).toContain(code);
    expect(serialized).not.toContain("50001");
    expect(serialized).not.toContain("private ceiling");
  });

  it.each([
    ["non-loopback", "http://example.test/api/conversations/credentials", "http://example.test", 403],
    ["cross-origin", "http://localhost/api/conversations/credentials", "http://evil.test", 403],
  ])("rejects %s requests", async (_label, url, origin, status) => {
    process.env.DEMO_MODE = "true";
    const credentials: ConversationCredentialProvider = {
      async issue() {
        throw new Error("must not be called");
      },
    };
    const response = await handleCredentialRequest(
      new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ purpose: "voice_smoke" }),
      }),
      { credentials, sessions: new ConversationSessionService(), negotiationContexts: preparedContexts() },
    );

    expect(response.status).toBe(status);
  });

  it("rejects production even when demo mode is set", () => {
    const request = new Request("http://localhost/api/conversations/credentials", { headers: localHeaders() });
    expect(() => requireLocalDemoRequest(request, { DEMO_MODE: "true", NODE_ENV: "production" })).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
  });

  it("sanitizes upstream credential failures", async () => {
    process.env.DEMO_MODE = "true";
    const response = await handleCredentialRequest(
      new Request("http://localhost/api/conversations/credentials", {
        method: "POST",
        headers: localHeaders(),
        body: JSON.stringify({ purpose: "voice_smoke" }),
      }),
      {
        credentials: { async issue() { throw new Error("secret-upstream-detail"); } },
        sessions: new ConversationSessionService(),
        negotiationContexts: preparedContexts(),
      },
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(502);
    expect(serialized).toContain("ELEVENLABS_UNAVAILABLE");
    expect(serialized).not.toContain("secret-upstream-detail");
  });
});
