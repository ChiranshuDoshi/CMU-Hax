import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ConfirmedQuoteRequestSchema } from "@/domain/schemas/person4";

describe("Person 4 integration contract", () => {
  it("accepts the provider-safe request in the demo profile", () => {
    const fixturePath = resolve(process.cwd(), "tests/fixtures/fake_person_profile.json");
    const profile = JSON.parse(readFileSync(fixturePath, "utf8")) as { confirmedQuoteRequest: unknown };

    const parsed = ConfirmedQuoteRequestSchema.parse(profile.confirmedQuoteRequest);

    expect(parsed.insuranceLines).toEqual(["auto"]);
    expect(parsed.state).toBe("MA");
    expect(parsed.zipCode).toBe("02139");
    expect(parsed.requestedCoverage).toHaveLength(6);
    expect(parsed.specificationHash).toHaveLength(64);
  });
});
