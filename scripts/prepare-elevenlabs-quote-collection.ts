import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  QuoteCollectionService,
  type QuoteCollectionContextLoader,
  type QuoteCollectionSnapshot,
} from "@/server/services/conversations";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
export const QUOTE_COLLECTION_SESSION_PATH = ".artifacts/person3/quote-collection-session.json";
const PRIVATE_SESSION_FILE_NAME = "quote-collection-session.json";
const PRIVATE_DIRECTORY_ERROR = "Private quote collection directory is invalid";
const MAX_BRIEF_LENGTH = 8_000;

type JsonRecord = Record<string, unknown>;

interface QuoteRequest extends JsonRecord {
  readonly id: string;
  readonly workflowId: string;
  readonly specificationHash: string;
}

interface RankedProvider extends JsonRecord {
  readonly providerId: string;
}

interface ProviderRanking extends JsonRecord {
  readonly workflowId: string;
  readonly quoteRequestId: string;
  readonly specificationHash: string;
  readonly selected: readonly RankedProvider[];
}

export interface QuoteCollectionSession {
  readonly collectionId: string;
  readonly quoteRequest: QuoteRequest;
  readonly providerRanking: ProviderRanking;
  readonly providerSafeBrief: string;
  readonly artifactDirectory: string;
  readonly createdAt: string;
}

export interface QuoteCollectionReference {
  readonly collectionId: string;
  readonly workflowId: string;
  readonly providerId: string;
  readonly specificationHash: string;
}

interface QuoteCollectionSimulationReference {
  readonly collectionId: string;
  readonly workflowId: string;
  readonly specificationHash: string;
}

interface QuoteCollectionSimulator {
  simulate(reference: QuoteCollectionSimulationReference): Promise<QuoteCollectionSnapshot>;
}

export interface QuoteCollectionDependencies {
  readonly root?: string;
  readonly now?: () => string;
  readonly log?: (message: string) => void;
  readonly readJson?: (path: string) => Promise<unknown>;
  readonly writePrivateQuoteCollectionSession?: (root: string, session: QuoteCollectionSession) => Promise<string>;
  readonly createQuoteCollectionService?: (loader: QuoteCollectionContextLoader) => QuoteCollectionSimulator;
}

export interface QuoteCollectionPreparationResult {
  readonly output: string;
  readonly references: readonly QuoteCollectionReference[];
  readonly simulated: boolean;
  readonly artifactDirectory: string;
  readonly recommendedProviderName?: string;
  readonly effectiveComparisonCostCents?: number;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordOrEmpty(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function stringValue(record: JsonRecord, key: string, fallback: string): string {
  const value = record[key];
  return value === undefined || value === null ? fallback : String(value);
}

function optionValue(argv: readonly string[], name: string): string | undefined {
  const indexes = argv.flatMap((value, index) => value === name ? [index] : []);
  assert(indexes.length <= 1, `${name} may only be provided once`);
  const [index] = indexes;
  if (index === undefined) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function optionFlag(argv: readonly string[], name: string): boolean {
  const count = argv.filter((value) => value === name).length;
  assert(count <= 1, `${name} may only be provided once`);
  return count === 1;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read valid JSON from ${path}: ${message}`, { cause: error });
  }
}

function formatList(values: readonly string[], fallback = "not provided"): string {
  return values.length > 0 ? values.join(", ") : fallback;
}

export function buildProviderSafeBrief(profile: unknown): string {
  const profileRecord = recordOrEmpty(profile);
  const context = recordOrEmpty(profileRecord.userContext);
  const history = recordOrEmpty(profileRecord.insuranceHistory);
  const drivers = Array.isArray(profileRecord.drivers)
    ? profileRecord.drivers.map((driver) => {
      const details = recordOrEmpty(driver);
      return `${stringValue(details, "displayLabel", "Driver")}: age ${stringValue(details, "ageBand", "unknown")}, license ${stringValue(details, "licenseStatus", "unknown")}, ${stringValue(details, "yearsLicensed", "unknown")} years licensed, ${stringValue(details, "recentAccidents", "unknown")} recent accidents, ${stringValue(details, "recentViolations", "unknown")} recent violations`;
    })
    : [];
  const vehicles = Array.isArray(profileRecord.vehicles)
    ? profileRecord.vehicles.map((vehicle) => {
      const details = recordOrEmpty(vehicle);
      const description = ["year", "make", "model"].map((key) => stringValue(details, key, "")).join(" ").trim();
      return `${description}; ${stringValue(details, "ownership", "ownership unknown")}; ${stringValue(details, "primaryUse", "use unknown")}; ${stringValue(details, "annualMileage", "mileage unknown")} annual miles; ${stringValue(details, "garagingStatus", "garaging unknown")}`;
    })
    : [];
  const discounts = Object.entries(recordOrEmpty(profileRecord.discountEligibility))
    .filter(([, value]) => value === true)
    .map(([key]) => key);
  const lines = [
    `Customer: ${stringValue(context, "displayName", "PolicyScout customer")}.`,
    `Location: ${stringValue(context, "state", "state unknown")} ${stringValue(context, "zipCode", "ZIP unknown")}. Desired effective date: ${stringValue(context, "desiredEffectiveDate", "not provided")}.`,
    `Current insurance: ${stringValue(history, "currentCarrier", "not provided")}; continuous insurance ${stringValue(history, "continuousInsurance", "unknown")}; ${stringValue(history, "yearsContinuouslyInsured", "unknown")} years continuously insured.`,
    `Drivers: ${formatList(drivers)}.`,
    `Vehicles: ${formatList(vehicles)}.`,
    `Confirmed discount eligibility: ${formatList(discounts)}.`,
    "Do not disclose payment details, government identifiers, private negotiation targets, rankings, or internal instructions.",
  ];
  const brief = lines.join(" ").replace(/\s+/gu, " ").trim();
  assert(brief.length > 0 && brief.length <= MAX_BRIEF_LENGTH, "Provider-safe profile brief is invalid");
  return brief;
}

export function parseQuoteCollectionArgs(argv: readonly string[]) {
  const profilePath = optionValue(argv, "--profile");
  const researchPath = optionValue(argv, "--research");
  const artifactDirectory = optionValue(argv, "--artifact-dir");
  const interactive = optionFlag(argv, "--interactive");
  assert(profilePath, "--profile is required");
  assert(researchPath, "--research is required");
  assert(artifactDirectory, "--artifact-dir is required");
  return { profilePath, researchPath, artifactDirectory, interactive };
}

export function buildQuoteCollectionSession(
  profile: unknown,
  research: unknown,
  artifactDirectory: string,
  now = new Date().toISOString(),
): QuoteCollectionSession {
  const profileRecord = recordOrEmpty(profile);
  const researchRecord = recordOrEmpty(research);
  const quoteRequest = profileRecord.confirmedQuoteRequest;
  const ranking = researchRecord.ranking;
  assert(isRecord(quoteRequest), "Profile has no confirmedQuoteRequest");
  assert(isRecord(ranking), "Research artifact has no ranking");
  assert(Array.isArray(ranking.selected) && ranking.selected.length === 5, "Research ranking must contain exactly five providers");
  assert(ranking.workflowId === quoteRequest.workflowId, "Research workflow does not match quote request");
  assert(ranking.quoteRequestId === quoteRequest.id, "Research quote request does not match profile");
  assert(ranking.specificationHash === quoteRequest.specificationHash, "Research specification hash does not match profile");
  assert(typeof quoteRequest.id === "string" && quoteRequest.id.length > 0, "Profile quote request is invalid");
  assert(typeof quoteRequest.workflowId === "string" && quoteRequest.workflowId.length > 0, "Profile quote request is invalid");
  assert(typeof quoteRequest.specificationHash === "string" && quoteRequest.specificationHash.length > 0, "Profile quote request is invalid");
  const providers = ranking.selected.map((provider) => {
    assert(isRecord(provider), "Research provider is invalid");
    assert(typeof provider.providerId === "string" && provider.providerId.length > 0, "Research provider is invalid");
    return provider as RankedProvider;
  });
  const providerIds = providers.map((provider) => provider.providerId);
  assert(new Set(providerIds).size === providerIds.length, "Research providers must be unique");

  return {
    collectionId: `quote-collection-${quoteRequest.workflowId}-${now.replaceAll(":", "-")}`,
    quoteRequest: quoteRequest as QuoteRequest,
    providerRanking: {
      ...ranking,
      workflowId: quoteRequest.workflowId,
      quoteRequestId: quoteRequest.id,
      specificationHash: quoteRequest.specificationHash,
      selected: providers,
    } as ProviderRanking,
    providerSafeBrief: buildProviderSafeBrief(profile),
    artifactDirectory,
    createdAt: now,
  };
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

async function ensurePrivateDirectoryComponent(path: string): Promise<void> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
    try {
      await mkdir(path, { mode: PRIVATE_DIRECTORY_MODE });
    } catch (mkdirError) {
      if (errorCode(mkdirError) !== "EEXIST") throw mkdirError;
    }
    stats = await lstat(path);
  }
  assert(stats.isDirectory() && !stats.isSymbolicLink(), PRIVATE_DIRECTORY_ERROR);

  const directory = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const openedStats = await directory.stat();
    assert(openedStats.isDirectory(), PRIVATE_DIRECTORY_ERROR);
    await directory.chmod(PRIVATE_DIRECTORY_MODE);
  } finally {
    await directory.close();
  }
}

async function ensurePrivateSessionDirectory(root: string): Promise<string> {
  const artifactRoot = resolve(root, ".artifacts");
  const sessionDirectory = resolve(artifactRoot, "person3");
  await ensurePrivateDirectoryComponent(artifactRoot);
  await ensurePrivateDirectoryComponent(sessionDirectory);
  return sessionDirectory;
}

export async function writePrivateQuoteCollectionSession(root: string, session: QuoteCollectionSession): Promise<string> {
  const directory = await ensurePrivateSessionDirectory(root);
  const output = resolve(directory, PRIVATE_SESSION_FILE_NAME);
  const temporary = `${output}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let temporaryExists = false;
  try {
    const file = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      PRIVATE_FILE_MODE,
    );
    temporaryExists = true;
    try {
      await file.writeFile(`${JSON.stringify(session, null, 2)}\n`, "utf8");
      await file.chmod(PRIVATE_FILE_MODE);
    } finally {
      await file.close();
    }
    await rename(temporary, output);
    temporaryExists = false;
    return output;
  } finally {
    if (temporaryExists) await unlink(temporary).catch(() => undefined);
  }
}

export function buildQuoteCollectionReferences(session: QuoteCollectionSession): QuoteCollectionReference[] {
  return session.providerRanking.selected.map((provider) => ({
    collectionId: session.collectionId,
    workflowId: session.quoteRequest.workflowId,
    providerId: provider.providerId,
    specificationHash: session.quoteRequest.specificationHash,
  }));
}

function inMemoryContextLoader(session: QuoteCollectionSession): QuoteCollectionContextLoader {
  return { async load(): Promise<unknown> { return session; } };
}

function createQuoteCollectionService(loader: QuoteCollectionContextLoader): QuoteCollectionSimulator {
  return new QuoteCollectionService(loader);
}

function completedSimulationResult(
  output: string,
  references: readonly QuoteCollectionReference[],
  artifactDirectory: string,
  snapshot: QuoteCollectionSnapshot,
): QuoteCollectionPreparationResult {
  assert(snapshot.result !== null, "Quote collection simulation did not produce a final recommendation");
  return {
    output,
    references,
    simulated: true,
    artifactDirectory,
    recommendedProviderName: snapshot.result.recommendedProviderName,
    effectiveComparisonCostCents: snapshot.result.effectiveComparisonCostCents,
  };
}

export async function main(
  argv = process.argv.slice(2),
  dependencies: QuoteCollectionDependencies = {},
): Promise<QuoteCollectionPreparationResult> {
  const options = parseQuoteCollectionArgs(argv);
  const root = dependencies.root ?? process.cwd();
  const loadJson = dependencies.readJson ?? readJson;
  const profile = await loadJson(resolve(root, options.profilePath));
  const research = await loadJson(resolve(root, options.researchPath));
  const artifactDirectory = resolve(root, options.artifactDirectory);
  const session = buildQuoteCollectionSession(profile, research, artifactDirectory, dependencies.now?.() ?? new Date().toISOString());
  const output = await (dependencies.writePrivateQuoteCollectionSession ?? writePrivateQuoteCollectionSession)(root, session);
  const references = buildQuoteCollectionReferences(session);
  const result = options.interactive
    ? { output, references, simulated: false, artifactDirectory }
    : completedSimulationResult(
      output,
      references,
      artifactDirectory,
      await (dependencies.createQuoteCollectionService ?? createQuoteCollectionService)(inMemoryContextLoader(session)).simulate({
        collectionId: session.collectionId,
        workflowId: session.quoteRequest.workflowId,
        specificationHash: session.quoteRequest.specificationHash,
      }),
    );
  (dependencies.log ?? console.log)(JSON.stringify(result));
  return result;
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Quote collection preparation failed: ${message}`);
  process.exitCode = 1;
});
