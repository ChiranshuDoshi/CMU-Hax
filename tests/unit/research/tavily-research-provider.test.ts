import { describe, expect, it, vi } from "vitest";

import { rankResearchResult } from "@/domain/research";
import {
  MAX_TAVILY_CONTENT_BYTES,
  MAX_TAVILY_FAILURE_WARNING_BYTES,
  MAX_TAVILY_RAW_CONTENT_BYTES,
  MAX_TAVILY_QUERY_LENGTH,
  MAX_TAVILY_RESULTS,
  MAX_TAVILY_SOURCE_EXCERPT_BYTES,
  MAX_TAVILY_TITLE_BYTES,
  MAX_TAVILY_TIMEOUT_SECONDS,
  PERSONAL_AUTO_OFFICIAL_DOMAINS,
  TavilyResearchProvider,
  buildTavilyResearchQueries,
  mapTavilyResults,
} from "@/integrations/tavily";

import { EVALUATED_AT, makeQuoteRequest } from "./factories";

const EXPLICIT_PROVIDER_CONTENT = [
  "Auto insurance is available nationwide, including California and ZIP 94105.",
  "Options include bodily injury liability and collision coverage.",
  "Rated 4.7 out of 5 based on 2,345 customer reviews.",
].join(" ");

describe("TavilyResearchProvider", () => {
  it("builds provider-safe queries from confirmed line, state, ZIP, and coverage", () => {
    const request = makeQuoteRequest();
    const queries = buildTavilyResearchQueries({ quoteRequest: request, retrievedAt: EVALUATED_AT });

    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every((query) => query.includes("CA") && query.includes("94105"))).toBe(true);
    expect(queries.every((query) => query.includes("california"))).toBe(true);
    expect(queries.every((query) => query.includes("bodily injury liability"))).toBe(true);
    expect(queries.every((query) => query.includes("collision"))).toBe(true);
    expect(queries.join(" ")).not.toContain(request.workflowId);
    expect(queries.join(" ")).not.toContain(request.specificationHash);
    expect(queries.join(" ")).not.toContain("driver-1");
    expect(queries.join(" ")).not.toContain("vehicle-1");
  });

  it("bounds oversized coverage queries while retaining line, state, and ZIP", () => {
    const requestedCoverage = Array.from({ length: 25 }, (_, index) => ({
      coverageCode: `coverage_${String(index).padStart(2, "0")}_${"x".repeat(66)}`,
      insuredEntityIds: ["vehicle-1"],
      required: index === 0,
      minimumLimitCents: null,
      maximumDeductibleCents: null,
    }));
    const request = makeQuoteRequest({ requestedCoverage });
    const queries = buildTavilyResearchQueries({ quoteRequest: request, retrievedAt: EVALUATED_AT });

    expect(queries.every((query) => query.length <= MAX_TAVILY_QUERY_LENGTH)).toBe(true);
    expect(
      queries.every(
        (query) => query.includes("auto insurance") && query.includes("CA") && query.includes("94105"),
      ),
    ).toBe(true);
    expect(queries.every((query) => query.includes("coverage 00"))).toBe(true);
  });

  it("maps explicit availability and rating evidence without using Tavily relevance as a rating", () => {
    const input = { quoteRequest: makeQuoteRequest(), retrievedAt: EVALUATED_AT };
    const mapped = mapTavilyResults(
      [
        {
          title: "Amica auto insurance",
          url: "https://www.amica.com/auto/california",
          content: EXPLICIT_PROVIDER_CONTENT,
          score: 0.12,
          publishedDate: "2026-07-01",
        },
      ],
      input,
    );
    const candidate = mapped.candidates[0];

    expect(candidate.insuranceLines).toEqual(["auto"]);
    expect(candidate.nationwide).toBe(true);
    expect(candidate.preliminaryCoverageCodes).toEqual([
      "bodily_injury_liability",
      "collision",
    ]);
    expect(candidate.providerId).toBe("web-amica-com");
    expect(candidate.canonicalCarrierId).toBe("web-amica-com");
    expect(candidate.providerName).toBe("Amica");
    expect(candidate.providerType).toBe("carrier");
    expect(candidate.website).toBe("https://amica.com");
    expect(candidate.publicContact).toBeNull();
    expect(candidate.rating).toBe(4.7);
    expect(candidate.ratingScaleMaximum).toBe(5);
    expect(candidate.reviewCount).toBe(2_345);
    expect(candidate.ratingSourceId).toBe(candidate.sources[0].id);
    expect(candidate.rating).not.toBe(0.12);
    expect(candidate.sources[0]).toMatchObject({
      domain: "www.amica.com",
      publisher: "Amica",
      officialSource: true,
      sourceKind: "provider",
    });

    const ranking = rankResearchResult(input.quoteRequest, { candidates: mapped.candidates, warnings: [] }, EVALUATED_AT);
    expect(ranking.selected.map((provider) => provider.providerId)).toEqual(["web-amica-com"]);
  });

  it("leaves vague results unknown and ineligible rather than fabricating availability or ratings", () => {
    const input = { quoteRequest: makeQuoteRequest(), retrievedAt: EVALUATED_AT };
    const mapped = mapTavilyResults(
      [
        {
          title: "Insurance savings overview",
          url: "https://statefarm.com/article",
          content: "Save up to $39 per month. Compare options today.",
          score: 0.98,
          publishedDate: "not-a-date",
        },
      ],
      input,
    );
    const candidate = mapped.candidates[0];

    expect(candidate.insuranceLines).toEqual([]);
    expect(candidate.states).toEqual([]);
    expect(candidate.preliminaryCoverageCodes).toEqual([]);
    expect(candidate.rating).toBeNull();
    expect(candidate.reviewCount).toBeNull();
    expect(candidate.sources[0].excerpt).toContain("$39 per month");
    expect(mapped.insufficientEvidenceCount).toBe(1);

    const ranking = rankResearchResult(input.quoteRequest, { candidates: mapped.candidates, warnings: [] }, EVALUATED_AT);
    expect(ranking.selected).toEqual([]);
    expect(ranking.ineligible[0].exclusionReasons).toEqual(
      expect.arrayContaining([
        "Does not offer every requested insurance line.",
        "Does not serve the confirmed state.",
        "Does not support every required coverage at a preliminary product level.",
      ]),
    );
  });

  it("discards non-carrier publishers and canonicalizes official subdomains", () => {
    const input = { quoteRequest: makeQuoteRequest(), retrievedAt: EVALUATED_AT };
    const mapped = mapTavilyResults(
      [
        { title: "Bad", url: "javascript:alert(1)", content: "bad", score: 1 },
        {
          title: "Best car insurers listicle",
          url: "https://www.usnews.com/insurance/auto/best-car-insurance-companies",
          content: EXPLICIT_PROVIDER_CONTENT,
          score: 0.99,
        },
        { url: "https://contenthub.allstate.com/path", score: 0.3 },
        {
          title: "Allstate sparse duplicate",
          url: "https://www.allstate.com/other",
          content: "More",
          score: 0.4,
        },
      ],
      input,
    );

    expect(mapped.malformedResultCount).toBe(1);
    expect(mapped.candidates).toHaveLength(1);
    expect(mapped.candidates[0]).toMatchObject({
      providerId: "web-allstate-com",
      providerName: "Allstate",
      website: "https://allstate.com",
    });
    expect(mapped.candidates[0].sources).toHaveLength(2);
    expect(mapped.candidates[0].rating).toBeNull();
    expect(mapped.candidates.some((candidate) => candidate.providerName === "Usnews")).toBe(false);

    const reversed = mapTavilyResults(
      [
        {
          title: "Allstate sparse duplicate",
          url: "https://www.allstate.com/other",
          content: "More",
          score: 0.4,
        },
        { url: "https://contenthub.allstate.com/path", score: 0.3 },
        {
          title: "Best car insurers listicle",
          url: "https://www.usnews.com/insurance/auto/best-car-insurance-companies",
          content: EXPLICIT_PROVIDER_CONTENT,
          score: 0.99,
        },
        { title: "Bad", url: "javascript:alert(1)", content: "bad", score: 1 },
      ],
      input,
    );
    expect(reversed).toEqual(mapped);
  });

  it("combines line, jurisdiction, and aliased coverage evidence across official pages", () => {
    const quoteRequest = makeQuoteRequest({
      state: "MA",
      zipCode: "02108",
      requestedCoverage: [
        {
          coverageCode: "bodily_injury_liability",
          insuredEntityIds: ["driver-1", "vehicle-1"],
          required: true,
          minimumLimitCents: 100_000,
          maximumDeductibleCents: null,
        },
        {
          coverageCode: "uninsured_underinsured_motorist",
          insuredEntityIds: ["driver-1", "vehicle-1"],
          required: true,
          minimumLimitCents: 100_000,
          maximumDeductibleCents: null,
        },
        {
          coverageCode: "property_damage_liability",
          insuredEntityIds: ["driver-1", "vehicle-1"],
          required: true,
          minimumLimitCents: 100_000,
          maximumDeductibleCents: null,
        },
        {
          coverageCode: "collision",
          insuredEntityIds: ["vehicle-1"],
          required: true,
          minimumLimitCents: null,
          maximumDeductibleCents: 100_000,
        },
        {
          coverageCode: "comprehensive",
          insuredEntityIds: ["vehicle-1"],
          required: true,
          minimumLimitCents: null,
          maximumDeductibleCents: 100_000,
        },
      ],
    });
    const mapped = mapTavilyResults(
      [
        {
          title: "Plymouth Rock car insurance",
          url: "https://www.plymouthrock.com/auto",
          content: "Choose a personal car insurance policy for your vehicle.",
          score: 0.9,
        },
        {
          title: "Where Plymouth Rock writes policies",
          url: "https://www.plymouthrock.com/locations/massachusetts",
          content: "We serve drivers throughout Massachusetts, including ZIP 02108.",
          score: 0.9,
        },
        {
          title: "Plymouth Rock coverage choices",
          url: "https://www.plymouthrock.com/auto/coverages",
          content: [
            "Options include bodily injury and property damage.",
            "Protection applies when a driver is uninsured or when another driver is underinsured.",
            "Collision and comprehensive are also available.",
          ].join(" "),
          score: 0.9,
        },
      ],
      { quoteRequest, retrievedAt: EVALUATED_AT },
    );

    expect(mapped.insufficientEvidenceCount).toBe(0);
    expect(mapped.candidates).toHaveLength(1);
    expect(mapped.candidates[0]).toMatchObject({
      providerName: "Plymouth Rock Assurance",
      insuranceLines: ["auto"],
      nationwide: false,
      states: ["MA"],
      preliminaryCoverageCodes: [
        "bodily_injury_liability",
        "collision",
        "comprehensive",
        "property_damage_liability",
        "uninsured_underinsured_motorist",
      ],
    });
    expect(
      rankResearchResult(quoteRequest, { candidates: mapped.candidates, warnings: [] }, EVALUATED_AT)
        .selected,
    ).toHaveLength(1);
  });

  it("produces five eligible carrier candidates from official evidence only", () => {
    const quoteRequest = makeQuoteRequest({ state: "MA", zipCode: "02108" });
    const officialResults = [
      ["amica.com", "Amica"],
      ["geico.com", "GEICO"],
      ["mapfreinsurance.com", "MAPFRE"],
      ["progressive.com", "Progressive"],
      ["statefarm.com", "State Farm"],
    ].map(([domain, name]) => ({
      title: `${name} auto insurance in Massachusetts`,
      url: `https://${domain}/auto/massachusetts`,
      content:
        "Auto insurance is available in Massachusetts with bodily injury coverage and collision protection.",
      score: 0.9,
    }));
    const mapped = mapTavilyResults(
      [
        ...officialResults,
        {
          title: "Five best insurers",
          url: "https://example.org/best-insurers",
          content:
            "Auto insurance is available in Massachusetts with bodily injury coverage and collision protection.",
          score: 1,
        },
      ],
      { quoteRequest, retrievedAt: EVALUATED_AT },
    );
    const ranking = rankResearchResult(
      quoteRequest,
      { candidates: mapped.candidates, warnings: [] },
      EVALUATED_AT,
    );

    expect(mapped.insufficientEvidenceCount).toBe(0);
    expect(mapped.candidates).toHaveLength(5);
    expect(mapped.candidates.every((candidate) => candidate.providerType === "carrier")).toBe(true);
    expect(
      mapped.candidates.every((candidate) =>
        candidate.sources.every(
          (source) => source.officialSource && source.sourceKind === "provider",
        ),
      ),
    ).toBe(true);
    expect(ranking.selected).toHaveLength(5);
    expect(ranking.ineligible).toEqual([]);
  });

  it("caps untrusted Tavily text before evidence normalization and rating parsing", () => {
    const oversizedTitle = `Acme auto insurance ${"😀".repeat(MAX_TAVILY_TITLE_BYTES)}`;
    const oversizedContent = `${EXPLICIT_PROVIDER_CONTENT.replace(
      "Rated 4.7 out of 5 based on 2,345 customer reviews.",
      "",
    )} ${"c".repeat(MAX_TAVILY_CONTENT_BYTES * 2)}`;
    const oversizedRawContent = `${"r".repeat(MAX_TAVILY_RAW_CONTENT_BYTES * 2)} Rated 5 out of 5 based on 9999 reviews.`;
    const mapped = mapTavilyResults(
      [
        {
          title: oversizedTitle,
          url: "https://amica.com/auto",
          content: oversizedContent,
          rawContent: oversizedRawContent,
          score: 0.9,
        },
      ],
      { quoteRequest: makeQuoteRequest(), retrievedAt: EVALUATED_AT },
    );
    const candidate = mapped.candidates[0];
    const source = candidate.sources[0];
    const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

    expect(byteLength(source.title)).toBeLessThanOrEqual(MAX_TAVILY_TITLE_BYTES);
    expect(byteLength(source.excerpt)).toBeLessThanOrEqual(MAX_TAVILY_SOURCE_EXCERPT_BYTES);
    expect(candidate.insuranceLines).toEqual(["auto"]);
    expect(candidate.rating).toBeNull();
    expect(candidate.reviewCount).toBeNull();
  });

  it("processes no more than configured maxResults from each upstream response", async () => {
    const upstreamResults = [
      {
        title: "Amica auto insurance",
        url: "https://amica.com/auto",
        content: EXPLICIT_PROVIDER_CONTENT,
        score: 0.9,
      },
      {
        title: "GEICO auto insurance",
        url: "https://geico.com/auto",
        content: EXPLICIT_PROVIDER_CONTENT,
        score: 0.9,
      },
      ...Array.from({ length: 10 }, (_, index) => ({
        title: `Aggregator ${index}`,
        url: `https://aggregator-${String(index).padStart(2, "0")}.example/auto`,
        content: EXPLICIT_PROVIDER_CONTENT,
        score: 0.9,
      })),
    ];
    const search = vi.fn().mockResolvedValue({ results: upstreamResults });
    const provider = new TavilyResearchProvider({ client: { search }, maxResults: 2 });
    const result = await provider.research({
      quoteRequest: makeQuoteRequest(),
      retrievedAt: EVALUATED_AT,
    });

    expect(search).toHaveBeenCalledTimes(2);
    expect(result.candidates.map((candidate) => candidate.providerId)).toEqual([
      "web-amica-com",
      "web-geico-com",
    ]);
  });

  it("rejects invalid client limits before issuing a search", () => {
    const client = { search: vi.fn() };
    expect(() => new TavilyResearchProvider({ client, maxResults: 0 })).toThrow(
      `maxResults must be an integer from 1 to ${MAX_TAVILY_RESULTS}`,
    );
    expect(
      () => new TavilyResearchProvider({ client, maxResults: MAX_TAVILY_RESULTS + 1 }),
    ).toThrow(`maxResults must be an integer from 1 to ${MAX_TAVILY_RESULTS}`);
    expect(() => new TavilyResearchProvider({ client, timeoutSeconds: -1 })).toThrow(
      `timeoutSeconds must be greater than 0 and at most ${MAX_TAVILY_TIMEOUT_SECONDS}`,
    );
    expect(
      () =>
        new TavilyResearchProvider({
          client,
          timeoutSeconds: MAX_TAVILY_TIMEOUT_SECONDS + 1,
        }),
    ).toThrow(`timeoutSeconds must be greater than 0 and at most ${MAX_TAVILY_TIMEOUT_SECONDS}`);
  });

  it("uses documented Tavily options and converts per-query failures into warnings", async () => {
    const search = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        results: [
          {
            title: "Amica auto insurance",
            url: "https://amica.com/auto",
            content: EXPLICIT_PROVIDER_CONTENT,
            score: 0.9,
            publishedDate: "2026-07-01",
          },
          { title: "Invalid", url: "not a URL", content: "ignored", score: 1 },
        ],
      });
    const provider = new TavilyResearchProvider({
      client: { search },
      maxResults: 7,
      timeoutSeconds: 9,
    });
    const result = await provider.research({
      quoteRequest: makeQuoteRequest(),
      retrievedAt: EVALUATED_AT,
    });

    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[0][1]).toEqual({
      searchDepth: "advanced",
      maxResults: 7,
      includeRawContent: "text",
      includeDomains: PERSONAL_AUTO_OFFICIAL_DOMAINS,
      topic: "general",
      country: "united states",
      timeout: 9,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.warnings).toContain("Tavily search 1 failed (timeout: request timed out).");
    expect(result.warnings.some((warning) => warning.includes("Ignored 1 malformed"))).toBe(true);
  });

  it("classifies failures without exposing untrusted error details", async () => {
    const secretApiKey = "tvly-test-secret-value";
    const oversizedRequestBody = "x".repeat(MAX_TAVILY_FAILURE_WARNING_BYTES * 20);
    const search = vi.fn().mockRejectedValue(
      new Error(
        `Request timed out. Authorization: Bearer ${secretApiKey}; request body: ${oversizedRequestBody}`,
      ),
    );
    const provider = new TavilyResearchProvider({ client: { search } });
    const result = await provider.research({
      quoteRequest: makeQuoteRequest(),
      retrievedAt: EVALUATED_AT,
    });
    const failureWarnings = result.warnings.filter((warning) => warning.startsWith("Tavily search"));
    const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

    expect(failureWarnings).toEqual([
      "Tavily search 1 failed (timeout: request timed out).",
      "Tavily search 2 failed (timeout: request timed out).",
    ]);
    expect(failureWarnings.every((warning) => byteLength(warning) <= MAX_TAVILY_FAILURE_WARNING_BYTES)).toBe(true);
    expect(result.warnings.join(" ")).not.toContain(secretApiKey);
    expect(result.warnings.join(" ")).not.toContain("Authorization");
    expect(result.warnings.join(" ")).not.toContain("request body");
    expect(result.warnings.join(" ")).not.toContain(oversizedRequestBody);
  });
});
