import type {
  ConfirmedQuoteRequest,
  RawResearchCandidate,
} from "@/domain/schemas/person4";

export const ELIGIBILITY_REASONS = {
  excludedByUser: "Excluded by the user.",
  insuranceLine: "Does not offer every requested insurance line.",
  state: "Does not serve the confirmed state.",
  zipCode: "Does not serve the confirmed ZIP code.",
  coverage: "Does not support every required coverage at a preliminary product level.",
  contact: "Does not have usable public contact information.",
  citations: "Does not have usable research citations.",
} as const;

function normalizedZip(zipCode: string): string {
  return zipCode.trim();
}

function excludesZip(candidate: RawResearchCandidate, requestZipCode: string): boolean {
  const requestZip = normalizedZip(requestZipCode);
  const requestBaseZip = requestZip.slice(0, 5);

  return candidate.excludedZipCodes.some((excludedZipCode) => {
    const exclusion = normalizedZip(excludedZipCode);
    return exclusion === requestZip || (exclusion.length === 5 && exclusion === requestBaseZip);
  });
}

export function getEligibilityReasons(
  candidate: RawResearchCandidate,
  request: ConfirmedQuoteRequest,
): string[] {
  const reasons: string[] = [];
  const excludedProviderIds = new Set(request.excludedProviderIds);
  const offeredLines = new Set(candidate.insuranceLines);
  const requiredCoverageCodes = request.requestedCoverage
    .filter((coverage) => coverage.required)
    .map((coverage) => coverage.coverageCode);
  const supportedCoverageCodes = new Set(candidate.preliminaryCoverageCodes);
  const stateSupported =
    candidate.nationwide ||
    candidate.states.some((state) => state.toUpperCase() === request.state.toUpperCase());

  if (excludedProviderIds.has(candidate.providerId)) reasons.push(ELIGIBILITY_REASONS.excludedByUser);
  if (!request.insuranceLines.every((line) => offeredLines.has(line))) {
    reasons.push(ELIGIBILITY_REASONS.insuranceLine);
  }
  if (!stateSupported) reasons.push(ELIGIBILITY_REASONS.state);
  if (excludesZip(candidate, request.zipCode)) reasons.push(ELIGIBILITY_REASONS.zipCode);
  if (!requiredCoverageCodes.every((code) => supportedCoverageCodes.has(code))) {
    reasons.push(ELIGIBILITY_REASONS.coverage);
  }
  if (!candidate.publicContact?.trim() && candidate.website === null) {
    reasons.push(ELIGIBILITY_REASONS.contact);
  }
  if (candidate.sources.length === 0) reasons.push(ELIGIBILITY_REASONS.citations);

  return reasons;
}
