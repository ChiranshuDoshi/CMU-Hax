import { afterEach, describe, expect, it, vi } from "vitest";

import {
  InMemoryOutboundCallIdempotency,
  handleOutboundCallRequest,
} from "@/app/api/twilio/outbound-call/route";
import {
  TwilioCallPolicyError,
  TwilioConfigurationError,
  type OutboundCallProvider,
} from "@/integrations/twilio";

const originalInternalApiKey = process.env.POLICYSCOUT_INTERNAL_API_KEY;
const originalDemoMode = process.env.DEMO_MODE;

afterEach(() => {
  if (originalInternalApiKey === undefined) delete process.env.POLICYSCOUT_INTERNAL_API_KEY;
  else process.env.POLICYSCOUT_INTERNAL_API_KEY = originalInternalApiKey;
  if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = originalDemoMode;
  vi.unstubAllEnvs();
});

function authorizedRequest(body: unknown, idempotencyKey = "outbound-call-1"): Request {
  process.env.POLICYSCOUT_INTERNAL_API_KEY = "internal-secret";
  process.env.DEMO_MODE = "true";
  return new Request("http://localhost/api/twilio/outbound-call", {
    method: "POST",
    headers: {
      Authorization: "Bearer internal-secret",
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

function provider(
  response: { readonly conversationId: string; readonly callSid: string } = {
    conversationId: "conversation-123",
    callSid: "CA123",
  },
): OutboundCallProvider & { readonly requests: Array<{ readonly toNumber: string }> } {
  const requests: Array<{ readonly toNumber: string }> = [];
  return {
    requests,
    async place(input) {
      requests.push(input);
      return response;
    },
  };
}

describe("Twilio outbound-call route", () => {
  it("requires the internal bearer authorization", async () => {
    process.env.POLICYSCOUT_INTERNAL_API_KEY = "internal-secret";
    process.env.DEMO_MODE = "true";
    const calls = provider();
    const response = await handleOutboundCallRequest(
      new Request("http://localhost/api/twilio/outbound-call", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "outbound-call-1" },
        body: JSON.stringify({ toNumber: "+15551234567" }),
      }),
      calls,
    );

    expect(response.status).toBe(401);
    expect(calls.requests).toEqual([]);
  });

  it("accepts only a destination and returns the safe call identifiers", async () => {
    const calls = provider();
    const response = await handleOutboundCallRequest(
      authorizedRequest({ toNumber: "+15551234567" }),
      calls,
      new InMemoryOutboundCallIdempotency(),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      call: { conversationId: "conversation-123", callSid: "CA123" },
    });
    expect(calls.requests).toEqual([{ toNumber: "+15551234567" }]);
  });

  it("requires an idempotency key before a provider call", async () => {
    process.env.POLICYSCOUT_INTERNAL_API_KEY = "internal-secret";
    process.env.DEMO_MODE = "true";
    const calls = provider();
    const response = await handleOutboundCallRequest(
      new Request("http://localhost/api/twilio/outbound-call", {
        method: "POST",
        headers: { Authorization: "Bearer internal-secret", "Content-Type": "application/json" },
        body: JSON.stringify({ toNumber: "+15551234567" }),
      }),
      calls,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "A valid Idempotency-Key header is required" },
    });
    expect(calls.requests).toEqual([]);
  });

  it("fails closed in production even when demo mode is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const calls = provider();
    const response = await handleOutboundCallRequest(authorizedRequest({ toNumber: "+15551234567" }), calls);

    expect(response.status).toBe(404);
    expect(calls.requests).toEqual([]);
  });

  it("returns the original result instead of placing a duplicate call for a retry", async () => {
    const calls = provider();
    const idempotency = new InMemoryOutboundCallIdempotency();

    const first = await handleOutboundCallRequest(authorizedRequest({ toNumber: "+15551234567" }, "retry-key"), calls, idempotency);
    const retry = await handleOutboundCallRequest(authorizedRequest({ toNumber: "+15551234567" }, "retry-key"), calls, idempotency);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual({
      call: { conversationId: "conversation-123", callSid: "CA123" },
    });
    expect(calls.requests).toEqual([{ toNumber: "+15551234567" }]);
  });

  it("does not retry an ambiguous failed call with the same idempotency key", async () => {
    let calls = 0;
    const failingProvider: OutboundCallProvider = {
      async place() {
        calls += 1;
        throw new Error("response disconnected after a possible call");
      },
    };
    const idempotency = new InMemoryOutboundCallIdempotency();

    const first = await handleOutboundCallRequest(authorizedRequest({ toNumber: "+15551234567" }, "ambiguous-key"), failingProvider, idempotency);
    const retry = await handleOutboundCallRequest(authorizedRequest({ toNumber: "+15551234567" }, "ambiguous-key"), failingProvider, idempotency);

    expect(first.status).toBe(502);
    expect(retry.status).toBe(502);
    expect(calls).toBe(1);
  });

  it("rejects reusing an idempotency key for another destination", async () => {
    const calls = provider();
    const idempotency = new InMemoryOutboundCallIdempotency();

    await handleOutboundCallRequest(authorizedRequest({ toNumber: "+15551234567" }, "shared-key"), calls, idempotency);
    const response = await handleOutboundCallRequest(authorizedRequest({ toNumber: "+15557654321" }, "shared-key"), calls, idempotency);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "IDEMPOTENCY_KEY_CONFLICT", message: "Idempotency key belongs to another destination" },
    });
    expect(calls.requests).toEqual([{ toNumber: "+15551234567" }]);
  });

  it("rejects extra caller-controlled agent and recording fields", async () => {
    const calls = provider();
    const response = await handleOutboundCallRequest(authorizedRequest({
      toNumber: "+15551234567",
      agentId: "attacker-agent",
      callRecordingEnabled: true,
    }), calls);

    expect(response.status).toBe(400);
    expect(calls.requests).toEqual([]);
  });

  it.each([
    [new TwilioCallPolicyError("INVALID_DESTINATION", "actual invalid number"), 400, "INVALID_DESTINATION"],
    [new TwilioCallPolicyError("DESTINATION_NOT_ALLOWED", "actual allowlist contents"), 403, "DESTINATION_NOT_ALLOWED"],
    [new TwilioConfigurationError("ELEVENLABS_API_KEY=secret-value"), 503, "TWILIO_NOT_CONFIGURED"],
    [new Error("provider contains secret-value"), 502, "TWILIO_UNAVAILABLE"],
  ])("sanitizes provider failure %s", async (error, status, code) => {
    const calls: OutboundCallProvider = {
      async place() { throw error; },
    };
    const response = await handleOutboundCallRequest(
      authorizedRequest({ toNumber: "+15551234567" }),
      calls,
      new InMemoryOutboundCallIdempotency(),
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(status);
    expect(serialized).toContain(code);
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("actual invalid number");
    expect(serialized).not.toContain("actual allowlist contents");
  });
});
