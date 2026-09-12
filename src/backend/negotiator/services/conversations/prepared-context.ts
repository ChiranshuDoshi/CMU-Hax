import { open } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { NegotiationGoalSchema, NegotiationHandoffSchema } from "@/domain/schemas/person4";

import {
  buildSafeNegotiationContext,
  ConversationInvariantError,
  NegotiationParticipantSchema,
} from "./negotiation-context";
import type { NegotiationReference, NegotiationSessionInput } from "./types";

const MAX_PREPARED_CONTEXT_BYTES = 256 * 1024;
const DEFAULT_PREPARED_CONTEXT_PATH = join(
  process.cwd(),
  ".artifacts",
  "person3",
  "negotiation-session.json",
);

const ExplicitSelectionSchema = z.strictObject({
  quoteId: z.string().min(1),
  providerId: z.string().min(1),
  specificationHash: z.string().regex(/^[a-f0-9]{64}$/),
  selectedAt: z.string().datetime(),
});

const PreparedNegotiationContextSchema = z.strictObject({
  participant: NegotiationParticipantSchema,
  handoff: NegotiationHandoffSchema,
  goal: NegotiationGoalSchema,
  explicitSelection: ExplicitSelectionSchema,
});

export class PreparedNegotiationContextError extends Error {
  constructor(
    readonly code: "PREPARED_CONTEXT_UNAVAILABLE" | "PREPARED_CONTEXT_INVALID" | "NEGOTIATION_REFERENCE_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "PreparedNegotiationContextError";
  }
}

export interface PreparedNegotiationContextLoader {
  load(): Promise<unknown>;
}

export interface PreparedNegotiationContextProvider {
  load(reference: NegotiationReference): Promise<NegotiationSessionInput>;
}

export class FixedFilePreparedNegotiationContextLoader implements PreparedNegotiationContextLoader {
  constructor(private readonly filePath = DEFAULT_PREPARED_CONTEXT_PATH) {}

  async load(): Promise<unknown> {
    let file;
    try {
      file = await open(this.filePath, "r");
      const stats = await file.stat();
      if (!stats.isFile() || stats.size > MAX_PREPARED_CONTEXT_BYTES) {
        throw new PreparedNegotiationContextError(
          "PREPARED_CONTEXT_INVALID",
          "Prepared negotiation context is invalid",
        );
      }
      const buffer = Buffer.alloc(MAX_PREPARED_CONTEXT_BYTES + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const result = await file.read(buffer, bytesRead, buffer.length - bytesRead, null);
        if (result.bytesRead === 0) break;
        bytesRead += result.bytesRead;
      }
      if (bytesRead > MAX_PREPARED_CONTEXT_BYTES) {
        throw new PreparedNegotiationContextError(
          "PREPARED_CONTEXT_INVALID",
          "Prepared negotiation context is invalid",
        );
      }
      return JSON.parse(buffer.toString("utf8", 0, bytesRead)) as unknown;
    } catch (error) {
      if (error instanceof PreparedNegotiationContextError) throw error;
      if (error instanceof SyntaxError) {
        throw new PreparedNegotiationContextError(
          "PREPARED_CONTEXT_INVALID",
          "Prepared negotiation context is invalid",
        );
      }
      throw new PreparedNegotiationContextError(
        "PREPARED_CONTEXT_UNAVAILABLE",
        "Prepared negotiation context is unavailable",
      );
    } finally {
      await file?.close().catch(() => undefined);
    }
  }
}

export class PreparedNegotiationContextService implements PreparedNegotiationContextProvider {
  constructor(
    private readonly loader: PreparedNegotiationContextLoader = new FixedFilePreparedNegotiationContextLoader(),
  ) {}

  async load(reference: NegotiationReference): Promise<NegotiationSessionInput> {
    const loaded = await this.loader.load();
    const parsed = PreparedNegotiationContextSchema.safeParse(loaded);
    if (!parsed.success) {
      throw new PreparedNegotiationContextError(
        "PREPARED_CONTEXT_INVALID",
        "Prepared negotiation context is invalid",
      );
    }

    try {
      buildSafeNegotiationContext(parsed.data);
    } catch (error) {
      if (error instanceof ConversationInvariantError) {
        throw new PreparedNegotiationContextError(
          "PREPARED_CONTEXT_INVALID",
          "Prepared negotiation context is invalid",
        );
      }
      throw error;
    }

    const { handoff, goal, explicitSelection } = parsed.data;
    if (
      reference.workflowId !== handoff.workflowId
      || reference.workflowId !== goal.workflowId
      || reference.providerId !== handoff.target.providerId
      || reference.providerId !== goal.targetProviderId
      || reference.providerId !== explicitSelection.providerId
      || reference.quoteId !== handoff.target.quoteId
      || reference.quoteId !== goal.selectedQuoteId
      || reference.quoteId !== explicitSelection.quoteId
      || reference.specificationHash !== handoff.specificationHash
      || reference.specificationHash !== explicitSelection.specificationHash
      || reference.selectedAt !== explicitSelection.selectedAt
    ) {
      throw new PreparedNegotiationContextError(
        "NEGOTIATION_REFERENCE_MISMATCH",
        "Negotiation reference does not match the prepared context",
      );
    }

    return parsed.data;
  }
}
