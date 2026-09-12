import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
export const NEGOTIATION_SESSION_PATH = ".artifacts/person3/negotiation-session.json";
const COVERAGE_HARD_STOP = "Coverage must remain unchanged; do not accept reduced limits, increased deductibles, or removed benefits.";
const TARGET_BILLING_FREQUENCY = "policy_term";
const MAX_DISPLAY_NAME_LENGTH = 120;
const CONTROL_CHARACTERS = /\p{Cc}/u;
const ELIGIBLE_COMPETING_COVERAGE_STATUSES = new Set(["equivalent", "better_than_requested"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function jsonValuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => jsonValuesEqual(value, right[index]));
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && jsonValuesEqual(left[key], right[key]));
}

function haveSameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read valid JSON from ${path}: ${error.message}`, { cause: error });
  }
}

function optionValue(argv, name) {
  const indexes = argv.flatMap((value, index) => value === name ? [index] : []);
  assert(indexes.length <= 1, `${name} may only be provided once`);
  const [index] = indexes;
  if (index === undefined) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function positiveCents(argv, name) {
  const value = optionValue(argv, name);
  if (value === undefined) return undefined;
  const cents = Number(value);
  assert(Number.isSafeInteger(cents) && cents > 0, `${name} must be positive integer cents`);
  return cents;
}

export function parsePreparationArgs(argv) {
  const artifactDirectory = optionValue(argv, "--artifact-dir");
  const confirmation = optionValue(argv, "--confirm-selection");
  const profilePath = optionValue(argv, "--profile");
  const userName = optionValue(argv, "--user-name");
  const targetAmountCents = positiveCents(argv, "--target-cents");
  const targetRangeMinCents = positiveCents(argv, "--target-min-cents");
  const targetRangeMaxCents = positiveCents(argv, "--target-max-cents");

  assert(artifactDirectory, "--artifact-dir is required");
  assert(confirmation, "--confirm-selection requires the exact providerId:quoteId value");
  const hasTarget = targetAmountCents !== undefined;
  const hasRange = targetRangeMinCents !== undefined || targetRangeMaxCents !== undefined;
  assert(hasTarget !== hasRange, "Provide either --target-cents or both target range options");
  assert(!hasRange || (targetRangeMinCents !== undefined && targetRangeMaxCents !== undefined), "Both target range options are required");
  assert(!hasRange || targetRangeMinCents <= targetRangeMaxCents, "Target range minimum cannot exceed maximum");
  assert(Boolean(profilePath) !== Boolean(userName), "Provide exactly one identity source: --profile <path> or --user-name <name>");

  return {
    artifactDirectory,
    confirmation,
    profilePath: profilePath ?? null,
    userName: userName ?? null,
    targetAmountCents: targetAmountCents ?? null,
    targetRangeMinCents: targetRangeMinCents ?? null,
    targetRangeMaxCents: targetRangeMaxCents ?? null,
  };
}

export function validateDisplayName(value) {
  assert(typeof value === "string", "User display name must be a string");
  const displayName = value.trim();
  assert(displayName.length >= 1 && displayName.length <= MAX_DISPLAY_NAME_LENGTH, "User display name must be between 1 and 120 characters after trimming");
  assert(!CONTROL_CHARACTERS.test(displayName), "User display name must not contain control characters or newlines");
  return displayName;
}

export async function loadParticipant(options, root = process.cwd()) {
  if (options.profilePath) {
    const profile = await readJson(resolve(root, options.profilePath));
    return { displayName: validateDisplayName(profile?.userContext?.displayName) };
  }
  return { displayName: validateDisplayName(options.userName) };
}

export async function loadPreparedContext(directory, confirmation) {
  const [handoff, normalized] = await Promise.all([
    readJson(resolve(directory, "person3-handoff.json")),
    readJson(resolve(directory, "normalized-quotes.json")),
  ]);
  const target = handoff?.target;
  assert(target?.providerId && target?.quoteId, "Person 4 handoff has no negotiation target");
  assert(handoff?.workflowId && handoff?.specificationHash, "Person 4 handoff is missing workflow identity");
  assert(confirmation === `${target.providerId}:${target.quoteId}`, "Selection confirmation does not exactly match the handoff provider and quote");

  const quote = normalized?.quotes?.find((candidate) => candidate.quoteId === target.quoteId);
  assert(quote, "Handoff quote is absent from normalized quotes");
  assert(quote.providerId === target.providerId, "Provider mismatch between handoff and normalized quote");
  assert(quote.workflowId === handoff.workflowId, "Workflow mismatch between handoff and normalized quote");
  assert(quote.specificationHash === handoff.specificationHash, "Specification hash mismatch between handoff and normalized quote");
  const competing = handoff.verifiedCompetingQuote;
  if (competing !== null && competing !== undefined) {
    assert(competing.quoteId !== target.quoteId, "Selected quote cannot be its own competing quote");
    const competingQuote = normalized.quotes.find((candidate) => candidate.quoteId === competing.quoteId);
    assert(competingQuote, "Verified competing quote is absent from normalized quotes");
    assert(competingQuote.providerId === competing.providerId, "Verified competing provider does not match normalized quotes");
    assert(competingQuote.workflowId === handoff.workflowId, "Verified competing quote belongs to another workflow");
    assert(competingQuote.specificationHash === handoff.specificationHash, "Verified competing quote uses another specification");
    assert(
      ELIGIBLE_COMPETING_COVERAGE_STATUSES.has(competingQuote.coverageEquivalence?.status),
      "Verified competing quote must have equivalent-or-better coverage",
    );
    assert(
      competing.effectiveComparisonCostCents === competingQuote.effectiveComparisonCostCents,
      "Verified competing quote cost does not match normalized quotes",
    );
    assert(
      jsonValuesEqual(competing.coverageEquivalence, competingQuote.coverageEquivalence),
      "Verified competing quote coverage equivalence does not match normalized quotes",
    );
    assert(
      haveSameStringSet(competing.evidenceIds, competingQuote.evidenceIds),
      "Verified competing quote evidence IDs do not match normalized quotes",
    );
  }

  return { handoff, quote };
}

export function buildNegotiationSession({ handoff, quote }, options, now = new Date().toISOString()) {
  assert(Number.isFinite(Date.parse(now)), "Selection timestamp must be a valid ISO date-time");
  const participant = { displayName: validateDisplayName(options.participant?.displayName) };
  const goal = {
    id: `goal-${handoff.workflowId}-${quote.quoteId}`,
    workflowId: handoff.workflowId,
    selectedQuoteId: quote.quoteId,
    targetProviderId: quote.providerId,
    targetAmountCents: options.targetAmountCents,
    targetRangeMinCents: options.targetRangeMinCents,
    targetRangeMaxCents: options.targetRangeMaxCents,
    billingFrequency: TARGET_BILLING_FREQUENCY,
    desiredNonPriceImprovements: [],
    allowedTradeoffs: [],
    hardStops: [COVERAGE_HARD_STOP],
    verifiedCompetingQuoteId: handoff.verifiedCompetingQuote?.quoteId ?? null,
    disclosurePolicy: "do_not_reveal_ceiling",
    confirmedAt: now,
  };
  const explicitSelection = {
    quoteId: quote.quoteId,
    providerId: quote.providerId,
    specificationHash: handoff.specificationHash,
    selectedAt: now,
  };
  return { participant, handoff, goal, explicitSelection };
}

export function buildSafeBrowserReference(session) {
  return {
    workflowId: session.handoff.workflowId,
    providerId: session.explicitSelection.providerId,
    quoteId: session.explicitSelection.quoteId,
    specificationHash: session.explicitSelection.specificationHash,
    selectedAt: session.explicitSelection.selectedAt,
  };
}

export async function writePrivateSession(root, session) {
  const output = resolve(root, NEGOTIATION_SESSION_PATH);
  const directory = resolve(output, "..");
  const temporary = `${output}.${process.pid}.tmp`;
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await chmod(directory, PRIVATE_DIRECTORY_MODE);
  await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
  await chmod(temporary, PRIVATE_FILE_MODE);
  await rename(temporary, output);
  await chmod(output, PRIVATE_FILE_MODE);
  return output;
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parsePreparationArgs(argv);
  const root = dependencies.root ?? process.cwd();
  const [context, participant] = await Promise.all([
    loadPreparedContext(resolve(root, options.artifactDirectory), options.confirmation),
    loadParticipant(options, root),
  ]);
  const session = buildNegotiationSession(context, { ...options, participant }, dependencies.now?.() ?? new Date().toISOString());
  const output = await writePrivateSession(root, session);
  const reference = buildSafeBrowserReference(session);
  (dependencies.log ?? console.log)(JSON.stringify(reference));
  return { output, reference };
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) main().catch((error) => { console.error(`Negotiation preparation failed: ${error.message}`); process.exitCode = 1; });
