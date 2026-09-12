/**
 * Querit (api.querit.ai) live web search adapter for Top-N insurer research.
 * Normalizes Querit hits into the same result shape used by the Tavily mapper.
 */
import {
  PERSONAL_AUTO_OFFICIAL_DOMAINS,
  buildTavilyResearchQueries,
  mapTavilyResults,
} from "@/integrations/tavily";
import {
  validateRawResearchResult,
  validateResearchInput,
  type ResearchInput,
  type ResearchProvider,
} from "@/domain/research";

const DEFAULT_BASE_URL = "https://api.querit.ai/v1";
const DEFAULT_COUNT = 20;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_QUERY_COUNT = 4;

export interface QueritSearchHit {
  title?: string;
  url?: string;
  snippet?: string;
  page_age?: string;
  site_name?: string;
}

export interface QueritSearchResponse {
  error_code?: number;
  error_msg?: string;
  results?: { result?: QueritSearchHit[] };
}

export interface QueritSearchClient {
  search(input: {
    query: string;
    count: number;
    includeDomains?: readonly string[];
  }): Promise<QueritSearchResponse>;
}

export interface QueritResearchProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  count?: number;
  timeoutMs?: number;
  client?: QueritSearchClient;
}

function createHttpClient(apiKey: string, baseUrl: string, timeoutMs: number): QueritSearchClient {
  return {
    async search({ query, count, includeDomains }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const filters: Record<string, unknown> = {
          language: "english",
          countries: ["united states"],
        };
        if (includeDomains?.length) {
          filters.sites = { include: [...includeDomains] };
        }

        const response = await fetch(`${baseUrl.replace(/\/$/, "")}/search`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query,
            count,
            include_content: true,
            filters,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(detail.slice(0, 240) || `Querit search failed (${response.status})`);
        }

        return (await response.json()) as QueritSearchResponse;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function normalizeQueritHits(response: QueritSearchResponse): unknown[] {
  if (response.error_code !== undefined && response.error_code !== 200) {
    throw new Error(response.error_msg?.trim() || `Querit error_code ${response.error_code}`);
  }
  const hits = response.results?.result;
  if (!Array.isArray(hits)) return [];

  return hits
    .filter((hit) => typeof hit?.url === "string" && hit.url.trim().length > 0)
    .map((hit, index) => ({
      title: hit.title ?? hit.site_name ?? hit.url,
      url: hit.url,
      content: hit.snippet ?? "",
      score: Math.max(0.1, 1 - index * 0.03),
      publishedDate: null,
    }));
}

export class QueritResearchProvider implements ResearchProvider {
  private readonly client: QueritSearchClient;
  private readonly count: number;

  constructor(options: QueritResearchProviderOptions = {}) {
    const apiKey = options.apiKey?.trim();
    if (!options.client && !apiKey) {
      throw new Error("QueritResearchProvider requires an API key or injected client.");
    }
    this.count = options.count ?? DEFAULT_COUNT;
    this.client =
      options.client ??
      createHttpClient(
        apiKey!,
        options.baseUrl?.trim() || process.env.QUERIT_BASE_URL?.trim() || DEFAULT_BASE_URL,
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
  }

  async research(input: ResearchInput) {
    const validatedInput = validateResearchInput(input);
    const queries = buildTavilyResearchQueries(validatedInput).slice(0, MAX_QUERY_COUNT);
    const rawResults: unknown[] = [];
    const warnings: string[] = [];
    const includeDomains = validatedInput.quoteRequest.insuranceLines.includes("auto")
      ? PERSONAL_AUTO_OFFICIAL_DOMAINS
      : undefined;

    for (const [queryIndex, query] of queries.entries()) {
      try {
        const response = await this.client.search({
          query,
          count: this.count,
          includeDomains,
        });
        rawResults.push(...normalizeQueritHits(response));
      } catch (error) {
        warnings.push(
          `Querit search ${queryIndex + 1} failed (${error instanceof Error ? error.message.slice(0, 120) : "unknown error"}).`,
        );
      }
    }

    const mapped = mapTavilyResults(rawResults, validatedInput);
    if (mapped.malformedResultCount > 0) {
      warnings.push(
        `Ignored ${mapped.malformedResultCount} malformed Querit result${mapped.malformedResultCount === 1 ? "" : "s"}.`,
      );
    }
    if (mapped.candidates.length === 0) {
      warnings.push("Querit returned no usable provider-domain candidates.");
    }
    if (mapped.insufficientEvidenceCount > 0) {
      warnings.push(
        `${mapped.insufficientEvidenceCount} provider-domain candidate${mapped.insufficientEvidenceCount === 1 ? " lacked" : "s lacked"} explicit line, jurisdiction, or required-coverage evidence and may be ineligible.`,
      );
    }

    return validateRawResearchResult({ candidates: mapped.candidates, warnings });
  }
}
