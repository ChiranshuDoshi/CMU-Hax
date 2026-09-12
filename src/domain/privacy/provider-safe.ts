/**
 * Provider-safe boundary. (Spec §9.4, §16, §32)
 *
 * A single guard the whole team can call before anything is handed to a
 * provider agent, research query, transcript, or browser payload. It deep-scans
 * for keys that must never cross the boundary — the private ceiling, budgets,
 * and disallowed sensitive personal data.
 *
 * ConfirmedQuoteRequest is provider-safe by construction; this is the belt-and-
 * suspenders check that makes the "ceiling never leaks" behaviour testable.
 */

/** Field names that must never appear in provider-facing data. */
export const FORBIDDEN_PROVIDER_KEYS = new Set<string>([
  // private negotiation constraints / ceiling
  "maxMonthlyPremium",
  "maxAnnualPremium",
  "maxPolicyTermCost",
  "maxDownPayment",
  "maxDeductibleByCoverage",
  "targetRangeMax",
  "hardStops",
  "negotiationPriorities",
  "privateConstraints",
  "encryptedGoalPayload",
  "encryptedPayload",
  // disallowed sensitive personal data (Spec §5, §32)
  "ssn",
  "socialSecurityNumber",
  "driversLicenseNumber",
  "fullDriversLicenseNumber",
  "governmentId",
  "paymentCardNumber",
  "bankAccountNumber",
  "cardNumber",
]);

export interface PrivacyLeak {
  path: string;
  key: string;
}

/** Deep-scan an object for any forbidden provider key. Returns every hit. */
export function findProviderLeaks(value: unknown, basePath = "$"): PrivacyLeak[] {
  const leaks: PrivacyLeak[] = [];

  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPath = `${path}.${key}`;
      if (FORBIDDEN_PROVIDER_KEYS.has(key)) {
        leaks.push({ path: childPath, key });
      }
      walk(child, childPath);
    }
  };

  walk(value, basePath);
  return leaks;
}

/** True iff no forbidden key is present anywhere in the value. */
export function isProviderSafe(value: unknown): boolean {
  return findProviderLeaks(value).length === 0;
}

/**
 * Throw if the payload contains any private data. Call this right before
 * sending anything to a provider agent / research query / browser.
 */
export function assertProviderSafe(value: unknown, label = "payload"): void {
  const leaks = findProviderLeaks(value);
  if (leaks.length > 0) {
    const where = leaks.map((l) => l.path).join(", ");
    throw new Error(
      `Refusing to expose private data in ${label}: forbidden field(s) at ${where}`
    );
  }
}

/**
 * Build a provider-safe object from an explicit allowlist of top-level keys.
 * (Spec §15 "build provider-safe JSON from an explicit allowlist".)
 */
export function pickAllowlisted<T extends Record<string, unknown>>(
  source: T,
  allowedKeys: readonly (keyof T)[]
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of allowedKeys) {
    if (key in source) out[key] = source[key];
  }
  return out;
}
