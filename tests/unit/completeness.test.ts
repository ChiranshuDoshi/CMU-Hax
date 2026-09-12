import { describe, it, expect } from "vitest";
import { computeCompleteness } from "../../src/domain/profile/completeness.js";
import { PERSONAL_AUTO_REQUIRED_FIELDS } from "../../src/domain/profile/personal-auto-required-fields.js";
import { demoProfile } from "../../src/demo/fixtures/personal-auto.js";

describe("profile completeness gate (test #1, #2)", () => {
  it("the complete demo profile is quote-ready", () => {
    const r = computeCompleteness(demoProfile, PERSONAL_AUTO_REQUIRED_FIELDS);
    expect(r.quoteReady).toBe(true);
    expect(r.missingFields).toHaveLength(0);
    expect(r.completenessScore).toBe(1);
  });

  it("missing required fields block quote-readiness and are listed", () => {
    const incomplete = {
      ...demoProfile,
      userContext: { ...demoProfile.userContext, zipCode: null },
      insuredEntities: demoProfile.insuredEntities.filter(
        (e) => e.entityType !== "vehicle"
      ),
    };
    const r = computeCompleteness(incomplete, PERSONAL_AUTO_REQUIRED_FIELDS);
    expect(r.quoteReady).toBe(false);
    expect(r.missingFields).toContain("userContext.zipCode");
    expect(r.missingFields).toContain("entity:vehicle");
    expect(r.completenessScore).toBeLessThan(1);
  });
});
