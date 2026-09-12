import { z, ZodError } from "zod";

import { HttpError, jsonError, jsonSuccess, readJsonBody } from "@/app/api/_lib/http";
import { requireInternalAuthorization } from "@/app/api/_lib/security";
import {
  ElevenLabsTwilioOutboundCallProvider,
  TwilioCallPolicyError,
  TwilioConfigurationError,
  type OutboundCallProvider,
  type OutboundCallResult,
} from "@/integrations/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OutboundCallRequestSchema = z.strictObject({
  toNumber: z.string(),
});
const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

export class IdempotencyKeyConflictError extends Error {
  constructor() {
    super("Idempotency key cannot be reused for a different destination");
    this.name = "IdempotencyKeyConflictError";
  }
}

interface IdempotentCallEntry {
  readonly toNumber: string;
  readonly result: Promise<OutboundCallResult>;
}

export class InMemoryOutboundCallIdempotency {
  private readonly entries = new Map<string, IdempotentCallEntry>();

  execute(
    key: string,
    toNumber: string,
    createCall: () => Promise<OutboundCallResult>,
  ): Promise<OutboundCallResult> {
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.toNumber !== toNumber) throw new IdempotencyKeyConflictError();
      return existing.result;
    }

    const result = createCall();
    this.entries.set(key, { toNumber, result });
    return result;
  }
}

const outboundCallIdempotency = new InMemoryOutboundCallIdempotency();

function requireDemoOutboundCalling(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (environment.NODE_ENV === "production" || environment.DEMO_MODE !== "true") {
    throw new HttpError(404, "NOT_FOUND", "Outbound calling is unavailable");
  }
}

function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!key || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new HttpError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required");
  }
  return key;
}

function toOutboundCallHttpError(error: unknown): HttpError {
  if (error instanceof TwilioConfigurationError) {
    return new HttpError(503, error.code, "Outbound calling is not configured");
  }

  if (error instanceof TwilioCallPolicyError) {
    const status = error.code === "DESTINATION_NOT_ALLOWED" ? 403 : 400;
    const message = error.code === "DESTINATION_NOT_ALLOWED"
      ? "Destination phone number is not allowed"
      : "Destination phone number is invalid";
    return new HttpError(status, error.code, message);
  }

  return new HttpError(502, "TWILIO_UNAVAILABLE", "Outbound call service is unavailable");
}

export async function handleOutboundCallRequest(
  request: Request,
  provider: OutboundCallProvider,
  idempotency: InMemoryOutboundCallIdempotency = outboundCallIdempotency,
): Promise<Response> {
  try {
    requireDemoOutboundCalling();
    requireInternalAuthorization(request);
    const idempotencyKey = requireIdempotencyKey(request);
    const body = OutboundCallRequestSchema.parse(await readJsonBody(request));
    const call = await idempotency.execute(
      idempotencyKey,
      body.toNumber,
      () => provider.place({ toNumber: body.toNumber }),
    );

    return jsonSuccess({ call }, 201);
  } catch (error) {
    if (error instanceof HttpError || error instanceof ZodError) return jsonError(error);
    if (error instanceof IdempotencyKeyConflictError) {
      return jsonError(new HttpError(409, "IDEMPOTENCY_KEY_CONFLICT", "Idempotency key belongs to another destination"));
    }
    return jsonError(toOutboundCallHttpError(error));
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleOutboundCallRequest(request, new ElevenLabsTwilioOutboundCallProvider());
}
