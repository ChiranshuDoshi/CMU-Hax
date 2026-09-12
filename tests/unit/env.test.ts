import { describe, it, expect, beforeEach } from "vitest";
import { getEnv, capabilities, resetEnvCache } from "../../src/config/env.js";

beforeEach(() => resetEnvCache());

describe("environment config (test #34)", () => {
  it("boots in fully-mocked demo mode with no credentials", () => {
    const env = getEnv({ DEMO_MODE: "true" } as unknown as NodeJS.ProcessEnv);
    const caps = capabilities(env);
    expect(caps.hasSupabase).toBe(false);
    expect(caps.hasOpenAI).toBe(false);
    expect(caps.hasElevenLabs).toBe(false);
    expect(caps.hasTavily).toBe(false);
    expect(caps.demoMode).toBe(true);
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
  });

  it("detects live capabilities when keys are present", () => {
    const env = getEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "svc",
      ELEVENLABS_API_KEY: "el",
    } as unknown as NodeJS.ProcessEnv);
    const caps = capabilities(env);
    expect(caps.hasSupabase).toBe(true);
    expect(caps.hasElevenLabs).toBe(true);
    expect(caps.hasOpenAI).toBe(false);
  });

  it("rejects an invalid app URL", () => {
    expect(() =>
      getEnv({ NEXT_PUBLIC_APP_URL: "not-a-url" } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/Invalid environment/);
  });
});
