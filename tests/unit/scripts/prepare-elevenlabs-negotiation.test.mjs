import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { validateNegotiationGoal } from "@/domain/negotiation";
import {
  NEGOTIATION_SESSION_PATH,
  buildNegotiationSession,
  loadPreparedContext,
  loadParticipant,
  main,
  parsePreparationArgs,
  validateDisplayName,
} from "../../../scripts/prepare-elevenlabs-negotiation.mjs";
import { createQuote } from "../recommendation/factories";

const HASH = "a".repeat(64);
const PROFILE_PATH = resolve(process.cwd(), "tests/fixtures/fake_person_profile.json");

function createHandoff(quote, competingQuote = null) {
  return {
    workflowId: quote.workflowId,
    specificationHash: quote.specificationHash,
    target: { providerId: quote.providerId, quoteId: quote.quoteId },
    verifiedCompetingQuote: competingQuote && {
      providerId: competingQuote.providerId,
      providerName: `Provider ${competingQuote.providerId}`,
      quoteId: competingQuote.quoteId,
      effectiveComparisonCostCents: competingQuote.effectiveComparisonCostCents,
      coverageEquivalence: competingQuote.coverageEquivalence,
      evidenceIds: competingQuote.evidenceIds,
    },
  };
}

async function writeArtifacts(overrides = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "person3-prepare-"));
  const artifactDirectory = resolve(root, "person4-run");
  const quote = createQuote({ specificationHash: HASH });
  const competingQuote = createQuote({ quoteId: "quote-2", providerId: "provider-2", specificationHash: HASH });
  await mkdir(artifactDirectory);
  await writeFile(resolve(artifactDirectory, "person3-handoff.json"), JSON.stringify(overrides.handoff ?? createHandoff(quote, competingQuote)));
  await writeFile(resolve(artifactDirectory, "normalized-quotes.json"), JSON.stringify(overrides.normalized ?? { quotes: [quote, competingQuote] }));
  return { root, artifactDirectory, quote, competingQuote };
}

describe("ElevenLabs negotiation preparation", () => {
  it("requires an exact explicit selection and exactly one private target form", () => {
    expect(() => parsePreparationArgs([])).toThrow(/artifact-dir/);
    expect(() => parsePreparationArgs(["--artifact-dir", "run", "--confirm-selection", "p:q"])).toThrow(/target/);
    expect(() => parsePreparationArgs(["--artifact-dir", "run", "--confirm-selection", "p:q", "--target-cents", "100", "--target-min-cents", "90", "--target-max-cents", "110"])).toThrow(/either/);
    expect(() => parsePreparationArgs(["--artifact-dir", "run", "--confirm-selection", "p:q", "--target-min-cents", "110", "--target-max-cents", "90"])).toThrow(/minimum/);
  });

  it("requires exactly one identity source and validates the trimmed display name", () => {
    const base = [
      "--artifact-dir", "run",
      "--confirm-selection", "p:q",
      "--target-cents", "100",
    ];
    expect(() => parsePreparationArgs(base)).toThrow(/exactly one identity source/);
    expect(() => parsePreparationArgs([...base, "--profile", "profile.json", "--user-name", "Alex"])).toThrow(/exactly one identity source/);
    expect(() => parsePreparationArgs([...base, "--user-name", "Alex", "--user-name", "Morgan"])).toThrow(/only be provided once/);
    expect(validateDisplayName("  Alex Morgan  ")).toBe("Alex Morgan");
    expect(() => validateDisplayName("   ")).toThrow(/between 1 and 120/);
    expect(() => validateDisplayName("a".repeat(121))).toThrow(/between 1 and 120/);
    expect(() => validateDisplayName("Alex\nMorgan")).toThrow(/control characters/);
    expect(() => validateDisplayName("Alex\u007fMorgan")).toThrow(/control characters/);
    expect(() => validateDisplayName("Alex\u0085Morgan")).toThrow(/control characters/);
  });

  it("imports only userContext.displayName from a profile", async () => {
    const participant = await loadParticipant({ profilePath: PROFILE_PATH, userName: null });

    expect(participant).toEqual({ displayName: "Alex Morgan" });
    expect(Object.keys(participant)).toEqual(["displayName"]);
    await expect(loadParticipant({ profilePath: null, userName: "  Taylor Reed  " })).resolves.toEqual({
      displayName: "Taylor Reed",
    });
    await expect(loadParticipant({ profilePath: null, userName: "Taylor\nReed" })).rejects.toThrow(/control characters/);
  });

  it("writes a validated private session with restrictive permissions and logs only a safe reference", async () => {
    const { root, artifactDirectory, quote, competingQuote } = await writeArtifacts();
    const privateTarget = 91_337;
    const log = vi.fn();
    const { output, reference } = await main([
      "--artifact-dir", artifactDirectory,
      "--confirm-selection", `${quote.providerId}:${quote.quoteId}`,
      "--target-cents", String(privateTarget),
      "--profile", PROFILE_PATH,
    ], { root, now: () => "2026-07-18T12:00:00.000Z", log });

    expect(output).toBe(resolve(root, NEGOTIATION_SESSION_PATH));
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    expect((await stat(resolve(output, ".."))).mode & 0o777).toBe(0o700);
    const session = JSON.parse(await readFile(output, "utf8"));
    expect(Object.keys(session)).toEqual(["participant", "handoff", "goal", "explicitSelection"]);
    expect(session.participant).toEqual({ displayName: "Alex Morgan" });
    expect(JSON.stringify(session)).not.toContain("userContext");
    expect(session.goal).toMatchObject({
      targetAmountCents: privateTarget,
      billingFrequency: "policy_term",
      disclosurePolicy: "do_not_reveal_ceiling",
      verifiedCompetingQuoteId: competingQuote.quoteId,
      hardStops: [expect.stringMatching(/Coverage must remain unchanged/)],
    });
    expect(validateNegotiationGoal(session.goal, quote)).toEqual(session.goal);
    expect(reference).toEqual({
      workflowId: quote.workflowId,
      providerId: quote.providerId,
      quoteId: quote.quoteId,
      specificationHash: HASH,
      selectedAt: "2026-07-18T12:00:00.000Z",
    });
    expect(JSON.stringify(reference)).not.toContain(String(privateTarget));
    expect(log).toHaveBeenCalledWith(JSON.stringify(reference));
    expect(JSON.stringify(log.mock.calls)).not.toContain(String(privateTarget));
  });

  it("builds a private range and rejects quote identity or leverage mismatches", async () => {
    const { artifactDirectory, quote } = await writeArtifacts();
    const context = await loadPreparedContext(artifactDirectory, `${quote.providerId}:${quote.quoteId}`);
    const session = buildNegotiationSession(context, {
      participant: { displayName: "Alex Morgan" },
      targetAmountCents: null,
      targetRangeMinCents: 80_000,
      targetRangeMaxCents: 90_000,
    }, "2026-07-18T12:00:00.000Z");
    expect(session.goal).toMatchObject({ targetAmountCents: null, targetRangeMinCents: 80_000, targetRangeMaxCents: 90_000 });

    await expect(loadPreparedContext(artifactDirectory, "wrong:selection")).rejects.toThrow(/exactly match/);
    const mismatch = await writeArtifacts({
      normalized: { quotes: [createQuote({ specificationHash: "b".repeat(64) })] },
      handoff: createHandoff(quote),
    });
    await expect(loadPreparedContext(mismatch.artifactDirectory, `${quote.providerId}:${quote.quoteId}`)).rejects.toThrow(/Specification hash mismatch/);

    const badLeverage = await writeArtifacts({
      handoff: createHandoff(quote, { quoteId: "missing", providerId: "provider-2" }),
      normalized: { quotes: [quote] },
    });
    await expect(loadPreparedContext(badLeverage.artifactDirectory, `${quote.providerId}:${quote.quoteId}`)).rejects.toThrow(/competing quote is absent/);
  });

  it("rejects divergent or ineligible persisted competing-quote fields", async () => {
    const { quote, competingQuote } = await writeArtifacts();
    const handoff = createHandoff(quote, competingQuote);
    const mismatches = [
      {
        handoff: {
          ...handoff,
          verifiedCompetingQuote: {
            ...handoff.verifiedCompetingQuote,
            effectiveComparisonCostCents: competingQuote.effectiveComparisonCostCents + 1,
          },
        },
        message: /cost does not match/,
      },
      {
        handoff: {
          ...handoff,
          verifiedCompetingQuote: {
            ...handoff.verifiedCompetingQuote,
            coverageEquivalence: { status: "equivalent", differences: ["divergent"] },
          },
        },
        message: /coverage equivalence does not match/,
      },
      {
        handoff: {
          ...handoff,
          verifiedCompetingQuote: {
            ...handoff.verifiedCompetingQuote,
            evidenceIds: ["different-evidence"],
          },
        },
        message: /evidence IDs do not match/,
      },
    ];

    for (const mismatch of mismatches) {
      const artifacts = await writeArtifacts({
        handoff: mismatch.handoff,
        normalized: { quotes: [quote, competingQuote] },
      });
      await expect(
        loadPreparedContext(artifacts.artifactDirectory, `${quote.providerId}:${quote.quoteId}`),
      ).rejects.toThrow(mismatch.message);
    }

    const ineligibleQuote = createQuote({
      quoteId: "quote-2",
      providerId: "provider-2",
      specificationHash: HASH,
      coverageEquivalence: { status: "worse_than_requested", differences: ["Lower coverage"] },
    });
    const ineligible = await writeArtifacts({
      handoff: createHandoff(quote, ineligibleQuote),
      normalized: { quotes: [quote, ineligibleQuote] },
    });
    await expect(
      loadPreparedContext(ineligible.artifactDirectory, `${quote.providerId}:${quote.quoteId}`),
    ).rejects.toThrow(/equivalent-or-better/);
  });
});
