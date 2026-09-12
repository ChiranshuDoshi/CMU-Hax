import type { InsuranceProfile } from "../schemas/insurance-profile.js";

/**
 * Profile completeness engine. (Spec §9.3, §11.1, test #1/#2.)
 *
 * Deliberately decoupled from Person 4's InsuranceLineConfig: it takes the list
 * of required-field rules as input, so P4 can own the auto/home/etc rule sets
 * while P2 owns the evaluation + the quote-ready gate. Merge P4's config into
 * `RequiredFieldRule[]` at the call site.
 *
 * A rule `path` is one of:
 *   - "userContext.state"        → dot path into the profile; value must be present
 *   - "entity:driver"            → at least one insured entity of that type
 *   - "entity:vehicle.year"      → every entity of that type has that attribute
 *   - "requestedCoverage"        → at least one requested coverage section
 */
export interface RequiredFieldRule {
  path: string;
  label: string;
}

export interface CompletenessResult {
  completenessScore: number; // 0..1
  missingFields: string[]; // rule paths that failed
  quoteReady: boolean; // all required rules satisfied
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Resolve a simple dot path (no array indices) against an object. */
function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== "object") {
      return undefined;
    }
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function entityAttr(
  entity: { attributes: Record<string, unknown>; lineSpecificAttributes: Record<string, unknown> },
  attrPath: string
): unknown {
  const fromLine = getByPath(entity.lineSpecificAttributes, attrPath);
  if (fromLine !== undefined) return fromLine;
  return getByPath(entity.attributes, attrPath);
}

function ruleSatisfied(profile: InsuranceProfile, rule: RequiredFieldRule): boolean {
  const { path } = rule;

  if (path === "requestedCoverage") {
    return profile.coverageSections.length > 0;
  }

  if (path.startsWith("entity:")) {
    const rest = path.slice("entity:".length);
    const [type, ...attrParts] = rest.split(".");
    const matches = profile.insuredEntities.filter((e) => e.entityType === type);
    if (matches.length === 0) return false;
    if (attrParts.length === 0) return true; // just need one of that type
    const attrPath = attrParts.join(".");
    return matches.every((e) => isPresent(entityAttr(e, attrPath)));
  }

  return isPresent(getByPath(profile, path));
}

/**
 * Evaluate a profile against required-field rules. Returns the completeness
 * score, the list of missing rule paths, and whether the profile is quote-ready.
 * quoteReady is true only when every required field is satisfied.
 */
export function computeCompleteness(
  profile: InsuranceProfile,
  requiredRules: RequiredFieldRule[]
): CompletenessResult {
  if (requiredRules.length === 0) {
    return { completenessScore: 1, missingFields: [], quoteReady: true };
  }

  const missingFields: string[] = [];
  for (const rule of requiredRules) {
    if (!ruleSatisfied(profile, rule)) missingFields.push(rule.path);
  }

  const satisfied = requiredRules.length - missingFields.length;
  const completenessScore = satisfied / requiredRules.length;

  return {
    completenessScore,
    missingFields,
    quoteReady: missingFields.length === 0,
  };
}
