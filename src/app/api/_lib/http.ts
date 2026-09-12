import { ZodError } from "zod";

import { NegotiationValidationError } from "@/domain/negotiation";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const MAX_JSON_BODY_BYTES = 256 * 1024;

export async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds 256 KiB");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds 256 KiB");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

export function jsonSuccess(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function jsonError(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (error instanceof ZodError) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: error.issues.map(({ path, message }) => ({ path: path.join("."), message })),
        },
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (error instanceof NegotiationValidationError) {
    return Response.json(
      {
        error: {
          code: "NEGOTIATION_VALIDATION_ERROR",
          message: error.message,
          details: error.issues,
        },
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "Unexpected server error" } },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}
