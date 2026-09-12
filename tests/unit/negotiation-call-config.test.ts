import { afterEach, describe, expect, it } from "vitest";

import {
  buildNegotiatorInstructions,
  buildNegotiatorSessionConfig,
  isLiveNegotiationConfigured,
} from "@/backend/app/negotiation-call";

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

  it("tells the agent to hang up after the close", () => {
    const vars = {
      userDisplayName: "Alex",
      providerName: "Hilton",
      policyPeriodCost: "$189.00",
      monthlyCost: "$15.75",
      coverageSummary: "Group stay",
      quoteDisclaimer: "Simulated",
      allowedLeverageText: "No comparable",
      verifiedComparableMonthly: "not available",
    };

    expect(buildNegotiatorInstructions(vars)).toContain("Then call end_call");
    expect(buildNegotiatorSessionConfig(vars).tools).toEqual([
      expect.objectContaining({ name: "end_call" }),
    ]);
  });
});
