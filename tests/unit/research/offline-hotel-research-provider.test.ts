import { describe, expect, it } from "vitest";

import {
  FALLBACK_HOTEL_CHAINS,
  OfflineHotelResearchProvider,
  isIndividualHotelName,
} from "@/integrations/querit";
import { rankResearchResult } from "@/domain/research";

import { EVALUATED_AT, makeQuoteRequest } from "../research/factories";

describe("OfflineHotelResearchProvider", () => {
  it("uses location-free chain names so the list is reusable anywhere", () => {
    expect(FALLBACK_HOTEL_CHAINS).toHaveLength(5);
    // No city or state token may appear, otherwise one destination's names
    // would leak into another's shortlist.
    for (const chain of FALLBACK_HOTEL_CHAINS) {
      expect(chain).not.toMatch(/chicago|pittsburgh|cleveland|downtown|,/i);
      expect(isIndividualHotelName(chain, "Cleveland")).toBe(true);
    }
  });

  it("returns eligible chain hotels with budget-based aggregator prices", async () => {
    const provider = new OfflineHotelResearchProvider({
      make: "Cleavland",
      model: "Deluxe",
      state: "OH",
      zipCode: "44114",
      annualMileage: 24,
      currentPremiumCents: 24_000,
    });

    const quoteRequest = makeQuoteRequest({ state: "OH", zipCode: "44114" });
    const result = await provider.research({ quoteRequest, retrievedAt: EVALUATED_AT });
    const ranking = rankResearchResult(quoteRequest, result, EVALUATED_AT);

    // The Chicago mock list must never leak into another destination.
    const names = result.candidates.map((candidate) => candidate.providerName);
    expect(names.join(" ")).not.toMatch(/Chicago/i);
    expect(names).toEqual([...FALLBACK_HOTEL_CHAINS]);
    expect(result.candidates.every((candidate) => candidate.publicContact !== null)).toBe(true);
    expect(ranking.selected).toHaveLength(5);
    expect(ranking.selected[0]?.publicDiscounts.some((item) => item.startsWith("aggregator_nightly_cents:"))).toBe(true);
  });
});
