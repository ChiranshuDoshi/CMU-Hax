import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { z } from "zod";

import { buildNegotiationHandoff } from "@/domain/handoff";
import { normalizeQuote } from "@/domain/normalization";
import { buildRecommendation } from "@/domain/recommendation";
import { addComparableMedianOutlierFlags } from "@/domain/red-flags";
import {
  ConfirmedQuoteRequestSchema,
  ProviderRankingResultSchema,
  RawQuoteOutcomeSchema,
  type ConfirmedQuoteRequest,
  type Evidence,
  type NegotiationHandoff,
  type NormalizedQuote,
  type RawQuoteOutcome,
} from "@/domain/schemas/person4";

import {
  buildDemoQuoteScenarioCall,
  type DemoQuoteTranscriptLabel,
} from "./demo-quote-scenario";
import { ConversationInvariantError } from "./negotiation-context";
import type {
  ConversationSession,
  QuoteCapture,
  QuoteCollectionReference,
  QuoteCollectionSessionInput,
} from "./types";

const MAX_PREPARED_CONTEXT_BYTES = 512 * 1024;
const DEFAULT_PREPARED_CONTEXT_PATH = join(
  /* turbopackIgnore: true */ process.cwd(),
  ".artifacts",
  "person3",
  "quote-collection-session.json",
);
const ARTIFACT_ROOT = join(/* turbopackIgnore: true */ process.cwd(), ".artifacts");
const QUOTE_DISCLAIMER = "This simulated voice quote is not binding and requires human verification.";
const ARTIFACT_STAGE_DIRECTORY_PREFIX = ".quote-collection-stage-";
type QuoteCollectionArtifactFileName =
  | "raw-quotes.json"
  | "normalized-quotes.json"
  | "recommendation.json"
  | "person3-handoff.json"
  | "conversations.json";

interface QuoteCollectionArtifact {
  readonly fileName: QuoteCollectionArtifactFileName;
  readonly payload: unknown;
}

const QuoteCaptureSchema = z.strictObject({
  totalPolicyTermCostCents: z.number().int().positive(),
  policyTermMonths: z.number().int().positive().max(24),
  feesAndTaxesIncluded: z.literal(true),
  coverageMatchesRequested: z.literal(true),
  effectiveDate: z.string().date(),
  quoteValidUntil: z.string().datetime(),
  providerResponse: z.string().trim().min(1).max(4_000),
});

const PreparedQuoteCollectionContextSchema = z.strictObject({
  collectionId: z.string().min(1).max(128),
  quoteRequest: ConfirmedQuoteRequestSchema,
  providerRanking: ProviderRankingResultSchema,
  providerSafeBrief: z.string().trim().min(1).max(8_000),
  artifactDirectory: z.string().min(1).max(1_024),
  createdAt: z.string().datetime(),
});

type PreparedQuoteCollectionContext = z.infer<typeof PreparedQuoteCollectionContextSchema>;

export interface QuoteCollectionContextLoader {
  load(): Promise<unknown>;
}

export type QuoteCollectionResultPersister = (
  collection: ActiveQuoteCollection,
  rawQuotes: readonly RawQuoteOutcome[],
  normalized: readonly NormalizedQuote[],
  recommendation: unknown,
  handoff: NegotiationHandoff,
  conversations: readonly QuoteCollectionConversation[],
) => Promise<void>;

export class FixedFileQuoteCollectionContextLoader implements QuoteCollectionContextLoader {
  constructor(private readonly filePath = DEFAULT_PREPARED_CONTEXT_PATH) {}

  async load(): Promise<unknown> {
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      file = await open(this.filePath, "r");
      const stats = await file.stat();
      if (!stats.isFile() || stats.size > MAX_PREPARED_CONTEXT_BYTES) {
        throw new ConversationInvariantError("PREPARED_QUOTE_COLLECTION_INVALID", "Prepared quote collection is invalid");
      }
      const buffer = Buffer.alloc(MAX_PREPARED_CONTEXT_BYTES + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_PREPARED_CONTEXT_BYTES) {
        throw new ConversationInvariantError("PREPARED_QUOTE_COLLECTION_INVALID", "Prepared quote collection is invalid");
      }
      return JSON.parse(buffer.toString("utf8", 0, bytesRead)) as unknown;
    } catch (error) {
      if (error instanceof ConversationInvariantError) throw error;
      if (error instanceof SyntaxError) {
        throw new ConversationInvariantError("PREPARED_QUOTE_COLLECTION_INVALID", "Prepared quote collection is invalid");
      }
      throw new ConversationInvariantError("PREPARED_QUOTE_COLLECTION_UNAVAILABLE", "Prepared quote collection is unavailable");
    } finally {
      await file?.close().catch(() => undefined);
    }
  }
}

interface ActiveQuoteCollection {
  readonly context: PreparedQuoteCollectionContext;
  readonly quotesByProvider: Map<string, RawQuoteOutcome>;
  readonly conversationsByProvider: Map<string, QuoteCollectionConversation>;
  readonly issuedSessionsByProvider: Map<string, string>;
  simulationInProgress: boolean;
  simulationStarted: boolean;
  result: QuoteCollectionResult | null;
}

export interface QuoteCollectionProviderStatus {
  readonly providerId: string;
  readonly providerName: string;
  readonly status: "pending" | "active" | "captured";
  readonly effectiveComparisonCostCents: number | null;
}

export interface QuoteCollectionResult {
  readonly recommendedProviderName: string;
  readonly effectiveComparisonCostCents: number;
  readonly negotiationHandoff: NegotiationHandoff;
}

export type QuoteCollectionTranscriptLabel =
  | DemoQuoteTranscriptLabel
  | "caller_message"
  | "provider_message";

export interface QuoteCollectionTranscriptEntry {
  readonly label: QuoteCollectionTranscriptLabel;
  readonly role: "user" | "agent";
  readonly message: string;
  readonly recordedAt: string;
}

export interface QuoteCollectionConversation {
  readonly providerId: string;
  readonly providerName: string;
  readonly conversationId: string;
  readonly simulated: true;
  readonly transcript: readonly QuoteCollectionTranscriptEntry[];
}

export interface QuoteCollectionSimulationReference {
  readonly collectionId: string;
  readonly workflowId: string;
  readonly specificationHash: string;
}

export interface QuoteCollectionSnapshot {
  readonly collectionId: string;
  readonly workflowId: string;
  readonly specificationHash: string;
  readonly providers: readonly QuoteCollectionProviderStatus[];
  readonly conversations: readonly QuoteCollectionConversation[];
  readonly result: QuoteCollectionResult | null;
}

function displayCoverageName(coverageCode: string): string {
  return coverageCode
    .split(/[_-]+/u)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

function policyExpirationDate(effectiveDate: string, policyTermMonths: number): string {
  const [year, month, day] = effectiveDate.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  const expiration = new Date(start);
  expiration.setUTCMonth(expiration.getUTCMonth() + policyTermMonths);
  expiration.setUTCDate(expiration.getUTCDate() - 1);
  return expiration.toISOString().slice(0, 10);
}

function requireSafeArtifactDirectory(value: string): string {
  const directory = value;
  if (!directory.startsWith(`${ARTIFACT_ROOT}${sep}`)) {
    throw new ConversationInvariantError("INVALID_ARTIFACT_DIRECTORY", "Quote collection artifact directory is invalid");
  }
  const pathFromRoot = relative(ARTIFACT_ROOT, directory);
  if (pathFromRoot === "" || pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === "..") {
    throw new ConversationInvariantError("INVALID_ARTIFACT_DIRECTORY", "Quote collection artifact directory is invalid");
  }
  return directory;
}

async function ensureDirectoryWithoutSymlinks(directory: string): Promise<string> {
  await mkdir(ARTIFACT_ROOT, { recursive: true, mode: 0o700 });
  const rootStats = await lstat(ARTIFACT_ROOT);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new ConversationInvariantError("INVALID_ARTIFACT_DIRECTORY", "Quote collection artifact directory is invalid");
  }

  let current = ARTIFACT_ROOT;
  for (const segment of relative(ARTIFACT_ROOT, directory).split(sep).filter(Boolean)) {
    const next = join(current, segment);
    let stats;
    try {
      stats = await lstat(next);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      try {
        await mkdir(next, { mode: 0o700 });
      } catch (mkdirError) {
        if (!(mkdirError instanceof Error) || !("code" in mkdirError) || mkdirError.code !== "EEXIST") throw mkdirError;
      }
      stats = await lstat(next);
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new ConversationInvariantError("INVALID_ARTIFACT_DIRECTORY", "Quote collection artifact directory is invalid");
    }
    current = next;
  }
  return current;
}

function validateContext(value: unknown): PreparedQuoteCollectionContext {
  const parsed = PreparedQuoteCollectionContextSchema.safeParse(value);
  if (!parsed.success) {
    throw new ConversationInvariantError("PREPARED_QUOTE_COLLECTION_INVALID", "Prepared quote collection is invalid");
  }
  const context = parsed.data;
  if (
    context.providerRanking.workflowId !== context.quoteRequest.workflowId ||
    context.providerRanking.quoteRequestId !== context.quoteRequest.id ||
    context.providerRanking.specificationHash !== context.quoteRequest.specificationHash ||
    context.providerRanking.selected.length !== 5
  ) {
    throw new ConversationInvariantError("PREPARED_QUOTE_COLLECTION_INVALID", "Prepared quote collection is invalid");
  }
  const providers = context.providerRanking.selected.map((provider) => provider.providerId);
  if (new Set(providers).size !== providers.length) {
    throw new ConversationInvariantError("PREPARED_QUOTE_COLLECTION_INVALID", "Prepared quote collection is invalid");
  }
  const topFiveRanks = context.providerRanking.selected.map((provider) => provider.topFiveRank);
  if (
    topFiveRanks.some((rank) => rank === null || rank < 1 || rank > 5) ||
    new Set(topFiveRanks).size !== topFiveRanks.length
  ) {
    throw new ConversationInvariantError("PREPARED_QUOTE_COLLECTION_INVALID", "Prepared quote collection is invalid");
  }
  requireSafeArtifactDirectory(context.artifactDirectory);
  return context;
}

function createActiveCollection(context: PreparedQuoteCollectionContext): ActiveQuoteCollection {
  return {
    context,
    quotesByProvider: new Map(),
    conversationsByProvider: new Map(),
    issuedSessionsByProvider: new Map(),
    simulationInProgress: false,
    simulationStarted: false,
    result: null,
  };
}

function safeCallContext(
  context: PreparedQuoteCollectionContext,
  providerId: string,
): QuoteCollectionSessionInput {
  const provider = context.providerRanking.selected.find((candidate) => candidate.providerId === providerId);
  if (!provider) {
    throw new ConversationInvariantError("QUOTE_PROVIDER_NOT_SELECTED", "Provider is not in the current Top Five");
  }
  return Object.freeze({
    collectionId: context.collectionId,
    workflowId: context.quoteRequest.workflowId,
    specificationHash: context.quoteRequest.specificationHash,
    providerId: provider.providerId,
    providerName: provider.providerName,
    providerSafeBrief: context.providerSafeBrief,
  });
}

function transcriptEntryForCapture(session: ConversationSession, providerResponse: string): string {
  const userMessages = session.transcript.filter((entry) => entry.role === "user").map((entry) => entry.message);
  const matching = userMessages.find((message) => message.includes(providerResponse) || providerResponse.includes(message));
  const latest = userMessages.at(-1);
  if (!matching && !latest) {
    throw new ConversationInvariantError("QUOTE_EVIDENCE_MISSING", "A provider transcript response is required before recording a quote");
  }
  return matching ?? latest!;
}

function parseQuoteCapture(value: unknown): QuoteCapture {
  const parsed = QuoteCaptureSchema.parse(value);
  if (Date.parse(parsed.quoteValidUntil) <= Date.now()) {
    throw new ConversationInvariantError("QUOTE_VALIDITY_INVALID", "Quote validity must be in the future");
  }
  return parsed;
}

function buildCapturedConversation(
  callContext: QuoteCollectionSessionInput,
  conversationId: string,
  transcript: readonly QuoteCollectionTranscriptEntry[],
): QuoteCollectionConversation {
  return Object.freeze({
    providerId: callContext.providerId,
    providerName: callContext.providerName,
    conversationId,
    simulated: true,
    transcript: Object.freeze(transcript.map((entry) => Object.freeze({ ...entry }))),
  });
}

function labelCapturedTranscript(session: ConversationSession): readonly QuoteCollectionTranscriptEntry[] {
  return Object.freeze(session.transcript.map((entry) => Object.freeze({
    ...entry,
    label: entry.role === "agent" ? "provider_message" as const : "caller_message" as const,
  })));
}

function buildQuote(
  quoteRequest: ConfirmedQuoteRequest,
  callContext: QuoteCollectionSessionInput,
  capture: QuoteCapture,
  conversationId: string,
  providerTranscript: string,
  capturedAt: string,
): RawQuoteOutcome {
  const quoteId = `${quoteRequest.id}:conversation:${callContext.providerId}:${conversationId}`;
  const evidencePrefix = `${quoteId}:evidence`;
  const priceEvidenceId = `${evidencePrefix}:price`;
  const feesEvidenceId = `${evidencePrefix}:fees-and-taxes`;
  const coverageEvidenceId = `${evidencePrefix}:coverage`;
  const evidence = [
    {
      id: priceEvidenceId,
      workflowId: quoteRequest.workflowId,
      type: "transcript" as const,
      sourceId: conversationId,
      claimKey: "all-in policy-term quoted total",
      claimValue: { amountCents: capture.totalPolicyTermCostCents, currency: "USD" },
      pageNumber: null,
      transcriptStartMs: null,
      transcriptEndMs: null,
      speaker: "simulated_demo_participant",
      excerpt: providerTranscript,
      url: null,
      retrievedAt: capturedAt,
      confidence: 0.9,
      verificationStatus: "user_confirmed" as const,
    },
    {
      id: feesEvidenceId,
      workflowId: quoteRequest.workflowId,
      type: "transcript" as const,
      sourceId: conversationId,
      claimKey: "fees_and_taxes_included_in_stated_total",
      claimValue: true,
      pageNumber: null,
      transcriptStartMs: null,
      transcriptEndMs: null,
      speaker: "simulated_demo_participant",
      excerpt: providerTranscript,
      url: null,
      retrievedAt: capturedAt,
      confidence: 0.9,
      verificationStatus: "user_confirmed" as const,
    },
    {
      id: coverageEvidenceId,
      workflowId: quoteRequest.workflowId,
      type: "transcript" as const,
      sourceId: conversationId,
      claimKey: "requested coverage matches quote",
      claimValue: true,
      pageNumber: null,
      transcriptStartMs: null,
      transcriptEndMs: null,
      speaker: "simulated_demo_participant",
      excerpt: providerTranscript,
      url: null,
      retrievedAt: capturedAt,
      confidence: 0.9,
      verificationStatus: "user_confirmed" as const,
    },
  ];

  return RawQuoteOutcomeSchema.parse({
    quoteId,
    workflowId: quoteRequest.workflowId,
    providerId: callContext.providerId,
    sourceType: "conversation",
    sourceConversationId: conversationId,
    sourceArtifactId: null,
    scenarioId: null,
    confirmedRequestId: quoteRequest.id,
    specificationHash: quoteRequest.specificationHash,
    status: "complete",
    quoteType: "simulated",
    effectiveDate: capture.effectiveDate,
    expirationDate: policyExpirationDate(capture.effectiveDate, capture.policyTermMonths),
    quoteValidUntil: capture.quoteValidUntil,
    policyTermMonths: capture.policyTermMonths,
    premiumComponents: [{
      category: "premium",
      label: "All-in policy-term quoted total",
      amountCents: capture.totalPolicyTermCostCents,
      frequency: "policy_term",
      termCount: 1,
      required: true,
      conditional: false,
      refundable: false,
      includedInQuotedTotal: false,
      evidenceId: priceEvidenceId,
    }],
    feeComponents: [],
    taxComponents: [],
    discounts: [],
    coverageItems: quoteRequest.requestedCoverage.map((coverage) => ({
      coverageCode: coverage.coverageCode,
      coverageName: displayCoverageName(coverage.coverageCode),
      insuredEntityIds: [...coverage.insuredEntityIds],
      limitCents: coverage.minimumLimitCents,
      deductibleCents: coverage.maximumDeductibleCents,
      included: true,
      exclusions: [],
      evidenceIds: [coverageEvidenceId],
    })),
    coveredEntityIds: [...quoteRequest.insuredEntityIds],
    downPaymentCents: null,
    paymentOptions: [],
    exclusions: [],
    conditions: [],
    evidence,
    currency: "USD",
    disclaimer: QUOTE_DISCLAIMER,
    simulated: true,
  });
}

async function assertSafeArtifactFile(path: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new ConversationInvariantError("INVALID_ARTIFACT_FILE", "Quote collection artifact file is invalid");
    }
  } catch (error) {
    if (error instanceof ConversationInvariantError) throw error;
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
}

async function createArtifactStageDirectory(directory: string): Promise<string> {
  const stageDirectory = join(directory, `${ARTIFACT_STAGE_DIRECTORY_PREFIX}${randomUUID()}`);
  await mkdir(stageDirectory, { mode: 0o700 });
  const stats = await lstat(stageDirectory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new ConversationInvariantError("INVALID_ARTIFACT_DIRECTORY", "Quote collection artifact directory is invalid");
  }
  return stageDirectory;
}

async function writeStagedArtifact(
  stageDirectory: string,
  artifact: QuoteCollectionArtifact,
): Promise<void> {
  const output = join(stageDirectory, artifact.fileName);
  const file = await open(
    output,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(`${JSON.stringify(artifact.payload, null, 2)}\n`, "utf8");
  } finally {
    await file.close();
  }
}

async function publishStagedArtifact(
  stageDirectory: string,
  directory: string,
  fileName: QuoteCollectionArtifactFileName,
): Promise<void> {
  const stagedFile = join(stageDirectory, fileName);
  await assertSafeArtifactFile(stagedFile);
  await assertSafeArtifactFile(join(directory, fileName));
  await rename(stagedFile, join(directory, fileName));
}

async function persistArtifactSet(
  directory: string,
  artifacts: readonly QuoteCollectionArtifact[],
): Promise<void> {
  const stageDirectory = await createArtifactStageDirectory(directory);
  try {
    for (const artifact of artifacts) {
      await writeStagedArtifact(stageDirectory, artifact);
    }
    for (const artifact of artifacts) {
      await publishStagedArtifact(stageDirectory, directory, artifact.fileName);
    }
  } finally {
    await rm(stageDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export class QuoteCollectionService {
  private readonly collections = new Map<string, ActiveQuoteCollection>();

  constructor(
    private readonly loader: QuoteCollectionContextLoader = new FixedFileQuoteCollectionContextLoader(),
    private readonly resultPersister?: QuoteCollectionResultPersister,
  ) {}

  async prepare(reference: QuoteCollectionReference): Promise<QuoteCollectionSessionInput> {
    const collection = await this.loadCollection(reference);
    return safeCallContext(collection.context, reference.providerId);
  }

  async simulate(reference: QuoteCollectionSimulationReference): Promise<QuoteCollectionSnapshot> {
    const collection = await this.loadCollection(reference);
    if (collection.result !== null) return this.snapshot(collection);
    if (collection.simulationInProgress) {
      throw new ConversationInvariantError(
        "QUOTE_COLLECTION_IN_PROGRESS",
        "Quote collection is already in progress",
      );
    }
    if (
      collection.simulationStarted &&
      collection.quotesByProvider.size === collection.context.providerRanking.selected.length
    ) {
      collection.simulationInProgress = true;
      try {
        await this.finalize(collection);
        return this.snapshot(collection);
      } finally {
        collection.simulationInProgress = false;
      }
    }
    if (
      collection.quotesByProvider.size > 0 ||
      collection.issuedSessionsByProvider.size > 0
    ) {
      throw new ConversationInvariantError(
        "QUOTE_COLLECTION_IN_PROGRESS",
        "Quote collection is already in progress",
      );
    }

    collection.simulationInProgress = true;
    collection.simulationStarted = true;
    try {
      for (const provider of collection.context.providerRanking.selected) {
        const callContext = safeCallContext(collection.context, provider.providerId);
        const scenario = buildDemoQuoteScenarioCall({
          collectionId: collection.context.collectionId,
          providerId: provider.providerId,
          topFiveRank: provider.topFiveRank,
          effectiveDate: collection.context.quoteRequest.desiredEffectiveDate,
        });
        const capture = parseQuoteCapture(scenario.capture);
        collection.issuedSessionsByProvider.set(provider.providerId, scenario.conversationId);
        await this.recordCapture(
          collection,
          callContext,
          capture,
          scenario.conversationId,
          scenario.conversationId,
          scenario.capture.providerResponse,
          buildCapturedConversation(callContext, scenario.conversationId, scenario.transcript),
        );
      }
      return this.snapshot(collection);
    } finally {
      collection.simulationInProgress = false;
    }
  }

  private async loadCollection(reference: QuoteCollectionSimulationReference): Promise<ActiveQuoteCollection> {
    const context = validateContext(await this.loader.load());
    if (
      reference.collectionId !== context.collectionId ||
      reference.workflowId !== context.quoteRequest.workflowId ||
      reference.specificationHash !== context.quoteRequest.specificationHash
    ) {
      throw new ConversationInvariantError("QUOTE_COLLECTION_REFERENCE_MISMATCH", "Quote collection reference does not match prepared context");
    }
    const existing = this.collections.get(context.collectionId);
    if (existing) return existing;
    const collection = createActiveCollection(context);
    this.collections.set(context.collectionId, collection);
    return collection;
  }

  get(collectionId: string): QuoteCollectionSnapshot {
    const collection = this.collections.get(collectionId);
    if (!collection) {
      throw new ConversationInvariantError("QUOTE_COLLECTION_NOT_FOUND", "Quote collection session was not found");
    }
    return this.snapshot(collection);
  }

  reserve(session: ConversationSession): void {
    if (session.purpose !== "quote_collection" || session.quoteCollection === null) {
      throw new ConversationInvariantError("NOT_QUOTE_COLLECTION_SESSION", "Session is not a quote collection call");
    }
    const collection = this.collections.get(session.quoteCollection.collectionId);
    if (!collection) {
      throw new ConversationInvariantError("QUOTE_COLLECTION_NOT_FOUND", "Quote collection session was not found");
    }
    if (collection.simulationInProgress) {
      throw new ConversationInvariantError("QUOTE_COLLECTION_IN_PROGRESS", "Quote collection is already in progress");
    }
    const providerId = session.quoteCollection.providerId;
    if (collection.quotesByProvider.has(providerId)) {
      throw new ConversationInvariantError("QUOTE_ALREADY_CAPTURED", "A quote has already been captured for this provider");
    }
    const existingSessionId = collection.issuedSessionsByProvider.get(providerId);
    if (existingSessionId && existingSessionId !== session.id) {
      throw new ConversationInvariantError("QUOTE_CALL_IN_PROGRESS", "A quote call is already active for this provider");
    }
    collection.issuedSessionsByProvider.set(providerId, session.id);
  }

  release(session: ConversationSession): void {
    if (session.purpose !== "quote_collection" || session.quoteCollection === null) return;
    const collection = this.collections.get(session.quoteCollection.collectionId);
    if (!collection || collection.quotesByProvider.has(session.quoteCollection.providerId)) return;
    if (collection.issuedSessionsByProvider.get(session.quoteCollection.providerId) === session.id) {
      collection.issuedSessionsByProvider.delete(session.quoteCollection.providerId);
    }
  }

  async capture(session: ConversationSession, value: unknown): Promise<QuoteCollectionSnapshot> {
    if (session.purpose !== "quote_collection" || session.quoteCollection === null) {
      throw new ConversationInvariantError("NOT_QUOTE_COLLECTION_SESSION", "Session is not a quote collection call");
    }
    if (session.state !== "active" || session.conversationId === null) {
      throw new ConversationInvariantError("CONVERSATION_NOT_ACTIVE", "Quote collection call is not active");
    }
    const parsed = parseQuoteCapture(value);

    const collection = this.collections.get(session.quoteCollection.collectionId);
    if (!collection) {
      throw new ConversationInvariantError("QUOTE_COLLECTION_NOT_FOUND", "Quote collection session was not found");
    }
    const expectedContext = safeCallContext(collection.context, session.quoteCollection.providerId);
    if (
      expectedContext.workflowId !== session.quoteCollection.workflowId ||
      expectedContext.specificationHash !== session.quoteCollection.specificationHash ||
      expectedContext.providerId !== session.quoteCollection.providerId
    ) {
      throw new ConversationInvariantError("QUOTE_COLLECTION_REFERENCE_MISMATCH", "Quote collection session does not match prepared context");
    }
    const providerTranscript = transcriptEntryForCapture(session, parsed.providerResponse);
    return this.recordCapture(
      collection,
      expectedContext,
      parsed,
      session.id,
      session.conversationId,
      providerTranscript,
      buildCapturedConversation(
        expectedContext,
        session.conversationId,
        labelCapturedTranscript(session),
      ),
    );
  }

  private async recordCapture(
    collection: ActiveQuoteCollection,
    callContext: QuoteCollectionSessionInput,
    capture: QuoteCapture,
    sessionId: string,
    conversationId: string,
    providerTranscript: string,
    conversation: QuoteCollectionConversation,
  ): Promise<QuoteCollectionSnapshot> {
    if (collection.quotesByProvider.has(callContext.providerId)) {
      throw new ConversationInvariantError("QUOTE_ALREADY_CAPTURED", "A quote has already been captured for this provider");
    }
    if (collection.issuedSessionsByProvider.get(callContext.providerId) !== sessionId) {
      throw new ConversationInvariantError("QUOTE_SESSION_MISMATCH", "Quote capture does not belong to the issued provider call");
    }
    const quote = buildQuote(
      collection.context.quoteRequest,
      callContext,
      capture,
      conversationId,
      providerTranscript,
      new Date().toISOString(),
    );
    collection.quotesByProvider.set(callContext.providerId, quote);
    collection.conversationsByProvider.set(callContext.providerId, conversation);
    if (collection.quotesByProvider.size === collection.context.providerRanking.selected.length) {
      await this.finalize(collection);
    }
    return this.snapshot(collection);
  }

  private async finalize(collection: ActiveQuoteCollection): Promise<void> {
    const rawQuotes = [...collection.quotesByProvider.values()];
    const normalized = addComparableMedianOutlierFlags(
      rawQuotes.map((quote) => normalizeQuote(quote, collection.context.quoteRequest)),
    );
    const recommendation = buildRecommendation({
      workflowId: collection.context.quoteRequest.workflowId,
      specificationHash: collection.context.quoteRequest.specificationHash,
      insuranceLine: collection.context.quoteRequest.insuranceLines[0] ?? "auto",
      quotes: normalized,
      generatedAt: new Date(),
    });
    if (recommendation.recommendedQuoteId === null) {
      throw new ConversationInvariantError(
        "NO_QUALIFYING_QUOTE",
        `No comparable quote is eligible: ${recommendation.disqualifiedQuotes.map((quote) => {
          const normalizedQuote = normalized.find((candidate) => candidate.quoteId === quote.quoteId);
          return `${quote.quoteId} (${quote.reasons.join(", ")}; ${normalizedQuote?.coverageEquivalence.differences.join(", ") ?? "no comparison detail"})`;
        }).join("; ")}`,
      );
    }
    const evidence = rawQuotes.flatMap((quote) => quote.evidence) as Evidence[];
    const handoff = buildNegotiationHandoff({
      recommendation,
      providerRanking: collection.context.providerRanking,
      quotes: normalized,
      evidence,
      generatedAt: new Date(),
    });
    const target = handoff.target;
    const result = Object.freeze({
      recommendedProviderName: target.providerName,
      effectiveComparisonCostCents: target.effectiveComparisonCostCents,
      negotiationHandoff: handoff,
    });
    const conversations = this.conversations(collection);
    if (this.resultPersister) {
      await this.resultPersister(collection, rawQuotes, normalized, recommendation, handoff, conversations);
    } else {
      await this.persist(collection, rawQuotes, normalized, recommendation, handoff, conversations);
    }
    collection.result = result;
  }

  private async persist(
    collection: ActiveQuoteCollection,
    rawQuotes: readonly RawQuoteOutcome[],
    normalized: readonly NormalizedQuote[],
    recommendation: unknown,
    handoff: NegotiationHandoff,
    conversations: readonly QuoteCollectionConversation[],
  ): Promise<void> {
    const directory = await ensureDirectoryWithoutSymlinks(
      requireSafeArtifactDirectory(collection.context.artifactDirectory),
    );
    await persistArtifactSet(directory, [
      { fileName: "raw-quotes.json", payload: { quotes: rawQuotes } },
      { fileName: "normalized-quotes.json", payload: { quotes: normalized } },
      { fileName: "recommendation.json", payload: { recommendation, negotiationHandoff: handoff } },
      { fileName: "person3-handoff.json", payload: handoff },
      { fileName: "conversations.json", payload: { conversations } },
    ]);
  }

  private conversations(collection: ActiveQuoteCollection): readonly QuoteCollectionConversation[] {
    return Object.freeze(collection.context.providerRanking.selected.flatMap((provider) => {
      const conversation = collection.conversationsByProvider.get(provider.providerId);
      return conversation ? [conversation] : [];
    }));
  }

  private snapshot(collection: ActiveQuoteCollection): QuoteCollectionSnapshot {
    const normalizedByProvider = new Map<string, number>();
    if (collection.result !== null) {
      for (const quote of collection.quotesByProvider.values()) {
        const normalized = normalizeQuote(quote, collection.context.quoteRequest);
        if (normalized.effectiveComparisonCostCents !== null) {
          normalizedByProvider.set(quote.providerId, normalized.effectiveComparisonCostCents);
        }
      }
    }
    return Object.freeze({
      collectionId: collection.context.collectionId,
      workflowId: collection.context.quoteRequest.workflowId,
      specificationHash: collection.context.quoteRequest.specificationHash,
      providers: Object.freeze(collection.context.providerRanking.selected.map((provider) => Object.freeze({
        providerId: provider.providerId,
        providerName: provider.providerName,
        status: collection.quotesByProvider.has(provider.providerId)
          ? "captured" as const
          : collection.issuedSessionsByProvider.has(provider.providerId)
            ? "active" as const
            : "pending" as const,
        effectiveComparisonCostCents: normalizedByProvider.get(provider.providerId) ?? null,
      }))),
      conversations: this.conversations(collection),
      result: collection.result,
    });
  }
}

export const quoteCollections = new QuoteCollectionService();
