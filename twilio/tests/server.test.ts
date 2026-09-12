import { type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import { createTwilioServer } from "../src/server.js";
import type { OutboundCallGateway } from "../src/twilio-gateway.js";

interface TestRequest {
  readonly method: string;
  readonly path: string;
  readonly headers?: IncomingHttpHeaders;
  readonly body?: string;
}

interface TestResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const liveConfig = () => loadConfig({
  TWILIO_ACCOUNT_SID: "AC_test_account",
  TWILIO_AUTH_TOKEN: "test-auth-token",
  TWILIO_PHONE_NUMBER: "+15551234567",
  TWILIO_PUBLIC_WEBHOOK_BASE_URL: "https://calls.example.test",
  TWILIO_INTERNAL_API_TOKEN: "internal-test-token",
  TWILIO_OUTBOUND_ALLOWED_DESTINATIONS: "+15557654321",
});

async function dispatch(server: Server, input: TestRequest): Promise<TestResponse> {
  const request = Object.assign(
    Readable.from(input.body === undefined ? [] : [Buffer.from(input.body)]),
    {
      method: input.method,
      url: input.path,
      headers: input.headers ?? {},
    },
  ) as IncomingMessage;

  return new Promise<TestResponse>((resolve) => {
    let status = 200;
    let headers: Record<string, string> = {};
    const response = {
      writeHead(nextStatus: number, nextHeaders: Record<string, string>) {
        status = nextStatus;
        headers = nextHeaders;
        return response;
      },
      end(chunk?: string | Buffer) {
        resolve({
          status,
          headers,
          body: chunk === undefined ? "" : String(chunk),
        });
        return response;
      },
    } as unknown as ServerResponse;

    server.emit("request", request, response);
  });
}

describe("Twilio gateway HTTP server", () => {
  it("reports a healthy but inactive service without Twilio credentials", async () => {
    const response = await dispatch(createTwilioServer({ config: loadConfig({}) }), {
      method: "GET",
      path: "/health",
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: "ok",
      twilioConfigured: false,
      outboundCallingEnabled: false,
    });
  });

  it("rejects an unsigned inbound voice webhook", async () => {
    const validate = vi.fn(() => false);
    const response = await dispatch(createTwilioServer({ config: liveConfig(), signatureValidator: validate }), {
      method: "POST",
      path: "/webhooks/voice/inbound",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ CallSid: "CA123", From: "+15550000001", To: "+15551234567" }).toString(),
    });

    expect(response.status).toBe(401);
    expect(validate).not.toHaveBeenCalled();
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "INVALID_TWILIO_SIGNATURE", message: "Twilio signature validation failed" },
    });
  });

  it("validates a voice webhook and emits the safe fallback TwiML", async () => {
    const validate = vi.fn(() => true);
    const response = await dispatch(createTwilioServer({ config: liveConfig(), signatureValidator: validate }), {
      method: "POST",
      path: "/webhooks/voice/inbound",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "valid-signature",
      },
      body: new URLSearchParams({ CallSid: "CA123", From: "+15550000001", To: "+15551234567" }).toString(),
    });

    expect(response.status).toBe(200);
    expect(response.headers["Content-Type"]).toContain("text/xml");
    expect(response.body).toContain("The AI voice service has not been connected");
    expect(validate).toHaveBeenCalledWith(
      "test-auth-token",
      "valid-signature",
      "https://calls.example.test/webhooks/voice/inbound",
      { CallSid: "CA123", From: "+15550000001", To: "+15551234567" },
    );
  });

  it("validates and acknowledges a status callback without exposing call data", async () => {
    const validate = vi.fn(() => true);
    const response = await dispatch(createTwilioServer({ config: liveConfig(), signatureValidator: validate }), {
      method: "POST",
      path: "/webhooks/status",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "valid-signature",
      },
      body: new URLSearchParams({ CallSid: "CA123", CallStatus: "completed" }).toString(),
    });

    expect(response.status).toBe(204);
    expect(response.body).toBe("");
    expect(validate).toHaveBeenCalledWith(
      "test-auth-token",
      "valid-signature",
      "https://calls.example.test/webhooks/status",
      { CallSid: "CA123", CallStatus: "completed" },
    );
  });

  it("authorizes, allowlists, and idempotently creates an outbound call", async () => {
    const createCall = vi.fn(async () => ({ sid: "CA_new_call" }));
    const gateway: OutboundCallGateway = { createCall };
    const server = createTwilioServer({ config: liveConfig(), gateway });
    const input: TestRequest = {
      method: "POST",
      path: "/calls",
      headers: {
        authorization: "Bearer internal-test-token",
        "content-type": "application/json",
        "idempotency-key": "call-once",
      },
      body: JSON.stringify({ to: "+15557654321" }),
    };

    const first = await dispatch(server, input);
    const retry = await dispatch(server, input);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(JSON.parse(first.body)).toEqual({ call: { sid: "CA_new_call" } });
    expect(JSON.parse(retry.body)).toEqual({ call: { sid: "CA_new_call" } });
    expect(createCall).toHaveBeenCalledTimes(1);
    expect(createCall).toHaveBeenCalledWith({
      to: "+15557654321",
      from: "+15551234567",
      url: "https://calls.example.test/webhooks/voice/outbound",
      statusCallback: "https://calls.example.test/webhooks/status",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });
  });

  it("does not invoke Twilio for an unauthorized outbound call", async () => {
    const createCall = vi.fn(async () => ({ sid: "CA_unused" }));
    const gateway: OutboundCallGateway = { createCall };
    const response = await dispatch(createTwilioServer({ config: liveConfig(), gateway }), {
      method: "POST",
      path: "/calls",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "blocked-call",
      },
      body: JSON.stringify({ to: "+15557654321" }),
    });

    expect(response.status).toBe(401);
    expect(createCall).not.toHaveBeenCalled();
  });
});
