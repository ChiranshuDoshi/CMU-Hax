import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_LIVE_TURNS = 6;
const MAX_LIVE_DURATION_SECONDS = 60;
const MOCK_CONCESSION_RATE = 0.01;
const MOCK_MIN_DISCOUNT_CENTS = 100;
const MOCK_MAX_DISCOUNT_CENTS = 2_500;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }
function assert(condition, message) { if (!condition) throw new Error(message); }

export function parseNegotiationArgs(argv) {
  const value = (name) => {
    const index = argv.indexOf(name);
    if (index < 0) return undefined;
    if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`${name} requires a value`);
    return argv[index + 1];
  };
  const integer = (name) => {
    const raw = value(name);
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be positive integer cents`);
    return parsed;
  };
  const turns = integer("--max-turns") ?? 4;
  const durationSeconds = integer("--max-duration-seconds") ?? 45;
  assert(turns <= MAX_LIVE_TURNS, `--max-turns cannot exceed ${MAX_LIVE_TURNS}`);
  assert(durationSeconds <= MAX_LIVE_DURATION_SECONDS, `--max-duration-seconds cannot exceed ${MAX_LIVE_DURATION_SECONDS}`);
  const targetCents = integer("--target-cents");
  const rangeMinCents = integer("--target-min-cents");
  const rangeMaxCents = integer("--target-max-cents");
  assert(targetCents !== undefined || (rangeMinCents !== undefined && rangeMaxCents !== undefined), "Provide --target-cents or both target range options");
  assert(!(targetCents !== undefined && rangeMinCents !== undefined), "Use a target or a range, not both");
  assert(rangeMinCents === undefined || rangeMinCents <= rangeMaxCents, "Target range minimum cannot exceed maximum");
  const artifactDirectory = value("--artifact-dir");
  assert(artifactDirectory, "--artifact-dir is required");
  return { artifactDirectory, confirmation: value("--confirm-selection"), live: argv.includes("--live"), targetCents, rangeMinCents, rangeMaxCents, turns, durationSeconds };
}

export async function loadAndValidatePerson4Artifacts(directory, confirmation) {
  assert(directory, "--artifact-dir is required");
  assert(confirmation, "--confirm-selection requires the exact providerId:quoteId value; selection is never automatic");
  const [research, normalized, handoff, rawQuotes] = await Promise.all([
    readJson(resolve(directory, "research.json")), readJson(resolve(directory, "normalized-quotes.json")),
    readJson(resolve(directory, "person3-handoff.json")), readJson(resolve(directory, "raw-quotes.json")),
  ]);
  const target = handoff?.target;
  assert(target?.providerId && target?.quoteId, "Person 4 handoff has no target");
  assert(confirmation === `${target.providerId}:${target.quoteId}`, `Selection confirmation mismatch. Re-run with --confirm-selection ${target.providerId}:${target.quoteId}`);
  const quote = normalized?.quotes?.find((item) => item.quoteId === target.quoteId);
  assert(quote, "Handoff quote is absent from normalized quotes");
  assert(quote.providerId === target.providerId, "Provider mismatch between handoff and normalized quote");
  assert(quote.workflowId === handoff.workflowId && quote.specificationHash === handoff.specificationHash, "Workflow/specification hash mismatch between handoff and normalized quote");
  const selectedProvider = research?.ranking?.selected?.find((item) => item.providerId === target.providerId);
  assert(selectedProvider, "Target provider is absent from the Person 4 selected provider set");
  assert(!target.providerName || target.providerName === selectedProvider.providerName, "Provider name mismatch between handoff and research artifacts");
  const evidence = rawQuotes?.quotes?.flatMap((item) => item.evidence ?? []) ?? [];
  const evidenceIds = new Set(evidence.map((item) => item.id));
  assert((quote.evidenceIds ?? []).every((id) => evidenceIds.has(id)), "Normalized quote references evidence absent from Person 4 artifacts");
  return { handoff, target, quote, selectedProvider, evidence };
}

export function buildMockResult(context, options, now = "2026-01-01T00:00:00.000Z") {
  const { target, quote, selectedProvider } = context;
  const conversationId = `mock-person3-${quote.workflowId}-${quote.quoteId}`;
  const evidenceId = `evidence-${conversationId}`;
  const currentCost = quote.effectiveComparisonCostCents;
  assert(Number.isSafeInteger(currentCost) && currentCost > 0, "Selected quote has no positive effective comparison cost");
  assert(currentCost > 1, "Selected quote cost is too small for a measurable mock concession");
  const discountCents = Math.min(
    currentCost - 1,
    MOCK_MAX_DISCOUNT_CENTS,
    Math.max(MOCK_MIN_DISCOUNT_CENTS, Math.round(currentCost * MOCK_CONCESSION_RATE)),
  );
  const finalCostCents = currentCost - discountCents;
  const termMonths = quote.policyTermMonths;
  const derivedMonthlyCents = Number.isSafeInteger(termMonths) && termMonths > 0
    ? Math.round(finalCostCents / termMonths)
    : null;
  const request = "Keep identical coverage and ask what options could improve the quoted cost. Do not disclose the private target.";
  const response = `Fixture-only simulated response proposes a ${discountCents}-cent policy-period demo discount, a final policy-period effective cost of ${finalCostCents} cents${derivedMonthlyCents === null ? "" : ` and derived monthly effective cost of ${derivedMonthlyCents} cents`}. This is not provider confirmation. Coverage is unchanged, no fees were added, and this remains simulated, non-binding, non-ingestible, and subject to human verification.`;
  const transcript = [
    { role: "agent", message: `I would like to keep the same coverage with ${selectedProvider.providerName}. ${request}` },
    { role: "provider", message: response },
    { role: "agent", message: `To summarize: the measurable discount is ${discountCents} cents, final policy-period effective cost is ${finalCostCents} cents, coverage is unchanged, and no fees were added.` },
  ];
  const fixtureEvidence = {
    id: evidenceId, workflowId: quote.workflowId, type: "transcript", sourceId: conversationId,
    claimKey: "final policy-period cost", claimValue: { amountCents: finalCostCents, currency: quote.currency ?? "USD" },
    pageNumber: null, transcriptStartMs: 0, transcriptEndMs: 1_000, speaker: "simulated_provider_fixture", excerpt: response,
    url: null, retrievedAt: now, confidence: 0, verificationStatus: "not_applicable",
  };
  const nonIngestibleCandidate = {
    id: `event-${conversationId}`, workflowId: quote.workflowId, negotiationGoalId: `goal-${quote.quoteId}`,
    targetProviderId: quote.providerId, negotiationConversationId: conversationId, originalQuoteId: quote.quoteId,
    competingQuoteId: null, specificationHash: quote.specificationHash, verifiedLeverageStatement: null,
    requestedImprovement: request, providerResponse: response, originalCostCents: currentCost, finalCostCents,
    changedCoverage: [], changedFees: [], changedDiscounts: [{
      name: "Person 3 deterministic demo discount", amountCents: discountCents, amountType: "fixed",
      applied: true, conditional: false, eligibilityConfirmed: true, continuingEligibilityRequired: false,
      conditions: ["Simulated non-binding demo concession; requires human verification"], evidenceId,
    }], evidenceIds: [evidenceId], verificationStatus: "not_applicable",
  };
  return {
    mode: "mock_fixture", simulated: true, fixtureOnly: true, ingestible: false,
    warning: "Fixture-only proposal. Not provider-confirmed and must never be ingested as a NegotiationEvent.",
    selection: { providerId: target.providerId, quoteId: target.quoteId },
    privateGoalProvided: options.targetCents !== undefined || options.rangeMinCents !== undefined,
    transcript, evidence: [fixtureEvidence], event: null, nonIngestibleCandidate,
  };
}

export async function runLiveSimulation(client, agentId, context, options) {
  const prompt = `Act as ${context.selectedProvider.providerName} in a simulated demo. Coverage must remain unchanged. Do not invent a concession; state no-change unless you can explicitly confirm exact monthly and policy-period price, concession, fees, and unchanged coverage.`;
  const termMonths = context.quote.policyTermMonths;
  const derivedMonthlyCents = Number.isSafeInteger(termMonths) && termMonths > 0
    ? Math.round(context.quote.effectiveComparisonCostCents / termMonths)
    : "not supplied";
  const coverageSummary = (context.quote.coverageItems ?? []).map((item) =>
    Object.fromEntries(Object.entries(item).filter(([key]) => key !== "insuredEntityIds")),
  );
  const response = await client.conversationalAi.agents.simulateConversation(agentId, {
    simulationSpecification: {
      simulatedUserConfig: { firstMessage: prompt, language: "en", prompt: { prompt } },
      dynamicVariables: {
        user_display_name: "the policyholder",
        selected_provider_name: context.target.providerName ?? context.selectedProvider.providerName,
        selected_quote_id: context.target.quoteId,
        workflow_id: context.handoff?.workflowId ?? context.quote.workflowId,
        derived_monthly_effective_cost: typeof derivedMonthlyCents === "number" ? `${derivedMonthlyCents} cents (derived equivalent)` : derivedMonthlyCents,
        policy_period_effective_cost: context.quote.effectiveComparisonCostCents,
        verified_comparable_monthly_effective_cost: "not available",
        allowed_leverage_text: "No verified competing quote; do not imply one exists.",
        coverage_summary: JSON.stringify(coverageSummary),
      },
    },
    newTurnsLimit: options.turns,
  }, { timeoutInSeconds: options.durationSeconds });
  return { mode: "live", simulated: true, status: "requires_human_review", selection: { providerId: context.target.providerId, quoteId: context.target.quoteId }, transcript: response.simulatedConversation, analysis: response.analysis, event: null, limitation: "The SDK simulation was exercised, but no provider-confirmed structured event is inferred from free-form transcript text." };
}

function loadEnv(root) { for (const file of [".env.local", ".env"]) if (existsSync(resolve(root, file))) process.loadEnvFile(resolve(root, file)); }

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseNegotiationArgs(argv);
  const root = dependencies.root ?? process.cwd();
  const context = await loadAndValidatePerson4Artifacts(resolve(root, options.artifactDirectory), options.confirmation);
  let result;
  if (options.live) {
    loadEnv(process.cwd());
    assert(process.env.ELEVENLABS_API_KEY?.trim(), "ELEVENLABS_API_KEY is missing");
    assert(process.env.ELEVENLABS_NEGOTIATOR_AGENT_ID?.trim(), "ELEVENLABS_NEGOTIATOR_AGENT_ID is missing; run setup with --apply");
    const client = dependencies.client ?? new (await import("@elevenlabs/elevenlabs-js")).ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
    result = await runLiveSimulation(client, process.env.ELEVENLABS_NEGOTIATOR_AGENT_ID, context, options);
  } else result = buildMockResult(context, options);
  const outputDirectory = resolve(root, ".artifacts/person3");
  await mkdir(outputDirectory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await chmod(outputDirectory, PRIVATE_DIRECTORY_MODE);
  const output = resolve(outputDirectory, options.live ? "negotiation-live.json" : "negotiation-mock.json");
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
  await chmod(output, PRIVATE_FILE_MODE);
  console.log(`${options.live ? "Live bounded simulation" : "Deterministic mock"} complete: ${output}`);
  return { result, output };
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) main().catch((error) => { console.error(`Negotiation verification failed: ${error.message}`); process.exitCode = 1; });
