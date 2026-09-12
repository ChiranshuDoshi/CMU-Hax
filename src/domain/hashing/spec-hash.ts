import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";
import {
  HASHABLE_REQUEST_KEYS,
  type ConfirmedQuoteRequest,
} from "../schemas/confirmed-quote-request.js";

/**
 * The minimum shape needed to compute a spec hash: the hashable keys must be
 * present, but their value types don't matter here — the hasher only reads the
 * canonical JSON of the values. A full ConfirmedQuoteRequest satisfies this.
 */
export type HashableRequest = {
  [K in (typeof HASHABLE_REQUEST_KEYS)[number]]: unknown;
};

/** Raw SHA-256 hex of the canonical JSON of any value. */
export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * The provider-safe subset of a request that actually feeds the spec hash.
 * Everything private lives elsewhere and never touches this. (Spec §9.5)
 */
export function hashableRequestPayload(
  request: HashableRequest
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of HASHABLE_REQUEST_KEYS) {
    payload[key] = (request as Record<string, unknown>)[key];
  }
  return payload;
}

/**
 * Compute the specification hash for a confirmed quote request. All five
 * first-round provider conversations must reuse the value this returns.
 */
export function computeSpecificationHash(request: HashableRequest): string {
  return sha256Canonical(hashableRequestPayload(request));
}

/** True iff `request.specificationHash` matches a fresh recomputation. */
export function verifySpecificationHash(request: ConfirmedQuoteRequest): boolean {
  return computeSpecificationHash(request) === request.specificationHash;
}
