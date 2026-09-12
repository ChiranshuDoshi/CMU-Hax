import { describe, expect, it } from "vitest";

import {
  collapseTranscript,
  deriveLiveCallOutcome,
  parseNightlyAmountsCents,
} from "@/backend/app/live-call-outcome";

describe("parseNightlyAmountsCents", () => {
  it("reads dollar, spoken, and offered nightly rates", () => {
    expect(parseNightlyAmountsCents("I can do $175 a night.")).toEqual([17500]);
    expect(parseNightlyAmountsCents("160 dollars is my final.")).toEqual([16000]);
    expect(parseNightlyAmountsCents("We can do 155 per night.")).toEqual([15500]);
    expect(parseNightlyAmountsCents("Alright, I'll take 150.")).toEqual([15000]);
    expect(parseNightlyAmountsCents("I can lower it by twenty dollars.")).toEqual([2000]);
  });
});

describe("collapseTranscript", () => {
  it("keeps only the longest progressive STT line", () => {
    const collapsed = collapseTranscript([
      { role: "user", message: "I think", timeInCallSecs: 14 },
      { role: "user", message: "I think I can lower it by", timeInCallSecs: 15 },
      { role: "user", message: "I think I can lower it by twenty dollars.", timeInCallSecs: 16 },
      { role: "user", message: "I think I can lower it by twenty dollars per room.", timeInCallSecs: 17 },
      { role: "agent", message: "That's a strong start.", timeInCallSecs: 22 },
    ]);

    expect(collapsed).toHaveLength(2);
    expect(collapsed[0]?.message).toBe("I think I can lower it by twenty dollars per room.");
  });
});

describe("deriveLiveCallOutcome", () => {
  it("uses the last confirmed hotel rate, not a simulated concession", () => {
    const outcome = deriveLiveCallOutcome({
      originalCents: 21000,
      targetCents: 17000,
      providerName: "Hilton",
      transcript: [
        { role: "agent", message: "We're reviewing Hilton's $210 group rate.", timeInCallSecs: 2 },
        { role: "user", message: "I can do 190 a night for the block.", timeInCallSecs: 12 },
        { role: "agent", message: "Can you come down to 170?", timeInCallSecs: 20 },
        { role: "user", message: "That's too low. Final is 180 dollars.", timeInCallSecs: 28 },
        { role: "agent", message: "We'll take that. I'll lock in $180. Thank you.", timeInCallSecs: 36 },
      ],
    });

    expect(outcome.finalCents).toBe(18000);
    expect(outcome.targetMet).toBe(false);
    expect(outcome.summary).toContain("$180.00");
    expect(outcome.summary).toContain("Hilton");
    expect(outcome.steps[0]?.amountCents).toBe(21000);
    expect(outcome.steps.at(-1)?.amountCents).toBe(18000);
    expect(outcome.steps.some((step) => step.label.includes("Breakfast"))).toBe(false);
  });

  it("keeps the opening rate when nobody named a new price", () => {
    const outcome = deriveLiveCallOutcome({
      originalCents: 24800,
      targetCents: 20000,
      providerName: "Marriott",
      transcript: [
        { role: "agent", message: "What can you do on the nightly price?", timeInCallSecs: 3 },
        { role: "user", message: "That's our best available rate.", timeInCallSecs: 10 },
        { role: "agent", message: "Understood. I'll leave it as quoted. Thank you.", timeInCallSecs: 16 },
      ],
    });

    expect(outcome.finalCents).toBe(24800);
    expect(outcome.summary).toContain("did not change");
    expect(outcome.steps.at(-1)?.label).toBe("Rate unchanged");
  });

  it("treats 'lower by twenty' as a discount and collapses STT partials", () => {
    const outcome = deriveLiveCallOutcome({
      originalCents: 4000,
      targetCents: 3000,
      providerName: "Roscoe Village Guesthouse Hotel",
      transcript: [
        { role: "agent", message: "What can you do to lower the nightly price?", timeInCallSecs: 1 },
        { role: "user", message: "I think", timeInCallSecs: 14 },
        { role: "user", message: "I think I can lower it by", timeInCallSecs: 15 },
        { role: "user", message: "I think I can lower it by twenty dollars.", timeInCallSecs: 16 },
        { role: "user", message: "I think I can lower it by twenty dollars per room.", timeInCallSecs: 17 },
        {
          role: "agent",
          message: "That's a strong start—bringing it to twenty dollars nightly. Can you go any lower—perhaps to fifteen?",
          timeInCallSecs: 22,
        },
        { role: "user", message: "No, I think", timeInCallSecs: 30 },
        { role: "user", message: "No. I think twen- twenty is good. I can't go lower than twenty.", timeInCallSecs: 34 },
        { role: "agent", message: "Understood, twenty dollars is the lowest on rate.", timeInCallSecs: 35 },
        { role: "user", message: "No. No. No. No. This is my final offer.", timeInCallSecs: 56 },
        { role: "agent", message: "Twenty dollars nightly is confirmed as the best we can do.", timeInCallSecs: 61 },
      ],
    });

    expect(outcome.transcript).toHaveLength(7);
    expect(outcome.finalCents).toBe(2000);
    expect(outcome.summary).toContain("$20.00");
    expect(outcome.summary).toContain("$40.00");
    expect(outcome.steps.at(-1)?.label).toBe("Agreed nightly rate");
  });
});
