import { afterEach, describe, expect, it } from "vitest";

import { isLiveNegotiationConfigured } from "@/backend/app/negotiation-call";

const environment = process.env as Record<string, string | undefined>;
const originalApiKey = environment.ELEVENLABS_API_KEY;
const originalAgentId = environment.ELEVENLABS_NEGOTIATOR_AGENT_ID;
const originalNodeEnv = environment.NODE_ENV;

function restoreEnvironment(): void {
  if (originalApiKey === undefined) delete environment.ELEVENLABS_API_KEY;
  else environment.ELEVENLABS_API_KEY = originalApiKey;
  if (originalAgentId === undefined) delete environment.ELEVENLABS_NEGOTIATOR_AGENT_ID;
  else environment.ELEVENLABS_NEGOTIATOR_AGENT_ID = originalAgentId;
  if (originalNodeEnv === undefined) delete environment.NODE_ENV;
  else environment.NODE_ENV = originalNodeEnv;
}

describe("live negotiation configuration", () => {
  afterEach(restoreEnvironment);

  it("enables the browser call in production when ElevenLabs is configured", () => {
    environment.NODE_ENV = "production";
    environment.ELEVENLABS_API_KEY = "elevenlabs-key";
    environment.ELEVENLABS_NEGOTIATOR_AGENT_ID = "agent-id";

    expect(isLiveNegotiationConfigured()).toBe(true);
  });

  it("requires both ElevenLabs configuration values", () => {
    environment.NODE_ENV = "production";
    environment.ELEVENLABS_API_KEY = "elevenlabs-key";
    delete environment.ELEVENLABS_NEGOTIATOR_AGENT_ID;

    expect(isLiveNegotiationConfigured()).toBe(false);
  });
});
