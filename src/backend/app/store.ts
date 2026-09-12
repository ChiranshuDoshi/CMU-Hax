import { createHash, randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";

import type {
  ConfirmedQuoteRequest,
  NegotiationHandoff,
  ProviderRankingResult,
} from "@/domain/schemas/person4";

export interface Account {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly createdAt: string;
  readonly workflowId: string;
}

export type WorkflowStage =
  | "profile"
  | "research_ready"
  | "quotes_ready"
  | "negotiating"
  | "result";

export interface ResearchProviderView {
  providerId: string;
  providerName: string;
  rank: number;
  rating: number | null;
  reviewCount: number | null;
  website: string | null;
  eligibility: string;
}

export interface QuoteView {
  quoteId: string;
  providerId: string;
  providerName: string;
  rank: number;
  rating: number | null;
  reviewCount: number | null;
  effectiveComparisonCostCents: number | null;
  annualizedCostCents: number | null;
  monthlyCents: number | null;
  deductibleCents: number | null;
  coverageEquivalence: string;
  redFlags: string[];
  recommended: boolean;
}

export interface NegotiationStepView {
  label: string;
  amountCents: number;
  time: string;
  impactCents: number | null;
}

export interface TranscriptLineView {
  time: string;
  speaker: string;
  text: string;
}

export type NegotiationCallStatus =
  | "idle"
  | "ringing"
  | "dialing"
  | "in_progress"
  | "processing"
  | "completed"
  | "failed";

export interface NegotiationResultView {
  selectedQuoteId: string;
  providerId: string;
  providerName: string;
  targetAmountCents: number;
  originalCents: number;
  finalCents: number;
  savingsCents: number;
  savingsPct: number;
  targetMet: boolean;
  steps: NegotiationStepView[];
  transcript: TranscriptLineView[];
  mode: "simulated" | "live";
  // Live-call tracking (mode === "live").
  callStatus: NegotiationCallStatus;
  conversationId: string | null;
  callSid: string | null;
  recordingAvailable: boolean;
  callSummary: string | null;
  errorMessage: string | null;
  // Exact final price the agent recorded via record_negotiation_event, if any.
  recordedFinalCents: number | null;
}

export interface WorkflowState {
  workflowId: string;
  accountId: string;
  createdAt: string;
  updatedAt: string;
  stage: WorkflowStage;
  profile: Record<string, unknown> | null;
  confirmedRequest: ConfirmedQuoteRequest | null;
  research: {
    providers: ResearchProviderView[];
    evaluatedAt: string;
    live: boolean;
  } | null;
  ranking: ProviderRankingResult | null;
  quotes: QuoteView[] | null;
  recommendedQuoteId: string | null;
  handoff: NegotiationHandoff | null;
  negotiation: NegotiationResultView | null;
}

const ACCOUNT_KEY_PREFIX = "policyscout:account:";
const WORKFLOW_KEY_PREFIX = "policyscout:workflow:";
const LIVE_CALL_ACCOUNT_QUOTA_PREFIX = "policyscout:live-call:account:";
const LIVE_CALL_IP_QUOTA_PREFIX = "policyscout:live-call:ip:";
export const WORKFLOW_RETENTION_SECONDS = 60 * 60 * 24 * 7;
const LIVE_CALL_QUOTA_WINDOW_SECONDS = 15 * 60;
const MAX_LIVE_CALL_STARTS_PER_ACCOUNT = 3;
const MAX_LIVE_CALL_STARTS_PER_IP = 12;

export class WorkflowStoreError extends Error {
  constructor(
    readonly code: "PERSISTENCE_NOT_CONFIGURED" | "PERSISTENCE_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "WorkflowStoreError";
  }
}

export class LiveCallRateLimitError extends Error {
  readonly code = "CALL_RATE_LIMITED";
  readonly status = 429;

  constructor() {
    super("Too many negotiation calls were started. Please try again shortly.");
    this.name = "LiveCallRateLimitError";
  }
}

let cachedRedis: Redis | null = null;

function redisConfigured(): boolean {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return Boolean(url?.trim() && token?.trim());
}

function redis(): Redis {
  if (!redisConfigured()) {
    throw new WorkflowStoreError(
      "PERSISTENCE_NOT_CONFIGURED",
      "Workflow storage is not configured. Set the Upstash Redis environment variables.",
    );
  }
  return (cachedRedis ??= Redis.fromEnv());
}

async function withPersistence<T>(operation: (client: Redis) => Promise<T>): Promise<T> {
  try {
    return await operation(redis());
  } catch (error) {
    if (error instanceof WorkflowStoreError || error instanceof LiveCallRateLimitError) throw error;
    throw new WorkflowStoreError(
      "PERSISTENCE_UNAVAILABLE",
      "Workflow storage is temporarily unavailable. Please try again.",
    );
  }
}

function accountKey(accountId: string): string {
  return `${ACCOUNT_KEY_PREFIX}${accountId}`;
}

function workflowKey(workflowId: string): string {
  return `${WORKFLOW_KEY_PREFIX}${workflowId}`;
}

function quotaKey(prefix: string, identifier: string): string {
  return `${prefix}${createHash("sha256").update(identifier).digest("hex")}`;
}

async function incrementQuota(client: Redis, key: string): Promise<number> {
  const starts = await client.incr(key);
  if (starts === 1) await client.expire(key, LIVE_CALL_QUOTA_WINDOW_SECONDS);
  return starts;
}

export async function getAccount(id: string): Promise<Account | null> {
  return withPersistence((client) => client.get<Account>(accountKey(id)));
}

export async function getWorkflow(id: string): Promise<WorkflowState | null> {
  return withPersistence((client) => client.get<WorkflowState>(workflowKey(id)));
}

export async function createAccount(displayName: string, email: string): Promise<Account> {
  const id = `acct_${randomUUID()}`;
  const workflowId = `wf_${randomUUID().replace(/-/g, "")}`;
  const now = new Date().toISOString();
  const account: Account = { id, displayName, email, createdAt: now, workflowId };
  const workflow: WorkflowState = {
    workflowId,
    accountId: id,
    createdAt: now,
    updatedAt: now,
    stage: "profile",
    profile: null,
    confirmedRequest: null,
    research: null,
    ranking: null,
    quotes: null,
    recommendedQuoteId: null,
    handoff: null,
    negotiation: null,
  };

  await withPersistence(async (client) => {
    await client
      .multi()
      .set(accountKey(account.id), account, { ex: WORKFLOW_RETENTION_SECONDS })
      .set(workflowKey(workflow.workflowId), workflow, { ex: WORKFLOW_RETENTION_SECONDS })
      .exec();
  });
  return account;
}

/** Persists a workflow after an API route applies a state transition. */
export async function saveWorkflow(workflow: WorkflowState): Promise<void> {
  await withPersistence(async (client) => {
    await client.set(workflowKey(workflow.workflowId), workflow, { ex: WORKFLOW_RETENTION_SECONDS });
  });
}

/** Reserves a browser-call start before a provider credential is minted. */
export async function reserveLiveCallStart(accountId: string, clientIp: string | null): Promise<void> {
  await withPersistence(async (client) => {
    const accountStarts = await incrementQuota(client, quotaKey(LIVE_CALL_ACCOUNT_QUOTA_PREFIX, accountId));
    const ipStarts = clientIp
      ? await incrementQuota(client, quotaKey(LIVE_CALL_IP_QUOTA_PREFIX, clientIp))
      : 0;
    if (accountStarts > MAX_LIVE_CALL_STARTS_PER_ACCOUNT || ipStarts > MAX_LIVE_CALL_STARTS_PER_IP) {
      throw new LiveCallRateLimitError();
    }
  });
}

export function touch(workflow: WorkflowState): void {
  workflow.updatedAt = new Date().toISOString();
}
