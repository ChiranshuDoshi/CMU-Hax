/**
 * Querit-backed hotel discovery + travel-aggregator rate lookup for StayScout.
 * Stay params come from the remapped CarProfile (city→make, room→model, rooms→mileage).
 */
import {
  validateRawResearchResult,
  validateResearchInput,
  type ResearchInput,
  type ResearchProvider,
} from "@/domain/research";
import type { RawResearchCandidate } from "@/domain/schemas/person4";

import {
  normalizeQueritHits,
  type QueritResearchProviderOptions,
  type QueritSearchClient,
  type QueritSearchResponse,
} from "./querit-research-provider";

const DEFAULT_BASE_URL = "https://api.querit.ai/v1";
const DEFAULT_COUNT = 12;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_HOTELS = 5;
const COVERAGE_CODES = ["BI", "COLL", "COMP"] as const;

/** Minimal stay fields (compatible with CarProfile remapping). */
export interface HotelStayProfile {
  make: string;
  model: string;
  bodyType?: string;
  state: string;
  zipCode: string;
  annualMileage?: number;
  currentPremiumCents?: number | null;
}

export const TRAVEL_AGGREGATOR_DOMAINS = [
  "booking.com",
  "expedia.com",
  "hotels.com",
  "kayak.com",
  "tripadvisor.com",
  "hotelscombined.com",
] as const;

/** Shape of a normalized Querit hit (the mapper returns `unknown[]`). */
interface SearchHitRecord {
  title?: unknown;
  url?: unknown;
  content?: unknown;
}

function asSearchHits(records: readonly unknown[]): SearchHitRecord[] {
  return records.filter((record): record is SearchHitRecord => typeof record === "object" && record !== null);
}

export interface AggregatorPrice {
  name: string;
  nightlyCents: number;
  url: string;
  domain: string;
}

export interface HotelPriceHint {
  providerId: string;
  nightlyCents: number;
  roomType: string;
  aggregators: AggregatorPrice[];
}

export interface HotelResearchResult {
  candidates: RawResearchCandidate[];
  warnings: string[];
  priceHints: HotelPriceHint[];
}

const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_BACKOFF_MS = 600;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRateLimited(response: QueritSearchResponse, status: number): boolean {
  return status === 429 || response?.error_code === 429;
}

function createHttpClient(apiKey: string, baseUrl: string, timeoutMs: number): QueritSearchClient {
  async function requestOnce(
    query: string,
    count: number,
    includeDomains: readonly string[] | undefined,
  ): Promise<{ status: number; body: QueritSearchResponse }> {
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

      const text = await response.text();
      let body: QueritSearchResponse;
      try {
        body = JSON.parse(text) as QueritSearchResponse;
      } catch {
        if (!response.ok) {
          throw new Error(text.slice(0, 240) || `Querit search failed (${response.status})`);
        }
        throw new Error("Querit returned a non-JSON response.");
      }
      return { status: response.status, body };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async search({ query, count, includeDomains }) {
      // Discovery fans out several searches per stay, so 429s are common;
      // back off briefly rather than dropping the whole destination.
      for (let attempt = 0; ; attempt += 1) {
        const { status, body } = await requestOnce(query, count, includeDomains);
        if (isRateLimited(body, status) && attempt < RATE_LIMIT_RETRIES) {
          await sleep(RATE_LIMIT_BACKOFF_MS * (attempt + 1));
          continue;
        }
        if (status !== 200 && !body?.results) {
          throw new Error(
            body?.error_msg?.trim() || `Querit search failed (${status})`,
          );
        }
        return body;
      }
    },
  };
}

export function stayParamsFromProfile(profile: HotelStayProfile): {
  city: string;
  state: string;
  zipCode: string;
  roomType: string;
  rooms: number;
  budgetNightly: number | null;
  hotelClass: string;
} {
  const city = profile.make.trim() || "Chicago";
  const roomType = (profile.bodyType || profile.model || "Deluxe").trim();
  const rooms = profile.annualMileage && profile.annualMileage > 0 && profile.annualMileage < 5_000
    ? profile.annualMileage
    : 24;
  const budgetNightly =
    profile.currentPremiumCents != null && profile.currentPremiumCents > 0
      ? Math.round(profile.currentPremiumCents / 100)
      : null;
  return {
    city,
    state: profile.state.toUpperCase(),
    zipCode: profile.zipCode.slice(0, 5),
    roomType,
    rooms,
    budgetNightly,
    hotelClass: roomType.toLowerCase().includes("ultra") ? "5-star" : "4-star",
  };
}

/**
 * Discovery queries, each scoped to the aggregators whose URLs expose a single
 * property. Generic "best hotels in X" phrasing returns listicles, so these
 * lean on review/rate wording that lands on hotel detail pages instead.
 */
export function buildHotelDiscoveryQueries(
  profile: HotelStayProfile,
): Array<{ query: string; includeDomains: readonly string[] }> {
  const stay = stayParamsFromProfile(profile);
  return [
    {
      query: `${stay.city} ${stay.state} hotel deals reviews from $ per night`,
      includeDomains: ["kayak.com"],
    },
    {
      query: `${stay.city} ${stay.state} hotel reviews rooms prices`,
      includeDomains: PROPERTY_PAGE_DOMAINS,
    },
    {
      query: `${stay.hotelClass} hotel ${stay.city} ${stay.state} downtown reviews rooms rates`,
      includeDomains: PROPERTY_PAGE_DOMAINS,
    },
  ];
}

export function buildAggregatorPriceQuery(hotelName: string, city: string, roomType: string): string {
  return `"${hotelName}" ${city} ${roomType} hotel nightly rate OR price per night`;
}

export function extractNightlyPriceCents(text: string): number | null {
  const normalized = text.replace(/,/g, " ");
  const patterns = [
    /\$\s*(\d{2,4})(?:\.\d{2})?\s*(?:per\s*)?(?:\/\s*)?night/i,
    /(\d{2,4})(?:\.\d{2})?\s*(?:USD|usd)?\s*(?:per\s*)?(?:\/\s*)?night/i,
    /from\s*\$\s*(\d{2,4})/i,
    /nightly\s*(?:rate|price)?\s*:?\s*\$\s*(\d{2,4})/i,
    /\$\s*(\d{2,4})\s*(?:avg|average|starting)/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const dollars = Number(match[1]);
    if (dollars >= 40 && dollars <= 2_500) return dollars * 100;
  }
  return null;
}

/** Multiple of the cheapest rate above which a price is treated as a stay total. */
const OUTLIER_MULTIPLE = 3;

/**
 * Aggregator snippets sometimes quote a multi-night total or a different room
 * class. Anything far above the cheapest rate would distort the negotiation
 * target, so drop it. Mutates the (ascending) list in place.
 */
export function dropPriceOutliers(aggregators: AggregatorPrice[]): void {
  const cheapest = aggregators[0]?.nightlyCents;
  if (cheapest == null) return;
  const ceiling = cheapest * OUTLIER_MULTIPLE;
  for (let index = aggregators.length - 1; index > 0; index -= 1) {
    if (aggregators[index]!.nightlyCents > ceiling) aggregators.splice(index, 1);
  }
}

export function aggregatorNameFromDomain(domain: string): string {
  const host = domain.replace(/^www\./, "").toLowerCase();
  if (host.includes("booking.com")) return "Booking.com";
  if (host.includes("expedia.com")) return "Expedia";
  if (host.includes("hotels.com")) return "Hotels.com";
  if (host.includes("kayak.com")) return "Kayak";
  if (host.includes("tripadvisor.com")) return "Tripadvisor";
  if (host.includes("hotelscombined.com")) return "HotelsCombined";
  return host.split(".")[0]?.replace(/^\w/, (c) => c.toUpperCase()) || host;
}

function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "hotel";
}

const LISTICLE_TITLE =
  /\b(best|top|cheap|cheapest|deals?|discount|special rates?|find|compare|guide|list|directory|things to do|where to stay|hotels? in|stars? hotels?|hotel deals?)\b/i;

const PROPERTY_KEYWORD =
  /\b(hotel|inn|suites?|resort|lodge|hostel|motel|collection by|curio|autograph|marriott|hilton|hyatt|westin|sheraton|radisson|fairmont|renaissance|courtyard|residence inn|hampton|embassy suites|w hotel|ace hotel)\b/i;

const GENERIC_DESTINATION =
  /^(hotels?|accommodations?|places to stay)\b/i;

/**
 * Aggregator URL shapes that identify exactly one property. Verified against
 * live Querit results; the capture group is always the hotel-name slug.
 */
const PROPERTY_URL_PATTERNS: readonly RegExp[] = [
  // kayak.com/Cleveland-Hotels-Hilton-Cleveland-Downtown.2529720.ksp
  /kayak\.[a-z.]+\/[^/]*?Hotels-([A-Za-z0-9-]+?)\.\d+\.ksp/i,
  // hotels.com/ho572368/hilton-cleveland-downtown-cleveland-united-states-of-america/
  /hotels\.com\/(?:[a-z]{2}\/)?ho\d+\/([a-z0-9-]+)/i,
  // expedia.com/Cleveland-Hotels-The-Westin.h109193598.Hotel-Information
  /expedia\.[a-z.]+\/[^/]*?Hotels-([A-Za-z0-9-]+?)\.h\d+\.Hotel-Information/i,
  // tripadvisor.com/Hotel_Review-g50077-d224220-Reviews-Hilton_Cleveland-Cleveland_Ohio.html
  /tripadvisor\.[a-z.]+\/Hotel_Review-g\d+-d\d+-Reviews-([A-Za-z0-9_]+?)-/i,
  // booking.com/hotel/us/hilton-cleveland-downtown.html
  /booking\.com\/hotel\/[a-z]{2}\/([a-z0-9-]+)\./i,
];

/** Domains whose URLs we can reliably resolve to a single property. */
const PROPERTY_PAGE_DOMAINS = [
  "kayak.com",
  "hotels.com",
  "expedia.com",
  "tripadvisor.com",
  "booking.com",
] as const;

/**
 * Short-term rentals and room listings leak into OTA hotel results; they are
 * not properties with a sales desk to negotiate against.
 */
const RENTAL_LISTING =
  /\b(\d+\s*(?:br|bdrm|bed|bedroom)s?|studio|full kitchen|kitchenette|apartment|apt|condo|home|house rental|vacation rental|by kasa|by lyric|frontdesk|entire|sleeps|private room|bnb)\b/i;

/** hotels.com slugs end in the country, so non-US properties are detectable. */
const NON_US_SLUG =
  /-(czech-republic|united-kingdom|mexico|canada|germany|france|spain|italy|japan|china|india|brazil|australia|netherlands|poland|turkey|thailand|vietnam)$/i;

const US_STATE_CODES =
  "al ak az ar ca co ct de fl ga hi id il in ia ks ky me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy".split(
    " ",
  );

const UPPERCASE_TOKENS = new Set([
  "ihg",
  "jw",
  "ac",
  "bw",
  "mgm",
  "nyc",
  "dc",
  ...US_STATE_CODES,
]);

/** Turn an aggregator path slug into a readable hotel name. */
export function hotelNameFromAggregatorUrl(url: string, city: string): string | null {
  for (const pattern of PROPERTY_URL_PATTERNS) {
    const match = url.match(pattern);
    if (match?.[1]) {
      return titleCaseHotelSlug(match[1], city);
    }
  }
  return null;
}

/** Drops a trailing city repeat, e.g. "oxford suites boise boise". */
function collapseRepeatedCityTail(words: string[], city: string): string[] {
  const cityWords = city.toLowerCase().split(/\s+/).filter(Boolean);
  if (cityWords.length === 0) return words;
  const tail = words.slice(-cityWords.length).map((word) => word.toLowerCase());
  const matchesCity = tail.length === cityWords.length && tail.every((word, i) => word === cityWords[i]);
  if (!matchesCity) return words;
  const head = words.slice(0, -cityWords.length);
  const cityAppearsEarlier = head.some((word) => cityWords.includes(word.toLowerCase()));
  return cityAppearsEarlier && head.length >= 2 ? head : words;
}

function titleCaseHotelSlug(slug: string, city: string): string | null {
  if (NON_US_SLUG.test(slug)) return null;

  const raw = slug
    .replace(/\.html?$/i, "")
    .replace(/[_+]+/g, "-")
    .replace(/-united-states-of-america$/i, "")
    .replace(/-+/g, " ")
    .trim();
  if (raw.length < 3) return null;

  const words = collapseRepeatedCityTail(raw.split(/\s+/).filter(Boolean), city);
  let named = words
    .map((word) =>
      UPPERCASE_TOKENS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(" ");

  // Some slugs omit the category ("joinery-pittsburgh"). Only infer it for
  // clean multi-word alphabetic names so junk slugs stay rejected.
  const hasCategory = PROPERTY_KEYWORD.test(named) || /\b(grand|plaza|house|tower|palace)\b/i.test(named);
  if (!hasCategory && words.length >= 2 && !/\d/.test(named)) {
    named = `${named} Hotel`;
  }

  return isIndividualHotelName(named, city) ? named : null;
}

export function isIndividualHotelName(name: string, city: string): boolean {
  const cleaned = name.trim();
  if (!cleaned || cleaned.length < 5 || cleaned.length > 70) return false;
  if (LISTICLE_TITLE.test(cleaned)) return false;
  if (RENTAL_LISTING.test(cleaned)) return false;
  if (!/[a-z]/i.test(cleaned.replace(/[^a-z]/gi, "")) || /^\W*\d/.test(cleaned)) return false;
  const words = cleaned.split(/\s+/);
  // Romanized/translated slugs produce long unpronounceable tokens.
  if (words.length > 9 || words.some((word) => word.replace(/[^a-z]/gi, "").length > 14)) return false;
  if (GENERIC_DESTINATION.test(cleaned)) return false;
  if (/^\d/.test(cleaned) && /\bhotels?\b/i.test(cleaned)) return false;
  if (new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+hotels?$`, "i").test(cleaned)) {
    return false;
  }
  if (/^(the\s+)?(best|top|cheap)\b/i.test(cleaned)) return false;
  if (!PROPERTY_KEYWORD.test(cleaned) && !/\b(grand|plaza|house|tower|palace)\b/i.test(cleaned)) {
    return false;
  }
  // Reject "4-star Hotels in X" / "Hotels in X" style even if PROPERTY_KEYWORD matched "Hotels"
  if (/\bhotels\b/i.test(cleaned) && !/\bhotel\b/i.test(cleaned.replace(/\bhotels\b/gi, ""))) {
    // has plural "hotels" as the property word → almost always a listicle
    if (!/\b(hotel|inn|suites?|resort)\b/i.test(cleaned.replace(/\bhotels\b/gi, " "))) {
      return false;
    }
  }
  return true;
}

/** OTA titles arrive shouted ("COMFORT INN SAVANNAH"); normalize the casing. */
function normalizeCasing(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name
    .split(/\s+/)
    .map((word) =>
      UPPERCASE_TOKENS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(" ");
}

export function cleanHotelTitle(title: string, city: string): string | null {
  let cleaned = title
    .split(/\s+[|\-–—]\s+/)[0]
    ?.split(":")[0]
    ?.replace(/\s+reviews?.*$/i, "")
    .replace(/\s+from\s*\$\s*[\d,]+.*$/i, "")
    .replace(/\s+\(\d{4}\).*$/, "")
    .replace(/,?\s*(official site|homepage|booking\.com|expedia|hotels\.com|tripadvisor).*$/i, "")
    .replace(new RegExp(`,\\s*${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(\\([A-Z]{2}\\))?$`, "i"), "")
    .trim();
  if (!cleaned) return null;
  // "Joinery Hotel Pittsburgh, Curio Collection by Hilton, Pittsburgh (PA)" → keep brand chain
  const parts = cleaned.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2 && PROPERTY_KEYWORD.test(parts[0]!)) {
    const second = parts[1]!;
    if (/curio|autograph|collection|marriott|hilton|hyatt/i.test(second)) {
      cleaned = `${parts[0]}, ${second}`;
    } else {
      cleaned = parts[0]!;
    }
  }
  cleaned = normalizeCasing(
    collapseRepeatedCityTail(cleaned.split(/\s+/).filter(Boolean), city).join(" "),
  );
  return isIndividualHotelName(cleaned, city) ? cleaned : null;
}

export function extractHotelNamesFromHits(
  hits: readonly SearchHitRecord[],
  city: string,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  function pushName(name: string | null | undefined) {
    if (!name) return;
    // Trailing "hotel" and the state code vary between sources for the same
    // property, so ignore them when deduping.
    const key = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .replace(/hotel$/, "");
    if (key.length < 4 || seen.has(key)) return;
    if (!isIndividualHotelName(name, city)) return;
    seen.add(key);
    names.push(name);
  }

  // Prefer aggregator property URLs — these are real hotels, not listicles.
  for (const hit of hits) {
    pushName(hotelNameFromAggregatorUrl(String(hit.url ?? ""), city));
  }

  for (const hit of hits) {
    pushName(cleanHotelTitle(String(hit.title ?? ""), city));
  }

  return names;
}

/**
 * Universal fallback used only when discovery finds too few properties. Bare
 * chain names carry no location, so the same list is reusable for every
 * destination — the stay's city is shown alongside them in the UI.
 */
export const FALLBACK_HOTEL_CHAINS: readonly string[] = [
  "Hilton",
  "Marriott",
  "Hyatt",
  "Sheraton",
  "Holiday Inn",
];

/**
 * Chain shortlist for demo mode (no Querit key) and for live searches that
 * return no usable properties. Rates still key off the stay's budget.
 */
export function buildOfflineHotelCandidates(
  profile: HotelStayProfile,
  input: ResearchInput,
): RawResearchCandidate[] {
  const validatedInput = validateResearchInput(input);
  const stay = stayParamsFromProfile(profile);
  const coverageCodes = [
    ...new Set(validatedInput.quoteRequest.requestedCoverage.map((item) => item.coverageCode)),
  ];
  const baseNightly = stay.budgetNightly ?? 248;

  return FALLBACK_HOTEL_CHAINS.map((name, index) => {
    const nightly = baseNightly + index * 16;
    const searchUrl = (aggregator: string) =>
      `https://www.google.com/search?q=${encodeURIComponent(`${name} ${stay.city} ${aggregator} price`)}`;
    const aggregators: AggregatorPrice[] = [
      { name: "Booking.com", nightlyCents: nightly * 100, url: searchUrl("Booking.com"), domain: "booking.com" },
      { name: "Expedia", nightlyCents: (nightly + 9) * 100, url: searchUrl("Expedia"), domain: "expedia.com" },
      { name: "Hotels.com", nightlyCents: (nightly + 15) * 100, url: searchUrl("Hotels.com"), domain: "hotels.com" },
    ];

    return buildCandidate({
      name,
      state: stay.state,
      retrievedAt: validatedInput.retrievedAt,
      website: null,
      rating: Math.round((4.9 - index * 0.1) * 10) / 10,
      reviews: 18_400 - index * 2_300,
      roomType: `${stay.roomType} king`,
      aggregators,
      discoveryExcerpt: `${name} matched ${stay.hotelClass} group stay search in ${stay.city}, ${stay.state}.`,
      coverageCodes,
      insuranceLines: [...validatedInput.quoteRequest.insuranceLines],
      simulated: true,
    });
  });
}

/** Demo-mode hotel research (no Querit key) that still respects the destination. */
export class OfflineHotelResearchProvider implements ResearchProvider {
  constructor(private readonly profile: HotelStayProfile) {}

  async research(input: ResearchInput) {
    const validatedInput = validateResearchInput(input);
    return validateRawResearchResult({
      candidates: buildOfflineHotelCandidates(this.profile, validatedInput),
      warnings: [
        "Demo mode: hotel identities, ratings, and aggregator rates are illustrative for this destination.",
      ],
    });
  }
}

function parseRating(text: string): { rating: number | null; reviews: number | null } {
  const ratingMatch = text.match(/(\d(?:\.\d)?)\s*(?:\/\s*5|out of 5|stars?)/i);
  const reviewMatch = text.match(/([\d,]+)\s*(?:guest\s*)?reviews?/i);
  const rating = ratingMatch ? Number(ratingMatch[1]) : null;
  const reviews = reviewMatch ? Number(reviewMatch[1].replace(/,/g, "")) : null;
  return {
    rating: rating != null && rating >= 1 && rating <= 5 ? rating : null,
    reviews: reviews != null && Number.isFinite(reviews) ? reviews : null,
  };
}

function buildCandidate(input: {
  name: string;
  state: string;
  retrievedAt: string;
  website: string | null;
  rating: number | null;
  reviews: number | null;
  roomType: string;
  aggregators: AggregatorPrice[];
  discoveryExcerpt: string;
  coverageCodes: string[];
  insuranceLines: RawResearchCandidate["insuranceLines"];
  simulated?: boolean;
}): RawResearchCandidate {
  const providerId = slugify(input.name);
  const coverageCodes = input.coverageCodes.length > 0 ? input.coverageCodes : [...COVERAGE_CODES];
  const website = safeUrl(input.website);
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`${input.name} hotel contact`)}`;
  const sources = [
    {
      id: `${providerId}-discovery`,
      title: `${input.name} hotel discovery`,
      url: website ?? `https://www.google.com/search?q=${encodeURIComponent(input.name + " hotel")}`,
      domain: website ? hostnameOf(website) || "search" : "search",
      publisher: "Querit hotel search",
      retrievedAt: input.retrievedAt,
      publishedAt: null,
      excerpt: input.discoveryExcerpt.slice(0, 400) || `${input.name} matched stay search parameters.`,
      officialSource: false,
      sourceKind: "search_snippet" as const,
      confidence: 0.7,
    },
    ...input.aggregators.map((agg, index) => ({
      id: `${providerId}-agg-${index}`,
      title: `${input.name} rate on ${agg.name}`,
      url: safeUrl(agg.url) ?? `https://www.google.com/search?q=${encodeURIComponent(input.name + " " + agg.name)}`,
      domain: agg.domain || "search",
      publisher: agg.name,
      retrievedAt: input.retrievedAt,
      publishedAt: null,
      excerpt: `${agg.name} lists about $${(agg.nightlyCents / 100).toFixed(0)} per night for ${input.roomType}.`,
      officialSource: false,
      sourceKind: "secondary" as const,
      confidence: 0.8,
    })),
  ];

  const lowest = input.aggregators[0]?.nightlyCents;
  const publicDiscounts = [
    input.roomType ? `room_type:${input.roomType}` : null,
    lowest != null ? `aggregator_nightly_cents:${lowest}` : null,
    ...input.aggregators.map((agg) => `agg:${agg.name}=${agg.nightlyCents}`),
  ].filter(Boolean) as string[];

  return {
    providerId,
    canonicalCarrierId: providerId,
    providerName: input.name,
    providerType: "marketplace",
    insuranceLines: [...input.insuranceLines],
    nationwide: true,
    states: [input.state],
    excludedZipCodes: [],
    preliminaryCoverageCodes: coverageCodes,
    website,
    // Ranking marks candidates ineligible without contactability, so always
    // carry a reachable lookup even when discovery found no official site.
    publicContact: website ?? searchUrl,
    rating: input.rating,
    ratingScaleMaximum: 5,
    reviewCount: input.reviews,
    ratingSourceId: sources[0]?.id ?? null,
    ratingObservedAt: input.retrievedAt,
    licenseVerificationStatus: "not_applicable",
    publicDiscounts,
    publicCoverageOptions: coverageCodes,
    sources,
    simulated: input.simulated ?? false,
  };
}

export class HotelQueritResearchProvider implements ResearchProvider {
  private readonly client: QueritSearchClient;
  private readonly count: number;
  private readonly profile: HotelStayProfile;
  private lastPriceHints: HotelPriceHint[] = [];

  constructor(profile: HotelStayProfile, options: QueritResearchProviderOptions = {}) {
    const apiKey = options.apiKey?.trim();
    if (!options.client && !apiKey) {
      throw new Error("HotelQueritResearchProvider requires an API key or injected client.");
    }
    this.profile = profile;
    this.count = options.count ?? DEFAULT_COUNT;
    this.client =
      options.client ??
      createHttpClient(
        apiKey!,
        options.baseUrl?.trim() || process.env.QUERIT_BASE_URL?.trim() || DEFAULT_BASE_URL,
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
  }

  getPriceHints(): HotelPriceHint[] {
    return this.lastPriceHints;
  }

  async research(input: ResearchInput) {
    const validatedInput = validateResearchInput(input);
    const stay = stayParamsFromProfile(this.profile);
    const warnings: string[] = [];
    const discoveryHits: SearchHitRecord[] = [];
    const coverageCodes = [
      ...new Set(validatedInput.quoteRequest.requestedCoverage.map((item) => item.coverageCode)),
    ];
    const insuranceLines = [...validatedInput.quoteRequest.insuranceLines];

    for (const [queryIndex, discovery] of buildHotelDiscoveryQueries(this.profile).entries()) {
      try {
        const response = await this.client.search({
          query: discovery.query,
          count: this.count,
          includeDomains: discovery.includeDomains,
        });
        discoveryHits.push(...asSearchHits(normalizeQueritHits(response)));
      } catch (error) {
        warnings.push(
          `Hotel discovery search ${queryIndex + 1} failed (${error instanceof Error ? error.message.slice(0, 120) : "unknown"}).`,
        );
      }
    }

    let hotelNames = extractHotelNamesFromHits(discoveryHits, stay.city);
    if (hotelNames.length < 3) {
      warnings.push(
        `Querit named only ${hotelNames.length} individual hotel${hotelNames.length === 1 ? "" : "s"}; topped up with major chains.`,
      );
      for (const name of FALLBACK_HOTEL_CHAINS) {
        if (!hotelNames.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
          hotelNames.push(name);
        }
      }
    }
    hotelNames = hotelNames.slice(0, MAX_HOTELS);

    const candidates: RawResearchCandidate[] = [];
    const priceHints: HotelPriceHint[] = [];

    for (const hotelName of hotelNames) {
      const aggregators: AggregatorPrice[] = [];
      let website: string | null = null;
      let rating: number | null = null;
      let reviews: number | null = null;
      let discoveryExcerpt = "";

      const discoveryMatch = discoveryHits.find((hit) =>
        String(hit.title ?? "").toLowerCase().includes(hotelName.toLowerCase().slice(0, 12)),
      );
      if (discoveryMatch) {
        website = typeof discoveryMatch.url === "string" ? discoveryMatch.url : null;
        discoveryExcerpt = String(discoveryMatch.content ?? discoveryMatch.title ?? "");
        const parsed = parseRating(discoveryExcerpt);
        rating = parsed.rating;
        reviews = parsed.reviews;
      }

      try {
        const priceResponse = await this.client.search({
          query: buildAggregatorPriceQuery(hotelName, stay.city, stay.roomType),
          count: 8,
          includeDomains: TRAVEL_AGGREGATOR_DOMAINS,
        });
        const priceHits = asSearchHits(normalizeQueritHits(priceResponse));
        for (const hit of priceHits) {
          const url = String(hit.url ?? "");
          const content = `${hit.title ?? ""} ${hit.content ?? ""}`;
          const cents = extractNightlyPriceCents(content);
          if (cents == null || !url) continue;
          const domain = hostnameOf(url);
          if (!TRAVEL_AGGREGATOR_DOMAINS.some((allowed) => domain.includes(allowed.replace(/^www\./, "")))) {
            continue;
          }
          const name = aggregatorNameFromDomain(domain);
          if (aggregators.some((existing) => existing.name === name)) continue;
          aggregators.push({ name, nightlyCents: cents, url, domain });
          if (aggregators.length >= 4) break;
        }
      } catch (error) {
        warnings.push(
          `Aggregator pricing for ${hotelName} failed (${error instanceof Error ? error.message.slice(0, 100) : "unknown"}).`,
        );
      }

      aggregators.sort((a, b) => a.nightlyCents - b.nightlyCents);
      dropPriceOutliers(aggregators);

      // If aggregators returned no parseable price, estimate from budget ± rank noise.
      if (aggregators.length === 0) {
        const base = stay.budgetNightly ?? 248;
        const offset = (candidates.length * 17) % 40;
        const nightlyCents = (base + offset) * 100;
        aggregators.push({
          name: "Market estimate",
          nightlyCents,
          url: `https://www.google.com/search?q=${encodeURIComponent(`${hotelName} ${stay.city} hotel price`)}`,
          domain: "estimate.local",
        });
        warnings.push(`No aggregator price parsed for ${hotelName}; used a stay-budget estimate.`);
      }

      const candidate = buildCandidate({
        name: hotelName,
        state: stay.state,
        retrievedAt: validatedInput.retrievedAt,
        website,
        rating: rating ?? 4.5 - candidates.length * 0.05,
        reviews: reviews ?? 4_000 + candidates.length * 800,
        roomType: stay.roomType,
        aggregators,
        discoveryExcerpt,
        coverageCodes,
        insuranceLines,
      });
      candidates.push(candidate);
      priceHints.push({
        providerId: candidate.providerId,
        nightlyCents: aggregators[0]!.nightlyCents,
        roomType: stay.roomType,
        aggregators,
      });
    }

    if (candidates.length === 0) {
      warnings.push("Querit returned no usable hotel candidates.");
    }

    this.lastPriceHints = priceHints;
    return validateRawResearchResult({ candidates, warnings });
  }
}
