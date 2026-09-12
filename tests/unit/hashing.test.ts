import { describe, it, expect } from "vitest";
import { canonicalJson } from "../../src/domain/hashing/canonical-json.js";
import {
  computeSpecificationHash,
  verifySpecificationHash,
} from "../../src/domain/hashing/spec-hash.js";
import {
  demoConfirmedRequest,
  demoQuotes,
  demoSpecificationHash,
} from "../../src/demo/fixtures/personal-auto.js";

describe("canonical JSON", () => {
  it("is independent of key insertion order", () => {
    const a = { b: 1, a: 2, nested: { y: 1, x: 2 } };
    const b = { nested: { x: 2, y: 1 }, a: 2, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("preserves array order (order is meaningful)", () => {
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it("drops undefined values", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });
});

describe("specification hash", () => {
  it("is deterministic and order-independent (test #13)", () => {
    const base = {
      requestId: "r1",
      workflowId: "w1",
      version: 1,
      insuranceLines: ["auto"],
      state: "TX",
      zipCode: "78701",
      desiredEffectiveDate: "2026-08-01",
      providerSafeEntities: [],
      existingCoverageBaseline: [],
      requestedCoverage: [],
      matchingMode: "exact_match" as const,
      allowedProviderContext: {},
      requiredQuoteQuestions: [],
      requiredQuoteFields: [],
      userConfirmedFacts: {},
      excludedSensitiveFacts: [],
    };
    const reordered = { ...base, allowedProviderContext: {}, state: "TX" };
    expect(computeSpecificationHash(base)).toBe(
      computeSpecificationHash(reordered)
    );
  });

  it("changes when a material field changes (test #14)", () => {
    const h1 = computeSpecificationHash({ ...demoConfirmedRequest });
    const h2 = computeSpecificationHash({
      ...demoConfirmedRequest,
      zipCode: "10001",
    });
    expect(h1).not.toBe(h2);
  });

  it("verifies the demo confirmed request", () => {
    expect(verifySpecificationHash(demoConfirmedRequest)).toBe(true);
  });

  it("all five first-round quotes share the same spec hash (test #15)", () => {
    for (const q of demoQuotes) {
      expect(q.specificationHash).toBe(demoSpecificationHash);
    }
  });
});
