import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { AGENT_ENV_KEYS, NEGOTIATOR_CLIENT_TOOLS, NEGOTIATOR_FIRST_MESSAGE, QUOTE_CALLER_CLIENT_TOOLS, QUOTE_CALLER_FIRST_MESSAGE, buildAgentSpecs, buildNegotiatorPrompt, permissionErrorMessage, provisionAgents, upsertAgentIds } from "../../../scripts/setup-elevenlabs-agents.mjs";

const POLICY = "# Current policy\nMonthly {{current_monthly_premium}} six month {{current_six_month_premium}} comparable {{lowest_comparable_monthly_premium}}.";

function client(agents = []) {
  return { conversationalAi: { agents: { list: vi.fn().mockResolvedValue({ agents, hasMore: false }), create: vi.fn(async (body) => ({ agentId: `new-${body.name}` })), update: vi.fn(async (id) => ({ agentId: id })) } } };
}

describe("ElevenLabs agent provisioning", () => {
  it("builds private agents with strict negotiation safety rules", () => {
    const specs = buildAgentSpecs("voice-1", POLICY);
    expect(specs.map((item) => item.name)).toEqual(Object.keys(AGENT_ENV_KEYS));
    expect(specs.every((item) => item.platformSettings.auth.enableAuth && item.platformSettings.privacy.recordVoice === false)).toBe(true);
    const prompt = specs[1].conversationConfig.agent.prompt.prompt;
    expect(prompt).toContain("# Current policy");
    expect(prompt).toMatch(/Never disclose a private target, range, ceiling/);
    expect(prompt).toMatch(/Never bluff/);
    expect(prompt).toContain("{{derived_monthly_effective_cost}}");
    expect(prompt).not.toContain("{{current_monthly_premium}}");
    expect(specs[1].conversationConfig.agent.prompt.tools.map((tool) => tool.name)).toEqual(NEGOTIATOR_CLIENT_TOOLS.map((tool) => tool.name));
    const recordEvent = NEGOTIATOR_CLIENT_TOOLS.find((tool) => tool.name === "record_negotiation_event");
    expect(NEGOTIATOR_CLIENT_TOOLS.map((tool) => tool.name)).not.toContain("get_negotiation_goal");
    expect(NEGOTIATOR_CLIENT_TOOLS.map((tool) => tool.name)).not.toContain("check_negotiation_goal");
    expect(recordEvent.description).toMatch(/human-review-only/);
    expect(recordEvent.description).toMatch(/never automatic transcript ingestion/i);
    expect(recordEvent.parameters.required).toEqual(["outcome", "providerResponse", "finalCostCents", "derivedMonthlyEffectiveCostCents", "coverageUnchanged", "concessionType", "addedFeesCents", "bindingStatus"]);
    expect(recordEvent.parameters.properties.outcome.enum).toEqual(["improved_terms"]);
    expect(recordEvent.parameters.properties.providerResponse.description).toMatch(/Exact human-reviewed provider transcript/);
    expect(recordEvent.parameters.properties.derivedMonthlyEffectiveCostCents.description).toMatch(/provider-confirmed derived monthly effective cost/);
    expect(recordEvent.parameters.properties.coverageUnchanged).toMatchObject({ type: "boolean" });
    expect(recordEvent.parameters.properties.coverageUnchanged.description).toMatch(/Must be true after explicit provider confirmation/);
    expect(recordEvent.parameters.properties.addedFeesCents).toMatchObject({ type: "integer", minimum: 0 });
    expect(recordEvent.parameters.properties.addedFeesCents.description).toMatch(/0 only after explicit no-fee confirmation/);
    expect(recordEvent.parameters.properties.bindingStatus.enum).toEqual(["binding", "non_binding", "pending_callback", "pending_review"]);
    expect(prompt).toMatch(/Never request, retrieve, infer, or evaluate a target/);
    expect(prompt).not.toMatch(/call check_negotiation_goal/i);
    expect(prompt).toMatch(/Never record a mock, fixture, inferred transcript result/);
    expect(prompt).toMatch(/Never call it for no_change or callback/);
    expect(prompt).toMatch(/close those outcomes verbally and leave structured recording to human review/);
    expect(prompt).toMatch(/only after the provider explicitly confirms every improved term/);
    expect(prompt).toMatch(/coverageUnchanged must be true/);
    expect(prompt).toMatch(/addedFeesCents may be 0 only after explicit confirmation that there are no added fees/);
    expect(prompt).toMatch(/Never infer, calculate, assume, or invent a tool value/);
    expect(prompt).toMatch(/If the provider says “that is correct” or repeats the confirmation, acknowledge briefly/);
    expect(prompt).toMatch(/do not repeat the full summary or call the tool again/);
    expect(specs[1].conversationConfig.agent.firstMessage).toBe("Hi, I’m PolicyScout, an AI agent working on behalf of {{user_display_name}}. We’re reviewing {{selected_provider_name}}’s quote—what can you do to lower the price without changing coverage?");
    expect(specs[1].conversationConfig.agent.firstMessage).toBe(NEGOTIATOR_FIRST_MESSAGE);
    expect(`${prompt}\n${specs[1].conversationConfig.agent.firstMessage}`).not.toMatch(/hackathon/i);
    expect(prompt).toMatch(/simulated and non-binding.*Do not volunteer that status/is);
    expect(prompt).toMatch(/Never repeat, paraphrase, or restart that opening/);
    expect(prompt).toMatch(/silently reconstruct a current-call ledger from the full conversation history/);
    expect(prompt).toMatch(/last provider-confirmed price/);
    expect(prompt).toMatch(/every exact provider claim, objection, concession, and correction/);
    expect(prompt).toMatch(/reuse the provider's exact, still-current words/);
    expect(prompt).toMatch(/Never distort their words or reuse wording that was corrected/);
    expect(prompt).toMatch(/When interrupted, address the interruption first/);
    expect(prompt).toMatch(/Baseline.*Constraints.*Concessions.*Verification.*Close or no-change/s);
    expect(prompt).toMatch(/second distinct path triggers the stopping rule/);
    expect(prompt).toMatch(/do not introduce another path or ask another How\/What question/);
    expect(prompt).toMatch(/next and only concession question must be one no-oriented final check/);
    expect(prompt).toMatch(/no-price-change answer to the opening is refusal #1|“no price change without altering coverage” answer to the opening is refusal #1/);
    expect(prompt).toMatch(/stopping rule, which overrides the concession priority list/);
    expect(prompt).toMatch(/Never send a fragment/);
    expect(prompt).toMatch(/at most two sentences, 35 words total, and one question/);

    expect(specs[1].conversationConfig.agent.disableFirstMessageInterruptions).toBe(true);
    expect(specs[1].conversationConfig.turn).toEqual({
      turnEagerness: "patient",
      turnTimeout: 12,
      turnModel: "turn_v3",
      speculativeTurn: false,
      transcribeOnDisabledInterruptions: true,
      interruptionIgnoreTerms: ["gotcha", "understood"],
    });
    expect(specs[1].conversationConfig.agent.prompt).toMatchObject({
      llm: "gemini-2.5-flash",
      temperature: 0.2,
      maxTokens: 220,
      ignoreDefaultPersonality: true,
    });
    expect(() => buildNegotiatorPrompt(" ")).toThrow(/empty/);
  });

  it("builds a distinct quote caller with provider-confirmed collection guardrails", () => {
    const quoteCaller = buildAgentSpecs("voice-1", POLICY).find((spec) => spec.name === "PolicyScout Quote Caller");

    expect(AGENT_ENV_KEYS[quoteCaller.name]).toBe("ELEVENLABS_QUOTE_CALLER_AGENT_ID");
    expect(quoteCaller.conversationConfig.tts.voiceId).toBe("voice-1");
    expect(quoteCaller.platformSettings.privacy).toMatchObject({ recordVoice: false, deleteAudio: true, deleteTranscriptAndPii: true, retentionDays: 0 });
    expect(quoteCaller.conversationConfig.agent.firstMessage).toBe(QUOTE_CALLER_FIRST_MESSAGE);
    expect(quoteCaller.conversationConfig.agent.firstMessage).toContain("{{quote_provider_name}}");
    expect(quoteCaller.conversationConfig.agent.firstMessage).toContain("{{quote_profile_brief}}");

    const prompt = quoteCaller.conversationConfig.agent.prompt.prompt;
    expect(prompt).toContain("{{quote_provider_name}}");
    expect(prompt).toContain("{{quote_profile_brief}}");
    expect(prompt).toMatch(/Do not negotiate, bargain, request discounts/);
    expect(prompt).toMatch(/Do not .*rankings, targets, ceilings, competing offers/is);
    expect(prompt).toMatch(/Do not invent, calculate, assume, or imply quote facts/);
    expect(prompt).toMatch(/all-in policy-period total.*policy term.*fees and taxes.*requested coverage.*effective date.*date and time/is);
    expect(prompt).toMatch(/recorded total must include all fees and taxes/);
    expect(prompt).toMatch(/Call record_quote exactly once and only after the provider explicitly confirms every required detail/);
    expect(prompt).toMatch(/simulated, non-binding demo collection/);
    expect(prompt).toMatch(/do not volunteer that status/i);
    expect(quoteCaller.conversationConfig.agent.prompt.tools).toEqual(QUOTE_CALLER_CLIENT_TOOLS);

    const recordQuote = QUOTE_CALLER_CLIENT_TOOLS[0];
    expect(recordQuote).toMatchObject({ type: "client", name: "record_quote", expectsResponse: true, responseTimeoutSecs: 10 });
    expect(recordQuote.parameters.required).toEqual(["totalPolicyTermCostCents", "policyTermMonths", "feesAndTaxesIncluded", "coverageMatchesRequested", "effectiveDate", "quoteValidUntil", "providerResponse"]);
    expect(recordQuote.parameters.properties.totalPolicyTermCostCents).toMatchObject({ type: "integer", minimum: 1 });
    expect(recordQuote.parameters.properties.policyTermMonths).toMatchObject({ type: "integer", minimum: 1 });
    expect(recordQuote.parameters.properties.feesAndTaxesIncluded).toMatchObject({ type: "boolean" });
    expect(recordQuote.parameters.properties.coverageMatchesRequested).toMatchObject({ type: "boolean" });
    expect(recordQuote.parameters.properties.effectiveDate).toMatchObject({ type: "string", format: "date" });
    expect(recordQuote.parameters.properties.quoteValidUntil).toMatchObject({ type: "string", format: "date-time" });
    expect(recordQuote.parameters.properties.providerResponse).toMatchObject({ type: "string" });
  });

  it("defaults to a read-only plan and updates existing names idempotently", async () => {
    const sdk = client([{ name: "PolicyScout Voice Smoke", agentId: "existing", archived: false }]);
    const plan = await provisionAgents(sdk, { negotiatorPolicy: POLICY });
    expect(plan["PolicyScout Voice Smoke"]).toEqual({ action: "update", agentId: "existing" });
    expect(sdk.conversationalAi.agents.create).not.toHaveBeenCalled();
    await provisionAgents(sdk, { apply: true, negotiatorPolicy: POLICY });
    expect(sdk.conversationalAi.agents.update).toHaveBeenCalledWith("existing", expect.any(Object));
    expect(sdk.conversationalAi.agents.create).toHaveBeenCalledTimes(2);
  });

  it("preserves unrelated env lines while upserting only non-secret IDs", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "person3-setup-"));
    const path = resolve(directory, ".env.local");
    await writeFile(path, "KEEP=this\nELEVENLABS_VOICE_SMOKE_AGENT_ID=old\n", "utf8");
    await upsertAgentIds(path, { "PolicyScout Voice Smoke": { agentId: "voice" }, "PolicyScout Negotiator": { agentId: "negotiator" }, "PolicyScout Quote Caller": { agentId: "quote-caller" } });
    expect(await readFile(path, "utf8")).toBe("KEEP=this\nELEVENLABS_VOICE_SMOKE_AGENT_ID=voice\nELEVENLABS_NEGOTIATOR_AGENT_ID=negotiator\nELEVENLABS_QUOTE_CALLER_AGENT_ID=quote-caller\n");
  });

  it("turns permission failures into actionable, non-secret guidance", () => {
    expect(permissionErrorMessage({ statusCode: 403, message: "forbidden" })).toMatch(/convai_read and convai_write/);
  });
});
