import { tavily, type TavilySearchOptions } from "@tavily/core";

import { getInsuranceLineConfig } from "@/config/insurance-lines";
import type {
  ConfirmedQuoteRequest,
  RawResearchCandidate,
} from "@/domain/schemas/person4";
import {
  validateRawResearchResult,
  validateResearchInput,
  type ResearchInput,
  type ResearchProvider,
} from "@/domain/research";

type ResearchSource = RawResearchCandidate["sources"][number];

const DEFAULT_MAX_RESULTS = 20;
const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_QUERY_COUNT = 4;
const TAVILY_US_COUNTRY = "united states";
const MAX_TAVILY_ERROR_CLASSIFICATION_BYTES = 2_048;
export const MAX_TAVILY_QUERY_LENGTH = 1_000;
export const MAX_TAVILY_RESULTS = 20;
export const MAX_TAVILY_TIMEOUT_SECONDS = 60;
export const MAX_TAVILY_FAILURE_WARNING_BYTES = 160;
export const MAX_TAVILY_URL_BYTES = 2_048;
export const MAX_TAVILY_TITLE_BYTES = 512;
export const MAX_TAVILY_CONTENT_BYTES = 8_000;
export const MAX_TAVILY_RAW_CONTENT_BYTES = 20_000;
export const MAX_TAVILY_EVIDENCE_BYTES = 20_000;
export const MAX_TAVILY_SOURCE_EXCERPT_BYTES = 1_000;

const MAX_TAVILY_PUBLISHED_DATE_BYTES = 100;
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

export const PERSONAL_AUTO_CARRIER_REGISTRY = [
  { domain: "allstate.com", providerName: "Allstate" },
  { domain: "amica.com", providerName: "Amica" },
  { domain: "geico.com", providerName: "GEICO" },
  { domain: "libertymutual.com", providerName: "Liberty Mutual" },
  { domain: "mapfreinsurance.com", providerName: "MAPFRE Insurance" },
  { domain: "plymouthrock.com", providerName: "Plymouth Rock Assurance" },
  { domain: "progressive.com", providerName: "Progressive" },
  { domain: "statefarm.com", providerName: "State Farm" },
] as const;

export const PERSONAL_AUTO_OFFICIAL_DOMAINS = PERSONAL_AUTO_CARRIER_REGISTRY.map(
  (carrier) => carrier.domain,
);

const AUTO_COVERAGE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  bodily_injury_liability: ["bodily injury liability", "bodily injury coverage", "bodily injury"],
  property_damage_liability: [
    "property damage liability",
    "property damage coverage",
    "property damage",
  ],
  uninsured_underinsured_motorist: [
    "uninsured underinsured motorist",
    "uninsured and underinsured motorist",
    "uninsured or underinsured motorist",
    "uninsured motorist and underinsured motorist",
    "uninsured underinsured coverage",
    "um uim coverage",
  ],
  collision: [
    "collision coverage",
    "collision insurance",
    "collision protection",
    "damage from a collision",
    "collision",
  ],
  comprehensive: [
    "comprehensive coverage",
    "comprehensive car insurance",
    "other than collision coverage",
    "non collision damage",
    "theft and vandalism coverage",
    "comprehensive",
  ],
};

const STATE_NAMES: Readonly<Record<string, string>> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california",
  CO: "colorado", CT: "connecticut", DE: "delaware", FL: "florida", GA: "georgia",
  HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa",
  KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland",
  MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri",
  MT: "montana", NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey",
  NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota", OH: "ohio",
  OK: "oklahoma", OR: "oregon", PA: "pennsylvania", RI: "rhode island", SC: "south carolina",
  SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont",
  VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming",
  DC: "district of columbia",
};

export interface TavilySearchClient {
  search(query: string, options?: TavilySearchOptions): Promise<unknown>;
}

export interface TavilyResearchProviderOptions {
  apiKey?: string;
  client?: TavilySearchClient;
  maxResults?: number;
  timeoutSeconds?: number;
}

interface SearchResultRecord {
  title: string;
  url: string;
  content: string;
  rawContent?: string;
  score: number;
  publishedDate: string | null;
}

interface CandidateAccumulator {
  providerId: string;
  canonicalCarrierId: string;
  providerName: string;
  website: string;
  sources: ResearchSource[];
  insuranceLines: Set<RawResearchCandidate["insuranceLines"][number]>;
  states: Set<string>;
  nationwide: boolean;
  preliminaryCoverageCodes: Set<string>;
  rating: number | null;
  ratingScaleMaximum: number | null;
  reviewCount: number | null;
  ratingSourceId: string | null;
  ratingObservedAt: string | null;
}

type PersonalAutoCarrier = (typeof PERSONAL_AUTO_CARRIER_REGISTRY)[number];

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateUtf8(value: string, maximumBytes: number): string {
  let boundedPrefix = value.slice(0, maximumBytes);
  const finalCodeUnit = boundedPrefix.charCodeAt(boundedPrefix.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
    boundedPrefix = boundedPrefix.slice(0, -1);
  }
  const encoded = UTF8_ENCODER.encode(boundedPrefix);
  if (encoded.byteLength <= maximumBytes) return boundedPrefix;

  let validEnd = maximumBytes;
  while (validEnd > 0 && (encoded[validEnd] & 0b1100_0000) === 0b1000_0000) {
    validEnd -= 1;
  }
  return UTF8_DECODER.decode(encoded.subarray(0, validEnd));
}

function interpolateTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{([^}]+)\}/g, (match, key: string) => values[key] ?? match);
}

function appendQuerySegment(query: string, segment: string): string {
  const normalizedSegment = compactWhitespace(segment);
  if (normalizedSegment === "") return query;
  const separator = query === "" ? "" : " ";
  if (query.length + separator.length + normalizedSegment.length > MAX_TAVILY_QUERY_LENGTH) {
    return query;
  }
  return `${query}${separator}${normalizedSegment}`;
}

function buildBoundedQuery(
  baseQuery: string,
  insuranceLine: string,
  state: string,
  zipCode: string,
  coverageCodes: readonly string[],
): string {
  let query = compactWhitespace(
    `official ${insuranceLine} insurance provider serving ${zipCode} ${state}`,
  );
  query = appendQuerySegment(query, baseQuery);
  query = appendQuerySegment(query, "coverage");

  for (const coverageCode of coverageCodes) {
    query = appendQuerySegment(query, coverageCode.replaceAll("_", " "));
  }

  return query;
}

export function buildTavilyResearchQueries(input: ResearchInput): string[] {
  const { quoteRequest } = validateResearchInput(input);
  const insuranceLines = [...quoteRequest.insuranceLines].sort();
  const coverageCodes = [
    ...new Set(quoteRequest.requestedCoverage.map((coverage) => coverage.coverageCode)),
  ].sort();
  const queries: string[] = [];

  for (const insuranceLine of insuranceLines) {
    const insuranceLinePhrase = insuranceLine.replaceAll("_", " ");
    const config = getInsuranceLineConfig(insuranceLine);
    const stateName = STATE_NAMES[quoteRequest.state];
    const stateSearchPhrase = stateName
      ? `${quoteRequest.state} ${stateName}`
      : quoteRequest.state;
    const templateValues = {
      insuranceLine: insuranceLinePhrase,
      state: stateSearchPhrase,
      zipCode: quoteRequest.zipCode,
    };

    for (const template of config.researchQueryTemplates) {
      const baseQuery = interpolateTemplate(template, templateValues);
      queries.push(
        buildBoundedQuery(
          baseQuery,
          insuranceLinePhrase,
          stateSearchPhrase,
          quoteRequest.zipCode,
          coverageCodes,
        ),
      );
    }
  }

  return [...new Set(queries)].slice(0, MAX_QUERY_COUNT);
}

function parseHttpUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  if (
    value.length > MAX_TAVILY_URL_BYTES ||
    UTF8_ENCODER.encode(value).byteLength > MAX_TAVILY_URL_BYTES
  ) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url;
  } catch {
    return null;
  }
}

function parsePublishedDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const boundedValue = truncateUtf8(value, MAX_TAVILY_PUBLISHED_DATE_BYTES);
  if (boundedValue.trim() === "") return null;
  const timestamp = Date.parse(boundedValue);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function parseSearchResult(value: unknown): SearchResultRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const url = parseHttpUrl(record.url);
  if (!url) return null;

  const title =
    typeof record.title === "string"
      ? compactWhitespace(truncateUtf8(record.title, MAX_TAVILY_TITLE_BYTES))
      : "";
  const content =
    typeof record.content === "string"
      ? compactWhitespace(truncateUtf8(record.content, MAX_TAVILY_CONTENT_BYTES))
      : "";
  const rawContent =
    typeof record.rawContent === "string"
      ? compactWhitespace(truncateUtf8(record.rawContent, MAX_TAVILY_RAW_CONTENT_BYTES))
      : undefined;
  const score =
    typeof record.score === "number" && Number.isFinite(record.score)
      ? Math.min(1, Math.max(0, record.score))
      : 0;

  return {
    title: title || truncateUtf8(url.hostname, MAX_TAVILY_TITLE_BYTES),
    url: url.toString(),
    content: content || rawContent || title || url.hostname,
    rawContent,
    score,
    publishedDate: parsePublishedDate(record.publishedDate),
  };
}

function responseResults(value: unknown): unknown[] | null {
  if (typeof value !== "object" || value === null) return null;
  const results = (value as Record<string, unknown>).results;
  return Array.isArray(results) ? results : null;
}

function safeTavilyFailureDetail(error: unknown): string {
  const untrustedMessage =
    error instanceof Error ? `${error.name} ${error.message}` : typeof error === "string" ? error : "";
  const classificationText = truncateUtf8(
    untrustedMessage,
    MAX_TAVILY_ERROR_CLASSIFICATION_BYTES,
  ).toLowerCase();

  if (/\b(?:timeout|timed out|econnaborted)\b/.test(classificationText)) {
    return "timeout: request timed out";
  }
  if (/\b(?:rate limit|too many requests|429|tavilykeylesslimiterror)\b/.test(classificationText)) {
    return "rate limit: request quota was exceeded";
  }
  if (/\b(?:unauthorized|forbidden|api[ _-]?key|credentials?|401|403)\b/.test(classificationText)) {
    return "authentication: credentials were rejected";
  }
  if (classificationText.includes("invalid country")) {
    return "invalid request: country option was rejected";
  }
  if (/\b(?:invalid request|bad request|validation|400)\b/.test(classificationText)) {
    return "invalid request: search options were rejected";
  }
  if (/\b(?:network|econnrefused|enotfound|eai_again|socket|fetch failed)\b/.test(classificationText)) {
    return "network: Tavily could not be reached";
  }
  if (/\b(?:5\d{2}|service unavailable|upstream|internal server error)\b/.test(classificationText)) {
    return "service: Tavily returned an upstream error";
  }
  return "unexpected: no safe error detail available";
}

function tavilyFailureWarning(searchNumber: number, error: unknown): string {
  return truncateUtf8(
    `Tavily search ${searchNumber} failed (${safeTavilyFailureDetail(error)}).`,
    MAX_TAVILY_FAILURE_WARNING_BYTES,
  );
}

function providerIdFromDomain(domain: string): string {
  return `web-${domain.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function personalAutoCarrierForHostname(hostname: string): PersonalAutoCarrier | null {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
  return (
    PERSONAL_AUTO_CARRIER_REGISTRY.find(
      (carrier) =>
        normalizedHostname === carrier.domain ||
        normalizedHostname.endsWith(`.${carrier.domain}`),
    ) ?? null
  );
}

function sourceId(providerId: string, sourceIndex: number): string {
  return `${providerId}-tavily-${sourceIndex + 1}`;
}

function boundedEvidenceText(result: SearchResultRecord): string {
  return truncateUtf8(
    `${result.title} ${result.content} ${result.rawContent ?? ""}`,
    MAX_TAVILY_EVIDENCE_BYTES,
  );
}

function normalizedEvidenceText(result: SearchResultRecord): string {
  return ` ${compactWhitespace(boundedEvidenceText(result))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")} `;
}

function includesPhrase(text: string, phrase: string): boolean {
  const normalizedPhrase = phrase.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return normalizedPhrase !== "" && text.includes(` ${normalizedPhrase} `);
}

function mentionsInsuranceLine(text: string, insuranceLine: string): boolean {
  if (insuranceLine === "auto") {
    return ["auto insurance", "car insurance", "automobile insurance", "vehicle insurance"].some(
      (phrase) => includesPhrase(text, phrase),
    );
  }
  return includesPhrase(text, `${insuranceLine.replaceAll("_", " ")} insurance`);
}

function mentionsCoverageCode(text: string, coverageCode: string): boolean {
  const aliases = AUTO_COVERAGE_ALIASES[coverageCode] ?? [coverageCode.replaceAll("_", " ")];
  if (aliases.some((alias) => includesPhrase(text, alias))) return true;

  return (
    coverageCode === "uninsured_underinsured_motorist" &&
    includesPhrase(text, "uninsured") &&
    includesPhrase(text, "underinsured")
  );
}

function containsUppercaseStateCode(text: string, stateCode: string): boolean {
  const escapedStateCode = stateCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escapedStateCode}\\b`).test(text);
}

function inferAvailability(
  result: SearchResultRecord,
  quoteRequest: ConfirmedQuoteRequest,
): {
  insuranceLines: RawResearchCandidate["insuranceLines"];
  states: string[];
  nationwide: boolean;
  coverageCodes: string[];
} {
  const evidenceText = boundedEvidenceText(result);
  const text = normalizedEvidenceText(result);
  const stateCode = quoteRequest.state.toUpperCase();
  const stateName = STATE_NAMES[stateCode];
  const zipCode = quoteRequest.zipCode.toLowerCase();
  const baseZipCode = zipCode.slice(0, 5);
  const nationwide = ["nationwide", "all 50 states", "across the united states"].some(
    (phrase) => includesPhrase(text, phrase),
  );
  const stateMentioned =
    containsUppercaseStateCode(evidenceText, stateCode) ||
    (stateName ? includesPhrase(text, stateName) : false) ||
    includesPhrase(text, zipCode) ||
    includesPhrase(text, baseZipCode);
  const insuranceLines = quoteRequest.insuranceLines.filter((line) =>
    mentionsInsuranceLine(text, line),
  );
  const coverageCodes = quoteRequest.requestedCoverage
    .filter((coverage) => mentionsCoverageCode(text, coverage.coverageCode))
    .map((coverage) => coverage.coverageCode);

  return {
    insuranceLines,
    states: stateMentioned ? [stateCode] : [],
    nationwide,
    coverageCodes,
  };
}

function extractRatingAndReviews(result: SearchResultRecord): {
  rating: number;
  scaleMaximum: number;
  reviewCount: number;
} | null {
  const text = compactWhitespace(boundedEvidenceText(result));
  const ratingMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(?:out\s+of|\/)\s*(5|10)\b/i);
  const reviewMatch = text.match(
    /\b(?:based\s+on\s+)?([\d,]+)\s+(?:verified\s+|customer\s+)?reviews?\b/i,
  );
  if (!ratingMatch || !reviewMatch) return null;

  const rating = Number(ratingMatch[1]);
  const scaleMaximum = Number(ratingMatch[2]);
  const reviewCount = Number(reviewMatch[1].replaceAll(",", ""));
  if (
    !Number.isFinite(rating) ||
    !Number.isFinite(scaleMaximum) ||
    !Number.isSafeInteger(reviewCount) ||
    rating < 0 ||
    rating > scaleMaximum ||
    reviewCount < 0
  ) {
    return null;
  }

  return { rating, scaleMaximum, reviewCount };
}

function toSource(
  result: SearchResultRecord,
  retrievedAt: string,
  providerId: string,
  sourceIndex: number,
  carrier: PersonalAutoCarrier,
): ResearchSource {
  const domain = new URL(result.url).hostname.toLowerCase();
  const excerpt = truncateUtf8(
    result.content || result.rawContent || result.title,
    MAX_TAVILY_SOURCE_EXCERPT_BYTES,
  );
  return {
    id: sourceId(providerId, sourceIndex),
    title: result.title,
    url: result.url,
    domain,
    publisher: carrier.providerName,
    retrievedAt,
    publishedAt: result.publishedDate,
    excerpt,
    officialSource: true,
    sourceKind: "provider",
    confidence: result.score,
  };
}

export function mapTavilyResults(
  rawResults: readonly unknown[],
  input: ResearchInput,
): {
  candidates: RawResearchCandidate[];
  malformedResultCount: number;
  insufficientEvidenceCount: number;
} {
  const { quoteRequest, retrievedAt } = validateResearchInput(input);
  const byDomain = new Map<string, CandidateAccumulator>();
  const parsedResults: SearchResultRecord[] = [];
  let malformedResultCount = 0;

  for (const rawResult of rawResults) {
    const result = parseSearchResult(rawResult);
    if (!result) {
      malformedResultCount += 1;
    } else {
      parsedResults.push(result);
    }
  }

  parsedResults.sort((left, right) => {
    if (left.url !== right.url) return left.url < right.url ? -1 : 1;
    if (left.title !== right.title) return left.title < right.title ? -1 : 1;
    return left.content < right.content ? -1 : left.content > right.content ? 1 : 0;
  });

  for (const result of parsedResults) {
    const resultUrl = new URL(result.url);
    const carrier = personalAutoCarrierForHostname(resultUrl.hostname);
    if (!carrier || !quoteRequest.insuranceLines.includes("auto")) continue;
    const domain = carrier.domain;
    const availability = inferAvailability(result, quoteRequest);
    const existing = byDomain.get(domain);
    if (existing) {
      if (!existing.sources.some((source) => source.url === result.url)) {
        const source = toSource(
          result,
          retrievedAt,
          existing.providerId,
          existing.sources.length,
          carrier,
        );
        existing.sources.push(source);
        const rating = extractRatingAndReviews(result);
        if (rating && existing.ratingSourceId === null) {
          existing.rating = rating.rating;
          existing.ratingScaleMaximum = rating.scaleMaximum;
          existing.reviewCount = rating.reviewCount;
          existing.ratingSourceId = source.id;
          existing.ratingObservedAt = source.publishedAt ?? retrievedAt;
        }
      }
      availability.insuranceLines.forEach((line) => existing.insuranceLines.add(line));
      availability.states.forEach((state) => existing.states.add(state));
      availability.coverageCodes.forEach((code) => existing.preliminaryCoverageCodes.add(code));
      existing.nationwide ||= availability.nationwide;
      continue;
    }

    const providerId = providerIdFromDomain(domain);
    const source = toSource(result, retrievedAt, providerId, 0, carrier);
    const rating = extractRatingAndReviews(result);
    byDomain.set(domain, {
      providerId,
      canonicalCarrierId: providerId,
      providerName: carrier.providerName,
      website: `https://${domain}`,
      sources: [source],
      insuranceLines: new Set(availability.insuranceLines),
      states: new Set(availability.states),
      nationwide: availability.nationwide,
      preliminaryCoverageCodes: new Set(availability.coverageCodes),
      rating: rating?.rating ?? null,
      ratingScaleMaximum: rating?.scaleMaximum ?? null,
      reviewCount: rating?.reviewCount ?? null,
      ratingSourceId: rating ? source.id : null,
      ratingObservedAt: rating ? (source.publishedAt ?? retrievedAt) : null,
    });
  }

  const accumulatedCandidates = [...byDomain.values()].sort((left, right) =>
    left.providerId < right.providerId ? -1 : left.providerId > right.providerId ? 1 : 0,
  );
  const insufficientEvidenceCount = accumulatedCandidates.filter((candidate) => {
    const supportedLines = candidate.insuranceLines;
    const supportedCoverage = candidate.preliminaryCoverageCodes;
    return (
      !quoteRequest.insuranceLines.every((line) => supportedLines.has(line)) ||
      (!candidate.nationwide && !candidate.states.has(quoteRequest.state)) ||
      !quoteRequest.requestedCoverage
        .filter((coverage) => coverage.required)
        .every((coverage) => supportedCoverage.has(coverage.coverageCode))
    );
  }).length;
  const candidates = accumulatedCandidates
    .map(
      (candidate): RawResearchCandidate => ({
        providerId: candidate.providerId,
        canonicalCarrierId: candidate.canonicalCarrierId,
        providerName: candidate.providerName,
        providerType: "carrier",
        insuranceLines: [...candidate.insuranceLines].sort(),
        nationwide: candidate.nationwide,
        states: [...candidate.states].sort(),
        excludedZipCodes: [],
        preliminaryCoverageCodes: [...candidate.preliminaryCoverageCodes].sort(),
        website: candidate.website,
        publicContact: null,
        rating: candidate.rating,
        ratingScaleMaximum: candidate.ratingScaleMaximum,
        reviewCount: candidate.reviewCount,
        ratingSourceId: candidate.ratingSourceId,
        ratingObservedAt: candidate.ratingObservedAt,
        licenseVerificationStatus: "unverified",
        publicDiscounts: [],
        publicCoverageOptions: [],
        sources: candidate.sources,
        simulated: false,
      }),
    );

  return { candidates, malformedResultCount, insufficientEvidenceCount };
}

export class TavilyResearchProvider implements ResearchProvider {
  private readonly client: TavilySearchClient;
  private readonly maxResults: number;
  private readonly timeoutSeconds: number;

  constructor(options: TavilyResearchProviderOptions) {
    if (!options.client && !options.apiKey?.trim()) {
      throw new Error("TavilyResearchProvider requires an API key or injected client.");
    }
    if (
      options.maxResults !== undefined &&
      (!Number.isInteger(options.maxResults) ||
        options.maxResults <= 0 ||
        options.maxResults > MAX_TAVILY_RESULTS)
    ) {
      throw new Error(`Tavily maxResults must be an integer from 1 to ${MAX_TAVILY_RESULTS}.`);
    }
    if (
      options.timeoutSeconds !== undefined &&
      (!Number.isFinite(options.timeoutSeconds) ||
        options.timeoutSeconds <= 0 ||
        options.timeoutSeconds > MAX_TAVILY_TIMEOUT_SECONDS)
    ) {
      throw new Error(
        `Tavily timeoutSeconds must be greater than 0 and at most ${MAX_TAVILY_TIMEOUT_SECONDS}.`,
      );
    }
    this.client = options.client ?? tavily({ apiKey: options.apiKey });
    this.maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
    this.timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  }

  async research(input: ResearchInput) {
    const validatedInput = validateResearchInput(input);
    const queries = buildTavilyResearchQueries(validatedInput);
    const rawResults: unknown[] = [];
    const warnings: string[] = [];

    for (const [queryIndex, query] of queries.entries()) {
      try {
        const response = await this.client.search(query, {
          searchDepth: "advanced",
          maxResults: this.maxResults,
          includeRawContent: "text",
          includeDomains: validatedInput.quoteRequest.insuranceLines.includes("auto")
            ? PERSONAL_AUTO_OFFICIAL_DOMAINS
            : undefined,
          topic: "general",
          country: TAVILY_US_COUNTRY,
          timeout: this.timeoutSeconds,
        });
        const results = responseResults(response);
        if (results === null) {
          warnings.push(`Tavily returned a malformed response for search ${queryIndex + 1}.`);
          continue;
        }
        rawResults.push(...results.slice(0, this.maxResults));
      } catch (error) {
        warnings.push(tavilyFailureWarning(queryIndex + 1, error));
      }
    }

    const mapped = mapTavilyResults(rawResults, validatedInput);
    if (mapped.malformedResultCount > 0) {
      warnings.push(
        `Ignored ${mapped.malformedResultCount} malformed Tavily result${mapped.malformedResultCount === 1 ? "" : "s"}.`,
      );
    }
    if (mapped.candidates.length === 0) {
      warnings.push("Tavily returned no usable provider-domain candidates.");
    }
    if (mapped.insufficientEvidenceCount > 0) {
      warnings.push(
        `${mapped.insufficientEvidenceCount} provider-domain candidate${mapped.insufficientEvidenceCount === 1 ? " lacked" : "s lacked"} explicit line, jurisdiction, or required-coverage evidence and may be ineligible.`,
      );
    }

    return validateRawResearchResult({ candidates: mapped.candidates, warnings });
  }
}
