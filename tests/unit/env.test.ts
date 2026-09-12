import { describe, it, expect, beforeEach } from "vitest";
import { getEnv, capabilities, resetEnvCache } from "../../src/config/env.js";

beforeEach(() => resetEnvCache());

describe("environment config (test #34)", () => {
  it("boots in fully-mocked demo mode with no credentials", () => {
    const env = getEnv({ DEMO_MODE: "true" } as unknown as NodeJS.ProcessEnv);
    const caps = capabilities(env);
    expect(caps.hasSupabase).toBe(false);
    expect(caps.hasIfm).toBe(false);
    expect(caps.hasElevenLabs).toBe(false);
    expect(caps.hasXai).toBe(false);
    expect(caps.hasQuerit).toBe(false);
    expect(caps.hasTavily).toBe(false);
    expect(caps.demoMode).toBe(true);
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
  });

  it("detects live capabilities when keys are present", () => {
    const env = getEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "svc",
      ELEVENLABS_API_KEY: "el",
      XAI_API_KEY: "xai",
      IFM_API_KEY: "ifm",
      QUERIT_API_KEY: "querit",
    } as unknown as NodeJS.ProcessEnv);
    const caps = capabilities(env);
    expect(caps.hasSupabase).toBe(true);
    expect(caps.hasElevenLabs).toBe(true);
    expect(caps.hasXai).toBe(true);
    expect(caps.hasIfm).toBe(true);
    expect(caps.hasQuerit).toBe(true);
    expect(env.IFM_MODEL).toBe("IFM/K2-Horizon-375B-A23B");
  });

  it("rejects an invalid app URL", () => {
    expect(() =>
      getEnv({ NEXT_PUBLIC_APP_URL: "not-a-url" } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/Invalid environment/);
  });
});
