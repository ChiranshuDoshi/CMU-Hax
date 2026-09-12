import { z } from "zod";

import { selectVerifiedLeverage } from "@/domain/negotiation";
import {
  EvidenceSchema,
  NegotiationHandoffSchema,
  NormalizedQuoteSchema,
  ProviderRankingResultSchema,
  RecommendationSchema,
  type Evidence,
  type NegotiationHandoff,
  type NormalizedQuote,
} from "@/domain/schemas/person4";

const QUALIFYING_COVERAGE_STATUSES = new Set(["equivalent", "better_than_requested"]);
const REQUIRED_TOP_FIVE_COUNT = 5;

const BuildNegotiationHandoffInputSchema = z
  .strictObject({
    recommendation: RecommendationSchema,
    providerRanking: ProviderRankingResultSchema,
    quotes: z.array(NormalizedQuoteSchema).length(REQUIRED_TOP_FIVE_COUNT),
    evidence: z.array(EvidenceSchema),
    generatedAt: z.date(),
  })
  .superRefine((input, context) => {
    const { providerRanking, recommendation } = input;

    if (!Number.isFinite(input.generatedAt.getTime())) {
      context.addIssue({ code: "custom", path: ["generatedAt"], message: "generatedAt must be a valid date" });
    }
    if (providerRanking.workflowId !== recommendation.workflowId) {
      context.addIssue({
        code: "custom",
        path: ["providerRanking", "workflowId"],
        message: "provider ranking workflow must match the recommendation workflow",
      });
    }
    if (providerRanking.specificationHash !== recommendation.specificationHash) {
      context.addIssue({
        code: "custom",
        path: ["providerRanking", "specificationHash"],
        message: "provider ranking specification hash must match the recommendation specification hash",
      });
    }

    if (providerRanking.selected.length !== REQUIRED_TOP_FIVE_COUNT) {
      context.addIssue({
        code: "custom",
        path: ["providerRanking", "selected"],
        message: "provider ranking must contain exactly five selected providers",
      });
    }
    const selectedRanks = providerRanking.selected
      .map(({ topFiveRank }) => topFiveRank)
      .filter((rank): rank is number => rank !== null)
      .sort((left, right) => left - right);
    if (
      selectedRanks.length !== REQUIRED_TOP_FIVE_COUNT ||
      selectedRanks.some((rank, index) => rank !== index + 1)
    ) {
      context.addIssue({
        code: "custom",
        path: ["providerRanking", "selected"],
        message: "selected providers must have unique Top Five ranks 1 through 5",
      });
    }

    const quoteIds = new Set<string>();
    const quoteProviderIds = new Set<string>();
    const providersById = new Map<string, string>();
    providerRanking.selected.forEach((provider, index) => {
      if (providersById.has(provider.providerId)) {
        context.addIssue({
          code: "custom",
          path: ["providerRanking", "selected", index, "providerId"],
          message: "Top Five provider IDs must be unique",
        });
      }
      providersById.set(provider.providerId, provider.providerName);
    });

    input.quotes.forEach((quote, index) => {
      if (quoteIds.has(quote.quoteId)) {
        context.addIssue({
          code: "custom",
          path: ["quotes", index, "quoteId"],
          message: "quote IDs must be unique",
        });
      }
      quoteIds.add(quote.quoteId);

      if (quoteProviderIds.has(quote.providerId)) {
        context.addIssue({
          code: "custom",
          path: ["quotes", index, "providerId"],
          message: "each Top Five provider must have exactly one quote",
        });
      }
      quoteProviderIds.add(quote.providerId);

      if (quote.workflowId !== recommendation.workflowId) {
        context.addIssue({
          code: "custom",
          path: ["quotes", index, "workflowId"],
          message: "quote workflow must match the recommendation workflow",
        });
      }
      if (quote.specificationHash !== recommendation.specificationHash) {
        context.addIssue({
          code: "custom",
          path: ["quotes", index, "specificationHash"],
          message: "quote specification hash must match the recommendation specification hash",
        });
      }
      if (quote.confirmedRequestId !== providerRanking.quoteRequestId) {
        context.addIssue({
          code: "custom",
          path: ["quotes", index, "confirmedRequestId"],
          message: "quote request ID must match the provider ranking quote request ID",
        });
      }
      if (!providersById.has(quote.providerId)) {
        context.addIssue({
          code: "custom",
          path: ["quotes", index, "providerId"],
          message: "quote provider must resolve from the Top Five provider ranking",
        });
      }
    });

    for (const providerId of providersById.keys()) {
      if (!quoteProviderIds.has(providerId)) {
        context.addIssue({
          code: "custom",
          path: ["quotes"],
          message: `quote is missing for Top Five provider ${providerId}`,
        });
      }
    }

    const evidenceIds = new Set<string>();
    const evidenceById = new Map<string, Evidence>();
    input.evidence.forEach((evidence, index) => {
      if (evidenceIds.has(evidence.id)) {
        context.addIssue({
          code: "custom",
          path: ["evidence", index, "id"],
          message: "evidence IDs must be unique",
        });
      }
      evidenceIds.add(evidence.id);
      evidenceById.set(evidence.id, evidence);
    });

    const recommendedQuoteId = recommendation.recommendedQuoteId;
    if (recommendedQuoteId === null) {
      context.addIssue({
        code: "custom",
        path: ["recommendation", "recommendedQuoteId"],
        message: "a qualifying system recommendation is required for negotiation handoff",
      });
      return;
    }

    const rankedMatches = recommendation.rankedQualifyingQuotes.filter(
      (rankedQuote) => rankedQuote.quoteId === recommendedQuoteId,
    );
    const quoteMatches = input.quotes.filter((quote) => quote.quoteId === recommendedQuoteId);
    if (rankedMatches.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["recommendation", "rankedQualifyingQuotes"],
        message: "recommended quote ID must resolve exactly once in the ranked qualifying quotes",
      });
    }
    if (quoteMatches.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["quotes"],
        message: "recommended quote ID must resolve exactly once in normalized quotes",
      });
      return;
    }

    const rankedQuote = rankedMatches[0];
    const quote = quoteMatches[0];
    if (rankedQuote) {
      if (rankedQuote.rank !== 1 || recommendation.rankedQualifyingQuotes[0]?.quoteId !== recommendedQuoteId) {
        context.addIssue({
          code: "custom",
          path: ["recommendation", "recommendedQuoteId"],
          message: "the system recommendation must be the first-ranked qualifying quote",
        });
      }
      if (rankedQuote.providerId !== quote.providerId) {
        context.addIssue({
          code: "custom",
          path: ["recommendation", "rankedQualifyingQuotes"],
          message: "ranked recommendation provider must match the normalized quote provider",
        });
      }
      if (rankedQuote.effectiveCostCents !== quote.effectiveComparisonCostCents) {
        context.addIssue({
          code: "custom",
          path: ["recommendation", "rankedQualifyingQuotes"],
          message: "ranked recommendation cost must match the normalized quote cost",
        });
      }
    }

    addRecommendedQuoteIssues(quote, evidenceById, input.generatedAt, context);
  });

export interface BuildNegotiationHandoffInput {
  recommendation: unknown;
  providerRanking: unknown;
  quotes: readonly unknown[];
  evidence: readonly unknown[];
  generatedAt: Date;
}

function addRecommendedQuoteIssues(
  quote: NormalizedQuote,
  evidenceById: ReadonlyMap<string, Evidence>,
  generatedAt: Date,
  context: z.RefinementCtx,
): void {
  const path = ["quotes", quote.quoteId];
  const addIssue = (field: string, message: string) =>
    context.addIssue({ code: "custom", path: [...path, field], message });

  if (quote.sourceType !== "conversation") addIssue("sourceType", "recommended quote must come from a quote-collection conversation");
  if (!quote.sourceConversationId) addIssue("sourceConversationId", "conversation quote must identify its source conversation");
  if (quote.sourceArtifactId) addIssue("sourceArtifactId", "conversation quote cannot reference an external artifact");
  if (quote.scenarioId) addIssue("scenarioId", "conversation quote cannot identify an offline scenario");
  if (quote.simulated !== true) addIssue("simulated", "recommended quote must be simulated");
  if (!quote.currency) addIssue("currency", "recommended quote must identify its currency");
  if (!quote.disclaimer) addIssue("disclaimer", "recommended quote must include the simulation disclaimer");
  if (
    quote.disclaimer &&
    (!/simulated/iu.test(quote.disclaimer) || !/not binding/iu.test(quote.disclaimer))
  ) {
    addIssue("disclaimer", "simulation disclaimer must say the quote is simulated and not binding");
  }
  if (!quote.quoteValidUntil) {
    addIssue("quoteValidUntil", "recommended quote must include a structured validity deadline");
  } else if (Date.parse(quote.quoteValidUntil) <= generatedAt.getTime()) {
    addIssue("quoteValidUntil", "recommended quote is stale");
  }
  if (quote.effectiveComparisonCostCents === null || quote.effectiveComparisonCostCents <= 0) {
    addIssue("effectiveComparisonCostCents", "recommended quote must have a positive effective comparison cost");
  }
  if (quote.annualizedCostCents !== null && quote.annualizedCostCents <= 0) {
    addIssue("annualizedCostCents", "annualized cost must be positive when present");
  }
  if (quote.policyTermMonths === null) addIssue("policyTermMonths", "recommended quote must identify its policy term");
  if (quote.evidenceIds.length === 0) addIssue("evidenceIds", "recommended quote must include evidence");
  if (!quote.requiresHumanVerification) {
    addIssue("requiresHumanVerification", "simulated recommendation must remain marked for human verification");
  }
  for (const evidenceId of quote.evidenceIds) {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence) {
      addIssue("evidenceIds", `simulated call evidence ${evidenceId} is missing`);
      continue;
    }
    if (
      evidence.workflowId !== quote.workflowId ||
      evidence.type !== "transcript" ||
      evidence.verificationStatus !== "user_confirmed" ||
      evidence.sourceId !== quote.sourceConversationId
    ) {
      addIssue("evidenceIds", `conversation evidence ${evidenceId} has invalid provenance`);
    }
  }
  if (quote.status !== "complete") addIssue("status", "recommended quote must be complete");
  if (!QUALIFYING_COVERAGE_STATUSES.has(quote.coverageEquivalence.status)) {
    addIssue("coverageEquivalence", "recommended quote must have equivalent-or-better coverage");
  }
  if (quote.redFlags.some(({ severity }) => severity === "blocking")) {
    addIssue("redFlags", "recommended quote cannot contain a blocking red flag");
  }
}

export function buildNegotiationHandoff(input: BuildNegotiationHandoffInput): NegotiationHandoff {
  const validated = BuildNegotiationHandoffInputSchema.parse(input);
  const recommendation = validated.recommendation;
  const recommendedQuoteId = recommendation.recommendedQuoteId;

  if (recommendedQuoteId === null) {
    throw new TypeError("a qualifying system recommendation is required for negotiation handoff");
  }

  const rankedQuote = recommendation.rankedQualifyingQuotes.find(({ quoteId }) => quoteId === recommendedQuoteId);
  const recommendedQuote = validated.quotes.find(({ quoteId }) => quoteId === recommendedQuoteId);
  if (!rankedQuote || !recommendedQuote) {
    throw new TypeError("recommended quote could not be resolved after validation");
  }

  const providersById = new Map(
    validated.providerRanking.selected.map((provider) => [provider.providerId, provider.providerName]),
  );
  const providerName = providersById.get(recommendedQuote.providerId);
  if (!providerName) throw new TypeError("recommended provider could not be resolved after validation");

  const target = {
    providerId: recommendedQuote.providerId,
    providerName,
    quoteId: recommendedQuote.quoteId,
    scenarioId: recommendedQuote.scenarioId,
    sourceConversationId: recommendedQuote.sourceConversationId,
    currency: recommendedQuote.currency,
    effectiveComparisonCostCents: recommendedQuote.effectiveComparisonCostCents,
    annualizedCostCents: recommendedQuote.annualizedCostCents,
    policyTermMonths: recommendedQuote.policyTermMonths,
    quoteValidUntil: recommendedQuote.quoteValidUntil,
    coverageEquivalence: recommendedQuote.coverageEquivalence,
    recommendationScore: rankedQuote.scoreBreakdown.weightedTotal,
    selectionExplanation: rankedQuote.explanation,
    evidenceIds: recommendedQuote.evidenceIds,
    simulated: true as const,
    requiresHumanVerification: true as const,
    disclaimer: recommendedQuote.disclaimer,
  };

  const leverage = recommendedQuote.simulated
    ? { status: "no_leverage_available" as const }
    : selectVerifiedLeverage({
        selectedQuote: recommendedQuote,
        candidateQuotes: validated.quotes.filter(({ quoteId }) => quoteId !== recommendedQuoteId),
        evidence: validated.evidence,
        now: validated.generatedAt,
      });

  let verifiedCompetingQuote: NegotiationHandoff["verifiedCompetingQuote"] = null;
  if (leverage.status === "selected") {
    const quote = validated.quotes.find(({ quoteId }) => quoteId === leverage.quoteId);
    const competitorProviderName = providersById.get(leverage.providerId);
    if (!quote || !competitorProviderName) {
      throw new TypeError("verified competing quote could not be resolved after validation");
    }

    verifiedCompetingQuote = {
      providerId: leverage.providerId,
      providerName: competitorProviderName,
      quoteId: leverage.quoteId,
      effectiveComparisonCostCents: leverage.effectiveComparisonCostCents,
      coverageEquivalence: quote.coverageEquivalence,
      evidenceIds: leverage.evidenceIds,
    };
  }

  return NegotiationHandoffSchema.parse({
    workflowId: recommendation.workflowId,
    specificationHash: recommendation.specificationHash,
    target,
    verifiedCompetingQuote,
    requestedOutcome: "lower_price_with_same_or_better_coverage",
    selectionSource: "system_recommendation",
    generatedAt: validated.generatedAt.toISOString(),
  });
}
