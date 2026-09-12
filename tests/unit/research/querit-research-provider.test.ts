import { describe, expect, it, vi } from "vitest";

import { QueritResearchProvider, normalizeQueritHits } from "@/integrations/querit";
import { rankResearchResult } from "@/domain/research";

import { EVALUATED_AT, makeQuoteRequest } from "../research/factories";

describe("QueritResearchProvider", () => {
  it("normalizes Querit hits into mapper-compatible search records", () => {
    const records = normalizeQueritHits({
      error_code: 200,
      results: {
        result: [
          {
            title: "Progressive auto insurance",
            url: "https://www.progressive.com/auto/",
            snippet: "Auto insurance available in California ZIP 94105 with collision coverage. Rated 4.6 out of 5 based on 1200 reviews.",
          },
        ],
      },
    });

    expect(records).toEqual([
      expect.objectContaining({
        title: "Progressive auto insurance",
        url: "https://www.progressive.com/auto/",
        content: expect.stringContaining("collision"),
      }),
    ]);
  });

  it("maps live Querit results into ranked provider candidates", async () => {
    const client = {
      search: vi.fn().mockResolvedValue({
        error_code: 200,
        results: {
          result: [
            {
              title: "GEICO auto",
              url: "https://www.geico.com/auto-insurance/",
              snippet:
                "Auto insurance is available nationwide, including California and ZIP 94105. Options include bodily injury liability and collision coverage. Rated 4.7 out of 5 based on 2345 customer reviews.",
            },
            {
              title: "Progressive auto",
              url: "https://www.progressive.com/auto/",
              snippet:
                "Auto insurance is available nationwide, including California and ZIP 94105. Options include bodily injury liability and collision coverage. Rated 4.6 out of 5 based on 1800 customer reviews.",
            },
            {
              title: "State Farm auto",
              url: "https://www.statefarm.com/insurance/auto",
              snippet:
                "Auto insurance is available nationwide, including California and ZIP 94105. Options include bodily injury liability and collision coverage. Rated 4.5 out of 5 based on 3000 customer reviews.",
            },
            {
              title: "Allstate auto",
              url: "https://www.allstate.com/auto-insurance",
              snippet:
                "Auto insurance is available nationwide, including California and ZIP 94105. Options include bodily injury liability and collision coverage. Rated 4.4 out of 5 based on 2100 customer reviews.",
            },
            {
              title: "Amica auto",
              url: "https://www.amica.com/auto",
              snippet:
                "Auto insurance is available nationwide, including California and ZIP 94105. Options include bodily injury liability and collision coverage. Rated 4.8 out of 5 based on 900 customer reviews.",
            },
          ],
        },
      }),
    };

    const provider = new QueritResearchProvider({ client });
    const input = { quoteRequest: makeQuoteRequest(), retrievedAt: EVALUATED_AT };
    const result = await provider.research(input);
    const ranking = rankResearchResult(input.quoteRequest, result, EVALUATED_AT);

    expect(client.search).toHaveBeenCalled();
    expect(result.candidates.length).toBeGreaterThanOrEqual(5);
    expect(ranking.selected).toHaveLength(5);
  });
});
