import { describe, expect, it } from "vitest";

import {
  ElevenLabsConfigurationError,
  ElevenLabsCredentialProvider,
  type ElevenLabsConversationGateway,
} from "@/integrations/elevenlabs/server";

describe("ElevenLabs credential provider", () => {
  it("maps voice smoke to WebRTC and negotiation to a signed WebSocket URL", async () => {
    const calls: string[] = [];
    const gateway: ElevenLabsConversationGateway = {
      async getWebrtcToken({ agentId }) {
        calls.push(`webrtc:${agentId}`);
        return { token: "webrtc-token" };
      },
      async getSignedUrl({ agentId }) {
        calls.push(`websocket:${agentId}`);
        return { signedUrl: "wss://example.test/signed" };
      },
    };
    let receivedApiKey = "";
    const provider = new ElevenLabsCredentialProvider(
      {
        ELEVENLABS_API_KEY: "server-secret",
        ELEVENLABS_VOICE_SMOKE_AGENT_ID: "agent-smoke",
        ELEVENLABS_NEGOTIATOR_AGENT_ID: "agent-negotiator",
      },
      (apiKey) => {
        receivedApiKey = apiKey;
        return gateway;
      },
    );

    await expect(provider.issue("voice_smoke")).resolves.toEqual({
      transport: "webrtc",
      conversationToken: "webrtc-token",
    });
    await expect(provider.issue("negotiation")).resolves.toEqual({
      transport: "websocket",
      signedUrl: "wss://example.test/signed",
    });
    expect(receivedApiKey).toBe("server-secret");
    expect(calls).toEqual(["webrtc:agent-smoke", "websocket:agent-negotiator"]);
  });

  it.each([
    [{}, "ELEVENLABS_API_KEY"],
    [{ ELEVENLABS_API_KEY: "key" }, "ELEVENLABS_VOICE_SMOKE_AGENT_ID"],
  ])("fails closed for missing configuration", async (environment, missingName) => {
    const provider = new ElevenLabsCredentialProvider(environment, () => {
      throw new Error("gateway should not be used");
    });

    await expect(provider.issue("voice_smoke")).rejects.toEqual(
      expect.objectContaining<Partial<ElevenLabsConfigurationError>>({
        name: "ElevenLabsConfigurationError",
        message: expect.stringContaining(missingName),
      }),
    );
  });

  it("requires the negotiator agent configuration independently", async () => {
    const provider = new ElevenLabsCredentialProvider({ ELEVENLABS_API_KEY: "key" });
    await expect(provider.issue("negotiation")).rejects.toEqual(expect.objectContaining({
      name: "ElevenLabsConfigurationError",
      message: expect.stringContaining("ELEVENLABS_NEGOTIATOR_AGENT_ID"),
    }));
  });
});
