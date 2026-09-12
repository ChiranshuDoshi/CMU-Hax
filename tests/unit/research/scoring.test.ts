import { describe, expect, it } from "vitest";

import {
  calculateRecency,
  calculateReviewConfidence,
  calculateSourceQuality,
  normalizeRating,
} from "@/domain/research";

import { EVALUATED_AT, makeCandidate } from "./factories";

describe("research scoring", () => {
  it("normalizes different rating scales and clamps invalid ranges deterministically", () => {
    expect(normalizeRating(4.5, 5)).toBe(90);
    expect(normalizeRating(9, 10)).toBe(90);
    expect(normalizeRating(6, 5)).toBe(100);
    expect(normalizeRating(null, 5)).toBe(0);
    expect(normalizeRating(4, null)).toBe(0);
  });

  it("uses the required capped logarithmic review confidence formula", () => {
    expect(calculateReviewConfidence(0)).toBe(0);
    expect(calculateReviewConfidence(99)).toBe(50);
    expect(calculateReviewConfidence(9_999)).toBe(100);
    expect(calculateReviewConfidence(1_000_000)).toBe(100);
  });

  it("applies the frozen source-quality table", () => {
    const source = makeCandidate("source").sources[0];
    expect(calculateSourceQuality({ ...source, sourceKind: "regulator", confidence: 0.2 })).toBe(100);
    expect(calculateSourceQuality({ ...source, sourceKind: "recognized_consumer" })).toBe(100);
    expect(calculateSourceQuality({ ...source, sourceKind: "business_listing" })).toBe(85);
    expect(calculateSourceQuality({ ...source, sourceKind: "provider" })).toBe(70);
    expect(calculateSourceQuality({ ...source, sourceKind: "secondary" })).toBe(50);
    expect(calculateSourceQuality({ ...source, sourceKind: "search_snippet" })).toBe(0);
  });

  it("uses deterministic recency buckets and clamps future observations", () => {
    expect(calculateRecency("2026-07-19T00:00:00.000Z", EVALUATED_AT)).toBe(100);
    expect(calculateRecency("2026-01-20T12:00:00.000Z", EVALUATED_AT)).toBe(100);
    expect(calculateRecency("2026-01-18T12:00:00.000Z", EVALUATED_AT)).toBe(80);
    expect(calculateRecency("2025-07-18T12:00:00.000Z", EVALUATED_AT)).toBe(80);
    expect(calculateRecency("2024-07-18T12:00:00.000Z", EVALUATED_AT)).toBe(50);
    expect(calculateRecency("2024-07-17T12:00:00.000Z", EVALUATED_AT)).toBe(20);
    expect(calculateRecency(null, EVALUATED_AT)).toBe(20);
  });
});
