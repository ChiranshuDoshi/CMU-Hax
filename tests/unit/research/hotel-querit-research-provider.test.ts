import { describe, expect, it, vi } from "vitest";

import {
  HotelQueritResearchProvider,
  buildAggregatorPriceQuery,
  buildHotelDiscoveryQueries,
  cleanHotelTitle,
  extractHotelNamesFromHits,
  extractNightlyPriceCents,
  hotelNameFromAggregatorUrl,
  isIndividualHotelName,
  stayParamsFromProfile,
} from "@/integrations/querit";
import { rankResearchResult } from "@/domain/research";

import { EVALUATED_AT, makeQuoteRequest } from "../research/factories";

describe("HotelQueritResearchProvider", () => {
  it("builds stay-aware discovery queries from profile params", () => {
    const stay = stayParamsFromProfile({
      make: "Pittsburgh",
      model: "Deluxe",
      bodyType: "Deluxe",
      state: "PA",
      zipCode: "15222",
      annualMileage: 24,
      currentPremiumCents: 24800,
    });
    expect(stay.city).toBe("Pittsburgh");
    expect(stay.rooms).toBe(24);
    const queries = buildHotelDiscoveryQueries({
      make: "Pittsburgh",
      model: "Deluxe",
      bodyType: "Deluxe",
      state: "PA",
      zipCode: "15222",
      annualMileage: 24,
      currentPremiumCents: 24800,
    });
    expect(queries[0]?.query).toContain("Pittsburgh");
    expect(queries.every((entry) => entry.includeDomains.length > 0)).toBe(true);
    expect(buildAggregatorPriceQuery("Joinery Hotel Pittsburgh", "Pittsburgh", "Deluxe")).toContain("Joinery");
  });

  it("parses aggregator nightly prices from snippets", () => {
    expect(extractNightlyPriceCents("Rooms from $248 per night with breakfast")).toBe(24800);
    expect(extractNightlyPriceCents("Nightly rate: $301")).toBe(30100);
    expect(extractNightlyPriceCents("no price here")).toBeNull();
  });

  it("rejects listicles and keeps individual hotel properties", () => {
    expect(isIndividualHotelName("4-star Hotels in Pittsburgh", "Pittsburgh")).toBe(false);
    expect(isIndividualHotelName("Find Cheap Hotels in Pittsburgh, PA", "Pittsburgh")).toBe(false);
    expect(isIndividualHotelName("Pittsburgh Hotels", "Pittsburgh")).toBe(false);
    expect(isIndividualHotelName("Joinery Hotel Pittsburgh, Curio Collection by Hilton", "Pittsburgh")).toBe(true);
    expect(cleanHotelTitle("Joinery Hotel Pittsburgh, Curio Collection by Hilton, Pittsburgh (PA)", "Pittsburgh")).toContain("Joinery");

    const names = extractHotelNamesFromHits(
      [
        { title: "4-star Hotels in Pittsburgh", url: "https://listicle.example/pittsburgh", content: "Top picks" },
        { title: "Find Cheap Hotels in Pittsburgh, PA", url: "https://deals.example", content: "Deals" },
        { title: "Pittsburgh Hotels", url: "https://guide.example", content: "Guide" },
        {
          title: "Joinery Hotel Pittsburgh, Curio Collection by Hilton, Pittsburgh (PA)",
          url: "https://www.booking.com/hotel/us/joinery-pittsburgh.html",
          content: "4.8 out of 5",
        },
        {
          title: "Fairmont Pittsburgh",
          url: "https://www.expedia.com/Pittsburgh-Hotels-Fairmont-Pittsburgh.h123.Hotel-Information",
          content: "Luxury hotel",
        },
      ],
      "Pittsburgh",
    );

    expect(names.some((name) => /joinery/i.test(name))).toBe(true);
    expect(names.every((name) => !/cheap|4-star hotels|pittsburgh hotels$/i.test(name))).toBe(true);
    expect(hotelNameFromAggregatorUrl("https://www.booking.com/hotel/us/joinery-pittsburgh.html", "Pittsburgh")).toMatch(/Joinery/i);
  });

  it("searches hotels then aggregator domains and ranks candidates", async () => {
    const client = {
      // Price lookups are the only quoted queries; everything else is discovery.
      search: vi.fn(async ({ query }) => {
        if (query.startsWith('"')) {
          return {
            error_code: 200,
            results: {
              result: [
                {
                  title: "Booking.com rate",
                  url: "https://www.booking.com/hotel/us/joinery-pittsburgh.html",
                  snippet: "From $248 per night for a deluxe room",
                },
                {
                  title: "Expedia rate",
                  url: "https://www.expedia.com/Pittsburgh-Hotels-Joinery.h1.Hotel-Information",
                  snippet: "Nightly rate: $255",
                },
              ],
            },
          };
        }
        return {
          error_code: 200,
          results: {
            result: [
              {
                title: "Joinery Hotel Pittsburgh from $248 - KAYAK",
                url: "https://www.kayak.com/Pittsburgh-Hotels-Joinery-Hotel-Pittsburgh.2529720.ksp",
                snippet: "4.8 out of 5 based on 4800 reviews",
              },
              {
                title: "Fairmont Pittsburgh: Rooms & Prices",
                url: "https://www.expedia.com/Pittsburgh-Hotels-Fairmont-Pittsburgh.h1.Hotel-Information",
                snippet: "Nightly rate: $255",
              },
              {
                title: "Kimpton Hotel Monaco Pittsburgh",
                url: "https://www.hotels.com/ho123/kimpton-hotel-monaco-pittsburgh-pittsburgh-united-states-of-america/",
                snippet: "From $210 per night",
              },
              // Listicles and rentals must not reach the shortlist.
              { title: "Top 10 Hotels in Pittsburgh, PA | Hotels.com", url: "https://www.hotels.com/de1434395/hotels-pittsburgh/", snippet: "Best picks" },
              { title: "Bright Queen Studio Suite Full Kitchen", url: "https://www.expedia.com/Pittsburgh-Hotels-Bright-Queen-Studio-Suite-Full-Kitchen.h99.Hotel-Information", snippet: "Rental" },
              { title: "Hotel Savannah Chvalovice", url: "https://www.hotels.com/ho555/hotel-savannah-chvalovice-czech-republic/", snippet: "Abroad" },
            ],
          },
        };
      }),
    };

    const provider = new HotelQueritResearchProvider(
      {
        make: "Pittsburgh",
        model: "Deluxe",
        state: "PA",
        zipCode: "15222",
        annualMileage: 24,
        currentPremiumCents: 24800,
      },
      { client },
    );

    const input = { quoteRequest: makeQuoteRequest({ state: "PA", zipCode: "15222" }), retrievedAt: EVALUATED_AT };
    const result = await provider.research(input);
    const ranking = rankResearchResult(input.quoteRequest, result, EVALUATED_AT);
    const hints = provider.getPriceHints();

    expect(client.search).toHaveBeenCalled();
    expect(result.candidates.length).toBeGreaterThanOrEqual(3);
    expect(ranking.selected.length).toBeGreaterThanOrEqual(3);
    expect(result.candidates.every((candidate) => isIndividualHotelName(candidate.providerName, "Pittsburgh"))).toBe(true);
    expect(hints[0]?.nightlyCents).toBeGreaterThan(0);

    const names = result.candidates.map((candidate) => candidate.providerName).join(" | ");
    expect(names).toMatch(/Joinery/i);
    expect(names).toMatch(/Fairmont/i);
    expect(names).not.toMatch(/top 10|full kitchen|czech/i);
  });
});
