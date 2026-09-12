import { timingSafeEqual } from "node:crypto";

import { HttpError } from "./http";

function equalSecrets(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}

/**
 * Temporary server-to-server trust boundary for the Person 4 slice.
 * Person 2 should replace this with authenticated workflow ownership checks.
 */
export function requireInternalAuthorization(request: Request): void {
  const expected = process.env.POLICYSCOUT_INTERNAL_API_KEY?.trim();
  if (!expected) {
    throw new HttpError(503, "AUTHORIZATION_NOT_CONFIGURED", "Server authorization is not configured");
  }

  const header = request.headers.get("authorization");
  const received = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!received || !equalSecrets(received, expected)) {
    throw new HttpError(401, "UNAUTHORIZED", "Valid server authorization is required");
  }
}
