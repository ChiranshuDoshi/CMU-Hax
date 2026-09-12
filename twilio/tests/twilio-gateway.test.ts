import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OutboundCallRequest } from "../src/twilio-gateway.js";

const { createCall, createClient } = vi.hoisted(() => ({
  createCall: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("twilio", () => ({
  default: createClient,
}));

import { createTwilioOutboundCallGateway } from "../src/twilio-gateway.js";

describe("createTwilioOutboundCallGateway", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createClient.mockReturnValue({ calls: { create: createCall } });
  });

  it("creates a call with every supplied Twilio request field and returns its SID", async () => {
    createCall.mockResolvedValue({ sid: "CA_test_call" });
    const request: OutboundCallRequest = {
      to: "+15550000001",
      from: "+15550000002",
      url: "https://voice.example.test/twiml",
      statusCallback: "https://voice.example.test/call-status",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    };

    const gateway = createTwilioOutboundCallGateway({
      accountSid: "test-account-sid",
      authToken: "test-auth-token",
    });

    await expect(gateway.createCall(request)).resolves.toEqual({
      sid: "CA_test_call",
    });
    expect(createClient).toHaveBeenCalledWith(
      "test-account-sid",
      "test-auth-token",
    );
    expect(createCall).toHaveBeenCalledWith({
      to: request.to,
      from: request.from,
      url: request.url,
      statusCallback: request.statusCallback,
      statusCallbackEvent: request.statusCallbackEvent,
    });
  });
});
