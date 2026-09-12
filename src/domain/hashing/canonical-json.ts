/**
 * Deterministic canonical JSON serialization. (Spec §9.5)
 *
 * Two structurally-equal objects must serialize to the exact same string
 * regardless of key insertion order, so the SHA-256 spec hash is stable across
 * all five first-round provider calls. Rules:
 *   - object keys sorted lexicographically, recursively
 *   - arrays keep their order (order is meaningful)
 *   - `undefined` values and function/symbol values are dropped
 *   - no whitespace
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => canonicalize(v));
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v === undefined || typeof v === "function" || typeof v === "symbol") {
      continue;
    }
    out[key] = canonicalize(v);
  }
  return out;
}

/** Serialize any value to its canonical JSON string form. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
