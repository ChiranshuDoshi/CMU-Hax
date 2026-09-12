import { describe, expect, it } from "vitest";

import { parseQuoteCollectionReference } from "@/app/dev/elevenlabs/demo-client";

const specificationHash = "a".repeat(64);

describe("quote collection reference input", () => {
  it("accepts the exact safe reference shape", () => {
    const reference = {
      collectionId: "collection-demo",
      workflowId: "workflow-demo",
      providerId: "provider-demo",
      specificationHash,
    };

    expect(parseQuoteCollectionReference(JSON.stringify(reference))).toEqual(reference);
  });

  it("rejects extra fields and invalid specification hashes", () => {
    expect(() => parseQuoteCollectionReference(JSON.stringify({
      collectionId: "collection-demo",
      workflowId: "workflow-demo",
      providerId: "provider-demo",
      specificationHash,
      providerSafeBrief: "must stay server controlled",
    }))).toThrow("must contain exactly");

    expect(() => parseQuoteCollectionReference(JSON.stringify({
      collectionId: "collection-demo",
      workflowId: "workflow-demo",
      providerId: "provider-demo",
      specificationHash: "not-a-hash",
    }))).toThrow("64-character lowercase hexadecimal hash");
  });
});
