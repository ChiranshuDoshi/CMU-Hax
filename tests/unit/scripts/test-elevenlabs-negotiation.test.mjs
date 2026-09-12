import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { validateNegotiationEvent } from "@/domain/negotiation";
import { buildMockResult, loadAndValidatePerson4Artifacts, main, parseNegotiationArgs, runLiveSimulation } from "../../../scripts/test-elevenlabs-negotiation.mjs";
import { createConfirmedRequest, createEvidence, createGoal, createQuote } from "../recommendation/factories";

const HASH = "a".repeat(64);
const quote = { quoteId: "quote-1", providerId: "provider-1", workflowId: "workflow-1", specificationHash: HASH, effectiveComparisonCostCents: 120000, currency: "USD", evidenceIds: ["source-evidence"] };
const target = { quoteId: quote.quoteId, providerId: quote.providerId };

async function artifacts(overrides = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), "person3-negotiation-"));
  const values = {
    "research.json": { ranking: { selected: [{ providerId: "provider-1", providerName: "Provider One" }] } },
    "normalized-quotes.json": { quotes: [{ ...quote, ...overrides.quote }] },
    "person3-handoff.json": { workflowId: quote.workflowId, specificationHash: HASH, target: { ...target, ...overrides.target } },
    "raw-quotes.json": { quotes: [{ evidence: [{ id: "source-evidence" }] }] },
  };
  await Promise.all(Object.entries(values).map(([name, value]) => writeFile(resolve(directory, name), JSON.stringify(value))));
  return directory;
}

describe("Person 3 negotiation verifier", () => {
  it("requires explicit exact selection and a bounded private target", async () => {
    expect(() => parseNegotiationArgs(["--artifact-dir", "x"])).toThrow(/target/);
    expect(() => parseNegotiationArgs(["--artifact-dir", "x", "--target-cents", "100", "--max-turns", "7"])).toThrow(/cannot exceed/);
    expect(() => parseNegotiationArgs(["--artifact-dir", "x", "--target-min-cents", "200", "--target-max-cents", "100"])).toThrow(/minimum cannot exceed/);
    expect(() => parseNegotiationArgs(["--artifact-dir", "x", "--target-cents", "100", "--confirm-selection"])).toThrow(/requires a value/);
    const directory = await artifacts();
    await expect(loadAndValidatePerson4Artifacts(directory, undefined)).rejects.toThrow(/never automatic/);
    await expect(loadAndValidatePerson4Artifacts(directory, "wrong:quote")).rejects.toThrow(/confirmation mismatch/i);
  });

  it("rejects provider, quote, hash, and evidence mismatches", async () => {
    const providerMismatch = await artifacts({ quote: { providerId: "other" } });
    await expect(loadAndValidatePerson4Artifacts(providerMismatch, "provider-1:quote-1")).rejects.toThrow(/Provider mismatch/);
    const hashMismatch = await artifacts({ quote: { specificationHash: "b".repeat(64) } });
    await expect(loadAndValidatePerson4Artifacts(hashMismatch, "provider-1:quote-1")).rejects.toThrow(/hash mismatch/);
    const evidenceMismatch = await artifacts({ quote: { evidenceIds: ["missing"] } });
    await expect(loadAndValidatePerson4Artifacts(evidenceMismatch, "provider-1:quote-1")).rejects.toThrow(/evidence absent/);
  });

  it("builds a bounded fixture concession that Person 4 cannot ingest", async () => {
    const context = await loadAndValidatePerson4Artifacts(await artifacts(), "provider-1:quote-1");
    const result = buildMockResult(context, { targetCents: 100000 });
    expect(result.simulated).toBe(true);
    expect(result.fixtureOnly).toBe(true);
    expect(result.ingestible).toBe(false);
    expect(result.privateGoalProvided).toBe(true);
    expect(result).not.toHaveProperty("privateGoal");
    expect(result.event).toBeNull();
    expect(result.evidence[0].verificationStatus).toBe("not_applicable");
    expect(result.nonIngestibleCandidate.competingQuoteId).toBeNull();
    expect(result.nonIngestibleCandidate.verifiedLeverageStatement).toBeNull();
    expect(result.nonIngestibleCandidate.finalCostCents).toBeLessThan(result.nonIngestibleCandidate.originalCostCents);
    expect(result.nonIngestibleCandidate.changedDiscounts).toHaveLength(1);
    expect(result.nonIngestibleCandidate.changedDiscounts[0].amountCents).toBeGreaterThanOrEqual(100);
    expect(result.nonIngestibleCandidate.changedDiscounts[0].amountCents).toBeLessThanOrEqual(2500);
    expect(result.evidence[0].claimValue.amountCents).toBe(result.nonIngestibleCandidate.finalCostCents);
    expect(result.transcript.map((turn) => turn.message).join(" ")).not.toContain("100000");
    expect(result.transcript[1].message).toMatch(/^Fixture-only simulated response proposes/);
    expect(result.transcript[1].message).toContain("not provider confirmation");

    const originalQuote = createQuote();
    const validatorResult = buildMockResult({
      target: { providerId: originalQuote.providerId, quoteId: originalQuote.quoteId },
      quote: originalQuote,
      selectedProvider: { providerName: "Provider One" },
    }, { targetCents: 900 });
    expect(() => validateNegotiationEvent({
      event: validatorResult.nonIngestibleCandidate,
      goal: createGoal({ id: `goal-${originalQuote.quoteId}` }),
      originalQuote,
      confirmedRequest: createConfirmedRequest(),
      evidence: [createEvidence(), ...validatorResult.evidence],
    })).toThrow(/not provider-confirmed/i);
  });

  it("bounds live SDK simulation and refuses transcript-derived structured events", async () => {
    const context = await loadAndValidatePerson4Artifacts(await artifacts(), "provider-1:quote-1");
    const simulateConversation = vi.fn().mockResolvedValue({ simulatedConversation: [{ role: "agent", message: "hi" }], analysis: {} });
    const result = await runLiveSimulation({ conversationalAi: { agents: { simulateConversation } } }, "agent", context, { turns: 3, durationSeconds: 30 });
    expect(simulateConversation).toHaveBeenCalledWith("agent", expect.objectContaining({ newTurnsLimit: 3 }), { timeoutInSeconds: 30 });
    expect(simulateConversation.mock.calls[0][1].simulationSpecification.dynamicVariables.user_display_name).toBe("the policyholder");
    expect(result.event).toBeNull();
    expect(result.status).toBe("requires_human_review");
  });

  it("writes simulation artifacts with private directory and file permissions", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "person3-private-output-"));
    const artifactDirectory = await artifacts();
    const { output } = await main([
      "--artifact-dir", artifactDirectory,
      "--confirm-selection", "provider-1:quote-1",
      "--target-cents", "100000",
    ], { root });

    expect((await stat(resolve(output, ".."))).mode & 0o777).toBe(0o700);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
  });
});
