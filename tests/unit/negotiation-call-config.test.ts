import { afterEach, describe, expect, it } from "vitest";

import { isLiveNegotiationConfigured } from "@/backend/app/negotiation-call";

const environment = process.env as Record<string, string | undefined>;
const originalApiKey = environment.XAI_API_KEY;
const originalNodeEnv = environment.NODE_ENV;

function restoreEnvironment(): void {
  if (originalApiKey === undefined) delete environment.XAI_API_KEY;
  else environment.XAI_API_KEY = originalApiKey;
  if (originalNodeEnv === undefined) delete environment.NODE_ENV;
  else environment.NODE_ENV = originalNodeEnv;
}

describe("live negotiation configuration", () => {
  afterEach(restoreEnvironment);

  it("enables the browser call when Grok Voice is configured", () => {
    environment.NODE_ENV = "production";
    environment.XAI_API_KEY = "xai-key";

    expect(isLiveNegotiationConfigured()).toBe(true);
  });

  it("requires XAI_API_KEY", () => {
    environment.NODE_ENV = "production";
    delete environment.XAI_API_KEY;

    expect(isLiveNegotiationConfigured()).toBe(false);
  });
});
