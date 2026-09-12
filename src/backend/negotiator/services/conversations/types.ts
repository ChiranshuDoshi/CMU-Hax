import type { NegotiationHandoff, NegotiationGoal } from "@/domain/schemas/person4";
import type { ConversationPurpose } from "@/integrations/elevenlabs";

export const CONVERSATION_STATES = [
  "idle",
  "connecting",
  "active",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;

export type ConversationState = (typeof CONVERSATION_STATES)[number];

export interface ExplicitQuoteSelection {
  readonly quoteId: string;
  readonly providerId: string;
  readonly specificationHash: string;
  readonly selectedAt: string;
}

export interface NegotiationReference {
  readonly workflowId: string;
  readonly providerId: string;
  readonly quoteId: string;
  readonly specificationHash: string;
  readonly selectedAt: string;
}

export interface NegotiationSessionInput {
  readonly participant: {
    readonly displayName: string;
  };
  readonly handoff: NegotiationHandoff;
  readonly goal: NegotiationGoal;
  readonly explicitSelection?: ExplicitQuoteSelection;
}

export interface QuoteCollectionReference {
  readonly collectionId: string;
  readonly workflowId: string;
  readonly providerId: string;
  readonly specificationHash: string;
}

export interface QuoteCollectionSessionInput {
  readonly collectionId: string;
  readonly workflowId: string;
  readonly specificationHash: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly providerSafeBrief: string;
}

export type SafeQuoteCollectionContext = QuoteCollectionSessionInput;

export interface QuoteCapture {
  readonly totalPolicyTermCostCents: number;
  readonly policyTermMonths: number;
  readonly feesAndTaxesIncluded: true;
  readonly coverageMatchesRequested: true;
  readonly effectiveDate: string;
  readonly quoteValidUntil: string;
  readonly providerResponse: string;
}

export interface SafeNegotiationContext {
  readonly userDisplayName: string;
  readonly workflowId: string;
  readonly specificationHash: string;
  readonly negotiationGoalId: string;
  readonly selectedQuoteId: string;
  readonly targetProviderId: string;
  readonly selectedProviderName: string;
  readonly currentMonthlyEffectiveCostCents: number | null;
  readonly currentPolicyPeriodEffectiveCostCents: number;
  readonly lowestVerifiedComparableMonthlyEffectiveCostCents: number | null;
  readonly allowedLeverageText: string;
  readonly coverageSummary: string;
  readonly aiDisclosure: string;
  readonly disclaimer: string;
  readonly simulated: true;
  readonly requiresHumanVerification: true;
}

export interface ConversationSession {
  readonly id: string;
  readonly purpose: ConversationPurpose;
  readonly state: ConversationState;
  readonly retryCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly conversationId: string | null;
  readonly transcript: readonly TranscriptEntry[];
  readonly errorCode: string | null;
  readonly negotiation: SafeNegotiationContext | null;
  readonly quoteCollection: SafeQuoteCollectionContext | null;
}

export interface TranscriptEntry {
  readonly role: "user" | "agent";
  readonly message: string;
  readonly recordedAt: string;
}
