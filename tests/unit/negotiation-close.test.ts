import { describe, expect, it } from "vitest";

import {
  looksLikeNegotiationClose,
  shouldAutoEndCall,
} from "../../src/components/showcase/negotiationClose.js";

describe("looksLikeNegotiationClose", () => {
  it("accepts a confirmed-rate close", () => {
    expect(
      looksLikeNegotiationClose("I'll lock in $189 a night. Thanks for your time."),
    ).toBe(true);
    expect(looksLikeNegotiationClose("Great, I'll take $180 a night. Thank you.")).toBe(true);
  });

  it("accepts a deadlock close", () => {
    expect(
      looksLikeNegotiationClose("We'll leave the rate as quoted. Have a good day."),
    ).toBe(true);
  });

  it("rejects the opening line", () => {
    expect(
      looksLikeNegotiationClose(
        "Hi, I'm StayScout, calling on behalf of the group. What can you do to lower the nightly price?",
      ),
    ).toBe(false);
  });

  it("rejects a mid-negotiation ask", () => {
    expect(
      looksLikeNegotiationClose("I'll lock that in if you can include breakfast."),
    ).toBe(false);
    expect(
      looksLikeNegotiationClose("What can you do on the nightly rate?"),
    ).toBe(false);
  });
});

describe("shouldAutoEndCall", () => {
  it("waits for a real back-and-forth", () => {
    expect(
      shouldAutoEndCall({
        userTurns: 1,
        lastAgentText: "We'll take that at $189. Have a good day.",
      }),
    ).toBe(false);
  });

  it("ends after the hotel has answered twice and the agent closes", () => {
    expect(
      shouldAutoEndCall({
        userTurns: 2,
        lastAgentText: "We're all set at $189 a night. I'll let you go.",
      }),
    ).toBe(true);
  });
});
