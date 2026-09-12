import { lstat, mkdir, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  buildProviderSafeBrief,
  buildQuoteCollectionReferences,
  buildQuoteCollectionSession,
  main,
  parseQuoteCollectionArgs,
  writePrivateQuoteCollectionSession,
} from "../../../scripts/prepare-elevenlabs-quote-collection.ts";

const hash = "a".repeat(64);
const profile = {
  userContext: { displayName: "Alex Morgan", state: "MA", zipCode: "02139", desiredEffectiveDate: "2026-08-01" },
  drivers: [{ displayLabel: "Alex Morgan", ageBand: "30-39", licenseStatus: "valid", yearsLicensed: 16, recentAccidents: 0, recentViolations: 0 }],
  vehicles: [{ year: 2021, make: "Honda", model: "CR-V", ownership: "financed", primaryUse: "commute", annualMileage: 9000, garagingStatus: "private_driveway" }],
  discountEligibility: { safeDriver: true, telematicsAllowed: false },
  confirmedQuoteRequest: { id: "request-1", workflowId: "workflow-1", specificationHash: hash },
};
const research = {
  ranking: {
    workflowId: "workflow-1",
    quoteRequestId: "request-1",
    specificationHash: hash,
    selected: [1, 2, 3, 4, 5].map((number) => ({ providerId: `provider-${number}`, providerName: `Provider ${number}` })),
  },
};

const ARGV = [
  "--profile", "profile.json",
  "--research", "research.json",
  "--artifact-dir", ".artifacts/person4/run",
];
const NOW = "2026-07-18T12:00:00.000Z";

function dependencies(overrides = {}) {
  const readJson = vi.fn(async (path) => path.endsWith("profile.json") ? profile : research);
  const writePrivateQuoteCollectionSession = vi.fn(async () => "/virtual/.artifacts/person3/quote-collection-session.json");
  const log = vi.fn();
  return {
    root: "/virtual",
    now: () => NOW,
    readJson,
    writePrivateQuoteCollectionSession,
    log,
    ...overrides,
  };
}

describe("prepare quote collection", () => {
  it("builds a provider-safe brief and five exact provider references", () => {
    const session = buildQuoteCollectionSession(profile, research, "/workspace/.artifacts/person4/run", NOW);
    const references = buildQuoteCollectionReferences(session);

    expect(session.providerSafeBrief).toContain("Alex Morgan");
    expect(session.providerSafeBrief).toContain("Honda CR-V");
    expect(session.providerSafeBrief).toContain("Do not disclose payment details");
    expect(references).toHaveLength(5);
    expect(references[0]).toEqual({
      collectionId: session.collectionId,
      workflowId: "workflow-1",
      providerId: "provider-1",
      specificationHash: hash,
    });
  });

  it("requires all CLI inputs, rejects invalid research selection, and accepts --interactive once", () => {
    expect(() => parseQuoteCollectionArgs(["--profile", "profile.json"])).toThrow(/--research is required/);
    expect(() => parseQuoteCollectionArgs([...ARGV, "--interactive", "--interactive"])).toThrow(/only be provided once/);
    expect(parseQuoteCollectionArgs([...ARGV, "--interactive"])).toMatchObject({ interactive: true });
    expect(() => buildQuoteCollectionSession(profile, {
      ranking: { ...research.ranking, selected: research.ranking.selected.slice(0, 4) },
    }, "/workspace/.artifacts/person4/run")).toThrow(/exactly five/);
    expect(buildProviderSafeBrief({ userContext: { displayName: "A" } })).toContain("Customer: A");
  });

  it("simulates the default preparation using the in-memory private context and logs its recommendation", async () => {
    const simulate = vi.fn().mockResolvedValue({
      result: {
        recommendedProviderName: "Provider 5",
        effectiveComparisonCostCents: 110_000,
      },
    });
    const createQuoteCollectionService = vi.fn(() => ({ simulate }));
    const injected = dependencies({ createQuoteCollectionService });

    const result = await main(ARGV, injected);

    expect(createQuoteCollectionService).toHaveBeenCalledTimes(1);
    const loader = createQuoteCollectionService.mock.calls[0][0];
    await expect(loader.load()).resolves.toMatchObject({
      collectionId: "quote-collection-workflow-1-2026-07-18T12-00-00.000Z",
      providerSafeBrief: expect.stringContaining("Alex Morgan"),
    });
    expect(simulate).toHaveBeenCalledWith({
      collectionId: "quote-collection-workflow-1-2026-07-18T12-00-00.000Z",
      workflowId: "workflow-1",
      specificationHash: hash,
    });
    expect(injected.writePrivateQuoteCollectionSession).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      output: "/virtual/.artifacts/person3/quote-collection-session.json",
      references: expect.any(Array),
      simulated: true,
      artifactDirectory: "/virtual/.artifacts/person4/run",
      recommendedProviderName: "Provider 5",
      effectiveComparisonCostCents: 110_000,
    });
    expect(JSON.parse(injected.log.mock.calls[0][0])).toEqual(result);
  });

  it("keeps --interactive as live preparation and logs only safe references", async () => {
    const simulate = vi.fn();
    const createQuoteCollectionService = vi.fn(() => ({ simulate }));
    const injected = dependencies({ createQuoteCollectionService });

    const result = await main([...ARGV, "--interactive"], injected);

    expect(createQuoteCollectionService).not.toHaveBeenCalled();
    expect(simulate).not.toHaveBeenCalled();
    expect(result).toEqual({
      output: "/virtual/.artifacts/person3/quote-collection-session.json",
      references: expect.arrayContaining([expect.objectContaining({
        collectionId: "quote-collection-workflow-1-2026-07-18T12-00-00.000Z",
        workflowId: "workflow-1",
        specificationHash: hash,
      })]),
      simulated: false,
      artifactDirectory: "/virtual/.artifacts/person4/run",
    });
    const logged = JSON.parse(injected.log.mock.calls[0][0]);
    expect(logged).toEqual(result);
    expect(JSON.stringify(logged)).not.toContain("providerSafeBrief");
  });

  it("rejects a symlinked private-session directory without writing through it", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "quote-collection-session-"));
    const artifactRoot = resolve(root, ".artifacts");
    const redirectedDirectory = resolve(root, "redirected");
    try {
      await mkdir(artifactRoot);
      await mkdir(redirectedDirectory);
      await symlink(redirectedDirectory, resolve(artifactRoot, "person3"));
      const session = buildQuoteCollectionSession(profile, research, resolve(root, ".artifacts", "person4", "run"), NOW);

      await expect(writePrivateQuoteCollectionSession(root, session)).rejects.toThrow(/private quote collection directory is invalid/i);
      await expect(lstat(resolve(redirectedDirectory, "quote-collection-session.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes the private session with restrictive file and directory modes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "quote-collection-session-"));
    try {
      const session = buildQuoteCollectionSession(profile, research, resolve(root, ".artifacts", "person4", "run"), NOW);
      const output = await writePrivateQuoteCollectionSession(root, session);

      expect((await stat(output)).mode & 0o777).toBe(0o600);
      expect((await stat(resolve(output, ".."))).mode & 0o777).toBe(0o700);
      expect((await stat(resolve(output, "..", ".."))).mode & 0o777).toBe(0o700);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
