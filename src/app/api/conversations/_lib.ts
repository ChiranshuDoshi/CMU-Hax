import { HttpError } from "@/app/api/_lib/http";
import { ConversationInvariantError } from "@/server/services/conversations";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function requireLocalDemoRequest(
  request: Request,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (environment.NODE_ENV === "production" || environment.DEMO_MODE !== "true") {
    throw new HttpError(404, "NOT_FOUND", "Demo conversation routes are unavailable");
  }

  const requestUrl = new URL(request.url);
  if (!LOOPBACK_HOSTNAMES.has(requestUrl.hostname)) {
    throw new HttpError(403, "LOCAL_DEMO_ONLY", "Demo conversation routes require a loopback host");
  }

  const origin = request.headers.get("origin");
  if (!origin || origin !== requestUrl.origin) {
    throw new HttpError(403, "SAME_ORIGIN_REQUIRED", "Demo conversation routes require a same-origin request");
  }
}

export function toConversationHttpError(error: unknown): unknown {
  if (!(error instanceof ConversationInvariantError)) return error;

  const status = error.code === "SESSION_NOT_FOUND" ? 404 : 400;
  return new HttpError(status, error.code, error.message);
}
