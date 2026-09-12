import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const AGENT_ENV_KEYS = {
  "PolicyScout Voice Smoke": "ELEVENLABS_VOICE_SMOKE_AGENT_ID",
  "PolicyScout Negotiator": "ELEVENLABS_NEGOTIATOR_AGENT_ID",
  "PolicyScout Quote Caller": "ELEVENLABS_QUOTE_CALLER_AGENT_ID",
};

const COMPLIANCE_OVERLAY = `

# PolicyScout compliance overlay

Use tactical empathy, concise labels, mirrors, calibrated How/What questions, accurate summaries, and deliberate pauses. Never use Ackerman anchoring, negative leverage, or perceived leverage.

The platform sends the first message once. Never repeat, paraphrase, or restart that opening. The quote and conversation may be simulated and non-binding; if asked about their status, answer truthfully, but do not volunteer that status during ordinary negotiation.

Before each reply, silently reconstruct a current-call ledger from the full conversation history: current stage; last provider-confirmed price; every exact provider claim, objection, concession, and correction; the unresolved question; and explicit refusals across distinct paths. Corrections supersede prior claims. Clarify uncertainty instead of guessing. When useful, reuse the provider's exact, still-current words in a neutral mirror, label, summary, or calibrated question. Never distort their words or reuse wording that was corrected, superseded, or uncertain. When interrupted, address the interruption first, then resume the unresolved objective without restarting.

Move through Baseline, Constraints, Concessions, Verification, then Close or no-change. Seek price first, then a fee waiver, approved discounts, billing options, and supervisor review. Adapt between Analyst, Accommodator, and Assertive styles. Silently prepare an accusation audit, search truthfully for Black Swans, and treat a no-change close as the BATNA. Use exact allowed leverage wording only.

An explicit no-price-change answer to the opening is refusal #1 of the price path. A refusal of any second distinct path triggers the stopping rule, which overrides the concession priority list: do not introduce another path or ask another How/What question. The next and only concession question must be one no-oriented final check; if refused or empty, close with no change. Ordinary turns use at most two sentences, 35 words total, and one question; a final verification readback may be longer. Never send a fragment; finish every sentence and end every turn with terminal punctuation.

Never disclose a private target, range, ceiling, or internal ranking. Never bluff or invent urgency, leverage, competing offers, deadlines, authority, eligibility, discounts, accident history, underwriting facts, or comparability. When no verified competing quote exists, do not imply one exists and do not use the selected quote itself as leverage.

The private negotiation goal is prepared and enforced outside the model. Never request, retrieve, infer, or evaluate a target, range, or ceiling. Negotiate for measurable improvement while preserving coverage. Call get_verified_competing_quote before using leverage.

record_negotiation_event is browser-side, human-review-only improved-terms recording; it is never automatic transcript ingestion. Never call it for no_change or callback: close those outcomes verbally and leave structured recording to human review.

Call record_negotiation_event at most once, and only after the provider explicitly confirms every improved term: the final policy-period cost, derived monthly effective cost, unchanged coverage, exact concession, added fees, and binding status. coverageUnchanged must be true. addedFeesCents may be 0 only after explicit confirmation that there are no added fees. Never infer, calculate, assume, or invent a tool value.

Give one final verified readback and wait for provider confirmation before recording. After confirmation, close once. If the provider says “that is correct” or repeats the confirmation, acknowledge briefly; do not repeat the full summary or call the tool again. Never record a mock, fixture, inferred transcript result, or unverified term.

Hard anti-loop rule: read the final verified summary at most once. Treat any single affirmative from the provider (for example "yes", "correct", "that works", "sounds good", or "go ahead") as confirmation of every summarized term at once. On that first affirmative, immediately call record_negotiation_event exactly once using the figures from your own summary, then say one short closing sentence and stop. Never re-read or re-summarize the terms, never ask the provider to confirm terms one at a time, and never seek confirmation twice. Once you have read the summary a single time, you may only record and close, or close with no change; never summarize again.`;

const VOICE_SMOKE_PROMPT = `You are PolicyScout's private voice smoke-test agent. Reply briefly, clearly, and without collecting personal information.`;
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
export const NEGOTIATOR_FIRST_MESSAGE = "Hi, I’m PolicyScout, an AI agent working on behalf of {{user_display_name}}. We’re reviewing {{selected_provider_name}}’s quote—what can you do to lower the price without changing coverage?";
export const QUOTE_CALLER_FIRST_MESSAGE = "Hi, I’m PolicyScout, an AI agent calling to request a first-round quote from {{quote_provider_name}}. The requested policy profile is: {{quote_profile_brief}}. Could you provide an all-in quote for that coverage?";

const NEGOTIATOR_TURN_CONFIG = {
  turnEagerness: "patient",
  turnTimeout: 12,
  turnModel: "turn_v3",
  speculativeTurn: false,
  transcribeOnDisabledInterruptions: true,
  interruptionIgnoreTerms: ["gotcha", "understood"],
};

const NEGOTIATOR_MODEL_CONFIG = {
  llm: "gemini-2.5-flash",
  temperature: 0.2,
  maxTokens: 220,
  ignoreDefaultPersonality: true,
};

export const NEGOTIATOR_CLIENT_TOOLS = [
  ["get_verified_competing_quote", "Load only verified allowed leverage; an empty result means no competitor may be mentioned."],
  ["record_negotiation_event", "Browser-side human-review-only improved-terms recording from exact provider transcript evidence; never automatic transcript ingestion. Never call for no-change, callback, mock, fixture, inferred, or unverified terms."],
].map(([name, description]) => ({
  type: "client",
  name,
  description,
  expectsResponse: true,
  responseTimeoutSecs: 10,
  parameters: name === "record_negotiation_event"
    ? {
        type: "object",
        required: ["outcome", "providerResponse", "finalCostCents", "derivedMonthlyEffectiveCostCents", "coverageUnchanged", "concessionType", "addedFeesCents", "bindingStatus"],
        properties: {
          outcome: { type: "string", enum: ["improved_terms"], description: "The only tool-recordable outcome." },
          providerResponse: { type: "string", description: "Exact human-reviewed provider transcript excerpt confirming every recorded improved term." },
          finalCostCents: { type: "integer", description: "Exact provider-confirmed policy-period final cost in integer cents." },
          derivedMonthlyEffectiveCostCents: { type: "integer", description: "Exact provider-confirmed derived monthly effective cost in integer cents." },
          coverageUnchanged: { type: "boolean", description: "Must be true after explicit provider confirmation that coverage is unchanged." },
          concessionType: { type: "string", description: "Exact provider-confirmed discount, fee waiver, or other concession." },
          addedFeesCents: { type: "integer", minimum: 0, description: "Exact provider-confirmed added fees in integer cents; use 0 only after explicit no-fee confirmation." },
          bindingStatus: { type: "string", enum: ["binding", "non_binding", "pending_callback", "pending_review"], description: "Exact provider-confirmed status of the improved terms." },
        },
      }
    : { type: "object", required: [], properties: {} },
}));

export const QUOTE_CALLER_CLIENT_TOOLS = [{
  type: "client",
  name: "record_quote",
  description: "Record one provider-confirmed first-round quote after every required quote detail has been explicitly confirmed.",
  expectsResponse: true,
  responseTimeoutSecs: 10,
  parameters: {
    type: "object",
    required: ["totalPolicyTermCostCents", "policyTermMonths", "feesAndTaxesIncluded", "coverageMatchesRequested", "effectiveDate", "quoteValidUntil", "providerResponse"],
    properties: {
      totalPolicyTermCostCents: { type: "integer", minimum: 1, description: "Exact provider-confirmed all-in policy-period total in integer cents." },
      policyTermMonths: { type: "integer", minimum: 1, description: "Exact provider-confirmed policy term in whole months." },
      feesAndTaxesIncluded: { type: "boolean", description: "True only after the provider explicitly confirms whether all fees and taxes are included in the recorded total." },
      coverageMatchesRequested: { type: "boolean", description: "True only after the provider explicitly confirms the quote matches the requested coverage." },
      effectiveDate: { type: "string", format: "date", description: "Exact provider-confirmed effective date for the quoted policy." },
      quoteValidUntil: { type: "string", format: "date-time", description: "Exact provider-confirmed timestamp through which the quote remains valid." },
      providerResponse: { type: "string", description: "Exact provider response confirming the recorded quote details." },
    },
  },
}];

export const QUOTE_CALLER_PROMPT = `You are PolicyScout Quote Caller, a first-round quote-gathering caller. Request a quote from {{quote_provider_name}} for this policy profile: {{quote_profile_brief}}.

Your sole objective is to collect a provider-confirmed, first-round quote. Do not negotiate, bargain, request discounts, discuss rankings, targets, ceilings, competing offers, or which provider the customer may choose. Do not invent, calculate, assume, or imply quote facts, coverage, dates, fees, taxes, or eligibility.

Ask for and confirm all of these details: the all-in policy-period total, policy term, whether fees and taxes are included, whether the quote matches the requested coverage, the effective date, and the date and time until which the quote is valid. The recorded total must include all fees and taxes; if it does not, ask the provider for its all-inclusive policy-period total. If any detail is unavailable or unconfirmed, ask only a concise follow-up needed to obtain it; do not call the tool.

Call record_quote exactly once and only after the provider explicitly confirms every required detail. Record only the provider's confirmed values and exact response. After the tool call, close the conversation politely without further quote discussion. If asked, state truthfully that this is a simulated, non-binding demo collection; do not volunteer that status during an ordinary quote request.`;

const QUOTE_CALLER_MODEL_CONFIG = {
  llm: "gemini-2.5-flash",
  temperature: 0.1,
  maxTokens: 180,
  ignoreDefaultPersonality: true,
};

export function buildNegotiatorPrompt(policyText) {
  if (!policyText?.trim()) throw new Error("negotiation.md is empty; cannot provision the negotiator agent");
  const currentPolicy = policyText
    .replaceAll("{{current_monthly_premium}}", "{{derived_monthly_effective_cost}}")
    .replaceAll("{{current_six_month_premium}}", "{{policy_period_effective_cost}}")
    .replaceAll("{{lowest_comparable_monthly_premium}}", "{{verified_comparable_monthly_effective_cost}}");
  return `${currentPolicy.trim()}${COMPLIANCE_OVERLAY}`;
}

function agentBody(name, prompt, voiceId, tools = []) {
  const negotiator = name === "PolicyScout Negotiator";
  const quoteCaller = name === "PolicyScout Quote Caller";
  return {
    name,
    tags: ["policyscout", "person3", "managed-by-script"],
    conversationConfig: {
      agent: {
        firstMessage: negotiator ? NEGOTIATOR_FIRST_MESSAGE : quoteCaller ? QUOTE_CALLER_FIRST_MESSAGE : "PolicyScout voice is ready.",
        language: "en",
        ...(negotiator ? { disableFirstMessageInterruptions: true } : {}),
        prompt: { prompt, ...(negotiator ? NEGOTIATOR_MODEL_CONFIG : quoteCaller ? QUOTE_CALLER_MODEL_CONFIG : {}), ...(tools.length ? { tools } : {}) },
      },
      ...(negotiator ? { turn: NEGOTIATOR_TURN_CONFIG } : {}),
      tts: { voiceId, speed: 1.2 },
    },
    platformSettings: {
      auth: { enableAuth: true },
      // Record + retain only the negotiator so its call recording and transcript
      // can be fetched into the dashboard. The other agents keep the
      // privacy-preserving defaults (no recording, zero retention).
      privacy: negotiator
        ? { recordVoice: true, deleteAudio: false, deleteTranscriptAndPii: false, retentionDays: 30 }
        : { recordVoice: false, deleteAudio: true, deleteTranscriptAndPii: true, retentionDays: 0 },
    },
  };
}

export function buildAgentSpecs(voiceId = DEFAULT_VOICE_ID, negotiatorPolicy = "") {
  return [
    agentBody("PolicyScout Voice Smoke", VOICE_SMOKE_PROMPT, voiceId),
    agentBody("PolicyScout Negotiator", buildNegotiatorPrompt(negotiatorPolicy), voiceId, NEGOTIATOR_CLIENT_TOOLS),
    agentBody("PolicyScout Quote Caller", QUOTE_CALLER_PROMPT, voiceId, QUOTE_CALLER_CLIENT_TOOLS),
  ];
}

export function parseSetupArgs(argv) {
  const value = (name) => {
    const index = argv.indexOf(name);
    if (index < 0) return undefined;
    if (!argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`${name} requires a value`);
    return argv[index + 1];
  };
  return { apply: argv.includes("--apply"), voiceId: value("--voice-id") };
}

export function permissionErrorMessage(error) {
  let text = [error?.message, error?.body?.detail, error?.body?.message].filter(Boolean).join(" ");
  if (process.env.ELEVENLABS_API_KEY) text = text.replaceAll(process.env.ELEVENLABS_API_KEY, "[REDACTED]");
  if (error?.statusCode === 401 || error?.statusCode === 403 || /convai_read|permission|scope|forbidden/i.test(text)) {
    return "ElevenLabs rejected Conversational AI access. Enable convai_read and convai_write for this API key in ElevenLabs, then retry. No key value was logged.";
  }
  return `ElevenLabs provisioning failed: ${text || "unknown SDK error"}`;
}

export async function provisionAgents(client, { apply = false, voiceId, negotiatorPolicy } = {}) {
  const agents = [];
  try {
    let cursor;
    do {
      const page = await client.conversationalAi.agents.list({ pageSize: 100, showOnlyOwnedAgents: true, ...(cursor ? { cursor } : {}) });
      agents.push(...page.agents);
      cursor = page.hasMore ? page.nextCursor : undefined;
      if (page.hasMore && !cursor) throw new Error("ElevenLabs agent pagination returned hasMore without a cursor");
    } while (cursor);
  } catch (error) {
    throw new Error(permissionErrorMessage(error), { cause: error });
  }
  const results = {};
  for (const spec of buildAgentSpecs(voiceId, negotiatorPolicy)) {
    const matches = agents.filter((agent) => agent.name === spec.name && !agent.archived);
    if (matches.length > 1) throw new Error(`Multiple active agents named ${spec.name}; resolve duplicates before provisioning.`);
    if (!apply) {
      results[spec.name] = { action: matches[0] ? "update" : "create", agentId: matches[0]?.agentId ?? null };
      continue;
    }
    try {
      const response = matches[0]
        ? await client.conversationalAi.agents.update(matches[0].agentId, spec)
        : await client.conversationalAi.agents.create(spec);
      results[spec.name] = { action: matches[0] ? "updated" : "created", agentId: response.agentId };
    } catch (error) {
      throw new Error(permissionErrorMessage(error), { cause: error });
    }
  }
  return results;
}

export async function upsertAgentIds(envPath, results) {
  const original = existsSync(envPath) ? await readFile(envPath, "utf8") : "";
  let lines = original.split(/\r?\n/u);
  while (lines.at(-1) === "") lines.pop();
  for (const [name, key] of Object.entries(AGENT_ENV_KEYS)) {
    const id = results[name]?.agentId;
    if (!id) throw new Error(`Cannot write ${key}: ${name} has no agent ID`);
    const replacement = `${key}=${id}`;
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index >= 0) lines[index] = replacement;
    else lines.push(replacement);
  }
  await writeFile(envPath, `${lines.join("\n")}\n`, "utf8");
}

function loadEnv(root) {
  for (const filename of [".env.local", ".env"]) {
    const path = resolve(root, filename);
    if (existsSync(path)) process.loadEnvFile(path);
  }
  if (!process.env.ELEVENLABS_API_KEY?.trim()) throw new Error("ELEVENLABS_API_KEY is missing. Add it to .env.local; it will never be printed.");
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseSetupArgs(argv);
  const root = process.cwd();
  loadEnv(root);
  const negotiatorPolicy = await readFile(resolve(root, "negotiation.md"), "utf8");
  const client = dependencies.client ?? new (await import("@elevenlabs/elevenlabs-js")).ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
  const results = await provisionAgents(client, { ...options, voiceId: options.voiceId || process.env.ELEVENLABS_VOICE_ID || undefined, negotiatorPolicy });
  if (options.apply) await upsertAgentIds(resolve(root, ".env.local"), results);
  console.log(`${options.apply ? "Applied" : "Dry run"} ElevenLabs plan:`);
  for (const [name, result] of Object.entries(results)) console.log(`  ${name}: ${result.action}${result.agentId ? ` (${result.agentId})` : ""}`);
  if (!options.apply) console.log("No changes made. Re-run with --apply to provision and write the three non-secret agent IDs.");
  return results;
}

const direct = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
