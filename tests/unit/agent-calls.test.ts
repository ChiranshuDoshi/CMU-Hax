import { describe, expect, it } from "vitest";

import {
  HOTEL_REP_VOICES,
  assignHotelVoices,
  buildAgentCall,
  buildAgentCallScript,
  reductionPctFor,
} from "@/backend/app/agent-calls";
import type { QuoteView } from "@/backend/app/store";

function makeQuote(overrides: Partial<QuoteView> = {}): QuoteView {
  return {
    quoteId: "quote-hilton",
    providerId: "hilton",
    providerName: "Hilton",
    rating: 4.6,
    reviewCount: 1200,
    annualizedCostCents: 15_000,
    monthlyCents: 1_250,
    deductibleCents: 0,
    recommended: true,
    coverageEquivalence: "equivalent",
    redFlags: [],
    rank: 1,
    effectiveComparisonCostCents: 15_000,
    roomType: "Deluxe",
    aggregators: [
      { name: "Kayak", nightlyCents: 15_000, url: "https://kayak.example/hilton" },
      { name: "Expedia", nightlyCents: 16_200, url: "https://expedia.example/hilton" },
    ],
    ...overrides,
  };
}

describe("agent call quotes", () => {
  it("keeps the reduction inside the 10–18% band for any hotel id", () => {
    for (const seed of ["hilton", "marriott", "hyatt", "clarion-hotel", "jw-marriott"]) {
      const pct = reductionPctFor(seed);
      expect(pct).toBeGreaterThanOrEqual(10);
      expect(pct).toBeLessThanOrEqual(18);
    }
  });

  it("returns a quote below the cheapest aggregator rate", () => {
    const call = buildAgentCall(makeQuote(), { rooms: 24, nights: 3 });
    expect(call).not.toBeNull();
    expect(call!.aggregatorLowCents).toBe(15_000);
    expect(call!.aggregatorName).toBe("Kayak");
    expect(call!.agentQuoteCents).toBeLessThan(call!.aggregatorLowCents);
    expect(call!.savedPct).toBeGreaterThanOrEqual(10);
    expect(call!.savedPct).toBeLessThanOrEqual(18);
    expect(call!.totalSavedCents).toBe(call!.savedCents * 24 * 3);
    expect(call!.script).toHaveLength(6);
    expect(call!.script[0]?.speaker).toBe("hotel");
  });

  it("grounds the spoken script in the negotiated numbers", () => {
    const script = buildAgentCallScript({
      providerName: "Hilton",
      aggregatorLowCents: 15_000,
      aggregatorName: "Kayak",
      agentQuoteCents: 13_000,
      concession: "Resort fee waived for the full block",
      rooms: 24,
      nights: 3,
      roomType: "Deluxe",
    });
    const spoken = script.map((line) => line.text).join(" ");
    expect(spoken).toContain("150 dollars");
    expect(spoken).toContain("130 dollars");
    expect(spoken).toContain("Kayak");
    expect(spoken).toContain("24");
  });

  it("assigns a distinct hotel-rep voice to each of the first four hotels", () => {
    const voices = assignHotelVoices(["hilton", "marriott", "hyatt", "sheraton"]);
    expect(new Set(voices.values()).size).toBe(4);
    expect([...voices.values()].every((voice) => (HOTEL_REP_VOICES as readonly string[]).includes(voice))).toBe(true);
  });
});
