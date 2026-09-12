import { describe, expect, it } from "vitest";

import {
  ElevenLabsTwilioOutboundCallProvider,
  TwilioCallPolicyError,
  TwilioConfigurationError,
  TwilioOutboundCallError,
  type ElevenLabsTwilioGateway,
} from "@/integrations/twilio";

const baseEnvironment = {
  ELEVENLABS_API_KEY: "elevenlabs-server-secret",
  ELEVENLABS_NEGOTIATOR_AGENT_ID: "agent-negotiator",
  ELEVENLABS_TWILIO_PHONE_NUMBER_ID: "phone-number-id",
  TWILIO_OUTBOUND_ALLOWED_DESTINATIONS: "+15551234567, +15557654321",
};

function gateway(response: Awaited<ReturnType<ElevenLabsTwilioGateway["outboundCall"]>>): ElevenLabsTwilioGateway {
  return { async outboundCall() { return response; } };
}

describe("ElevenLabsTwilioOutboundCallProvider", () => {
  it("places a non-recorded native Twilio call through the configured agent and phone number", async () => {
    const seenConfigurations: unknown[] = [];
    const seenRequests: unknown[] = [];
    const provider = new ElevenLabsTwilioOutboundCallProvider(baseEnvironment, (configuration) => {
      seenConfigurations.push(configuration);
      return {
        async outboundCall(input) {
          seenRequests.push(input);
          return {
            success: true,
            message: "Call started",
            conversationId: "conversation-123",
            callSid: "CA123",
          };
        },
      };
    });

    await expect(provider.place({ toNumber: " +15551234567 " })).resolves.toEqual({
      conversationId: "conversation-123",
      callSid: "CA123",
    });
    expect(seenConfigurations).toEqual([{
      apiKey: "elevenlabs-server-secret",
      timeoutInSeconds: 10,
      maxRetries: 0,
    }]);
    expect(seenRequests).toEqual([{
      agentId: "agent-negotiator",
      agentPhoneNumberId: "phone-number-id",
      toNumber: "+15551234567",
      callRecordingEnabled: false,
    }]);
  });

  it.each([
    [{}, "ELEVENLABS_API_KEY"],
    [{ ELEVENLABS_API_KEY: "key" }, "ELEVENLABS_NEGOTIATOR_AGENT_ID"],
    [{ ELEVENLABS_API_KEY: "key", ELEVENLABS_NEGOTIATOR_AGENT_ID: "agent" }, "ELEVENLABS_TWILIO_PHONE_NUMBER_ID"],
    [{
      ELEVENLABS_API_KEY: "key",
      ELEVENLABS_NEGOTIATOR_AGENT_ID: "agent",
      ELEVENLABS_TWILIO_PHONE_NUMBER_ID: "phone",
    }, "TWILIO_OUTBOUND_ALLOWED_DESTINATIONS"],
  ])("fails closed when %s is missing", async (environment, missingName) => {
    const provider = new ElevenLabsTwilioOutboundCallProvider(environment, () => {
      throw new Error("gateway must not be created");
    });

    await expect(provider.place({ toNumber: "+15551234567" })).rejects.toEqual(
      expect.objectContaining<Partial<TwilioConfigurationError>>({
        code: "TWILIO_NOT_CONFIGURED",
        message: expect.stringContaining(missingName),
      }),
    );
  });

  it("rejects malformed and non-allowlisted destinations before invoking ElevenLabs", async () => {
    const provider = new ElevenLabsTwilioOutboundCallProvider(baseEnvironment, () => {
      throw new Error("gateway must not be created");
    });

    await expect(provider.place({ toNumber: "5551234567" })).rejects.toEqual(
      expect.objectContaining<Partial<TwilioCallPolicyError>>({ code: "INVALID_DESTINATION" }),
    );
    await expect(provider.place({ toNumber: "+15559876543" })).rejects.toEqual(
      expect.objectContaining<Partial<TwilioCallPolicyError>>({ code: "DESTINATION_NOT_ALLOWED" }),
    );
  });

  it("rejects an invalid allowlist configuration", async () => {
    const provider = new ElevenLabsTwilioOutboundCallProvider({
      ...baseEnvironment,
      TWILIO_OUTBOUND_ALLOWED_DESTINATIONS: "+15551234567, not-a-number",
    }, () => gateway({ success: true, message: "unused", conversationId: "unused", callSid: "unused" }));

    await expect(provider.place({ toNumber: "+15551234567" })).rejects.toEqual(
      expect.objectContaining<Partial<TwilioConfigurationError>>({
        code: "TWILIO_NOT_CONFIGURED",
        message: expect.stringContaining("TWILIO_OUTBOUND_ALLOWED_DESTINATIONS"),
      }),
    );
  });

  it.each([
    { success: false, message: "upstream failure", conversationId: "conversation", callSid: "CA123" },
    { success: true, message: "missing conversation", callSid: "CA123" },
    { success: true, message: "missing call", conversationId: "conversation" },
  ])("rejects incomplete provider results without forwarding upstream messages", async (response) => {
    const provider = new ElevenLabsTwilioOutboundCallProvider(baseEnvironment, () => gateway(response));

    await expect(provider.place({ toNumber: "+15551234567" })).rejects.toEqual(
      expect.objectContaining<Partial<TwilioOutboundCallError>>({
        code: "TWILIO_OUTBOUND_CALL_FAILED",
        message: "Outbound call provider returned an incomplete result",
      }),
    );
  });
});
