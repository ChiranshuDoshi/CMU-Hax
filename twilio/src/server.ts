import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import twilio from "twilio";

import {
  isE164Number,
  isOutboundCallingEnabled,
  isTwilioConfigured,
  type TwilioServiceConfig,
} from "./config.js";
import { IdempotencyConflictError, InMemoryIdempotencyStore } from "./idempotency.js";
import {
  createTwilioOutboundCallGateway,
  type OutboundCallGateway,
  type OutboundCallResult,
} from "./twilio-gateway.js";
import {
  UnconfiguredVoiceSessionResponder,
  type CallDirection,
  type VoiceSessionResponder,
} from "./voice-session.js";

const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const JSON_CONTENT_TYPE = "application/json";
const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";
const OUTBOUND_STATUS_EVENTS = ["initiated", "ringing", "answered", "completed"] as const;

type FormValues = Readonly<Record<string, string>>;

export type SignatureValidator = (
  authToken: string,
  signature: string,
  url: string,
  values: FormValues,
) => boolean;

export interface TwilioServerDependencies {
  readonly config: TwilioServiceConfig;
  readonly gateway?: OutboundCallGateway;
  readonly signatureValidator?: SignatureValidator;
  readonly voiceSessionResponder?: VoiceSessionResponder;
  readonly idempotency?: InMemoryIdempotencyStore<OutboundCallResult>;
}

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the maximum allowed size");
    this.name = "RequestBodyTooLargeError";
  }
}

function defaultSignatureValidator(
  authToken: string,
  signature: string,
  url: string,
  values: FormValues,
): boolean {
  return twilio.validateRequest(authToken, signature, url, values);
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function sendError(response: ServerResponse, status: number, code: string, message: string): void {
  sendJson(response, status, { error: { code, message } });
}

function sendTwiML(response: ServerResponse, twiml: string): void {
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "text/xml; charset=utf-8",
  });
  response.end(twiml);
}

function isContentType(request: IncomingMessage, expected: string): boolean {
  const value = request.headers["content-type"] ?? "";
  return value.toLowerCase().startsWith(expected);
}

function route(request: IncomingMessage): URL {
  return new URL(request.url ?? "/", "http://twilio-gateway.local");
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.length;
    if (receivedBytes > MAX_REQUEST_BODY_BYTES) throw new RequestBodyTooLargeError();
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseForm(body: string): FormValues {
  return Object.fromEntries(new URLSearchParams(body).entries());
}

function parseOutboundRequest(body: string): { readonly to: string } | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || typeof record.to !== "string") return null;
    return { to: record.to.trim() };
  } catch {
    return null;
  }
}

function requestSignature(request: IncomingMessage): string | null {
  const signature = request.headers["x-twilio-signature"];
  return typeof signature === "string" && signature.trim() ? signature.trim() : null;
}

function externalUrl(config: TwilioServiceConfig, pathname: string): string {
  if (config.publicWebhookBaseUrl === null) throw new Error("Public webhook URL is not configured");
  return new URL(pathname, config.publicWebhookBaseUrl).toString();
}

function isInternalRequestAuthorized(request: IncomingMessage, token: string): boolean {
  const authorization = request.headers.authorization;
  const expected = `Bearer ${token}`;
  if (typeof authorization !== "string" || authorization.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(authorization), Buffer.from(expected));
}

function idempotencyKey(request: IncomingMessage): string | null {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string") return null;
  const key = value.trim();
  return key && key.length <= IDEMPOTENCY_KEY_MAX_LENGTH ? key : null;
}

function verifyWebhook(
  request: IncomingMessage,
  config: TwilioServiceConfig,
  values: FormValues,
  signatureValidator: SignatureValidator,
): boolean {
  if (!isTwilioConfigured(config) || config.twilio === null) return false;
  const signature = requestSignature(request);
  if (signature === null) return false;
  const url = externalUrl(config, request.url ?? "/");
  return signatureValidator(config.twilio.authToken, signature, url, values);
}

async function handleVoiceWebhook(
  request: IncomingMessage,
  response: ServerResponse,
  direction: CallDirection,
  dependencies: Required<Pick<TwilioServerDependencies, "config" | "signatureValidator" | "voiceSessionResponder">>,
): Promise<void> {
  if (!isTwilioConfigured(dependencies.config)) {
    sendError(response, 503, "TWILIO_NOT_CONFIGURED", "Voice webhooks are not configured");
    return;
  }
  if (!isContentType(request, FORM_CONTENT_TYPE)) {
    sendError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "Twilio webhooks must be form encoded");
    return;
  }

  const values = parseForm(await readBody(request));
  if (!verifyWebhook(request, dependencies.config, values, dependencies.signatureValidator)) {
    sendError(response, 401, "INVALID_TWILIO_SIGNATURE", "Twilio signature validation failed");
    return;
  }

  sendTwiML(response, dependencies.voiceSessionResponder.createTwiML({
    direction,
    callSid: values.CallSid ?? "",
    from: values.From ?? "",
    to: values.To ?? "",
  }));
}

async function handleStatusWebhook(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: Required<Pick<TwilioServerDependencies, "config" | "signatureValidator">>,
): Promise<void> {
  if (!isTwilioConfigured(dependencies.config)) {
    sendError(response, 503, "TWILIO_NOT_CONFIGURED", "Status webhooks are not configured");
    return;
  }
  if (!isContentType(request, FORM_CONTENT_TYPE)) {
    sendError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "Twilio webhooks must be form encoded");
    return;
  }

  const values = parseForm(await readBody(request));
  if (!verifyWebhook(request, dependencies.config, values, dependencies.signatureValidator)) {
    sendError(response, 401, "INVALID_TWILIO_SIGNATURE", "Twilio signature validation failed");
    return;
  }

  response.writeHead(204, { "Cache-Control": "no-store" });
  response.end();
}

async function handleOutboundCall(
  request: IncomingMessage,
  response: ServerResponse,
  dependencies: Required<Pick<TwilioServerDependencies, "config" | "idempotency">> & { readonly gateway: OutboundCallGateway | null },
): Promise<void> {
  const { config, gateway, idempotency } = dependencies;
  const twilioConfig = config.twilio;
  if (!isOutboundCallingEnabled(config) || twilioConfig === null || config.internalApiToken === null || gateway === null) {
    sendError(response, 503, "OUTBOUND_CALLING_NOT_CONFIGURED", "Outbound calling is not configured");
    return;
  }
  if (!isInternalRequestAuthorized(request, config.internalApiToken)) {
    sendError(response, 401, "UNAUTHORIZED", "Internal authorization is required");
    return;
  }
  const key = idempotencyKey(request);
  if (key === null) {
    sendError(response, 400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required");
    return;
  }
  if (!isContentType(request, JSON_CONTENT_TYPE)) {
    sendError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "Outbound call requests must be JSON");
    return;
  }

  const input = parseOutboundRequest(await readBody(request));
  if (input === null) {
    sendError(response, 400, "INVALID_REQUEST", "Request body must contain only a destination phone number");
    return;
  }
  if (!isE164Number(input.to)) {
    sendError(response, 400, "INVALID_DESTINATION", "Destination phone number must be E.164");
    return;
  }
  if (!config.allowedDestinations.has(input.to)) {
    sendError(response, 403, "DESTINATION_NOT_ALLOWED", "Destination phone number is not allowlisted");
    return;
  }

  try {
    const call = await idempotency.execute(key, input.to, () => gateway.createCall({
      to: input.to,
      from: twilioConfig.phoneNumber,
      url: externalUrl(config, "/webhooks/voice/outbound"),
      statusCallback: externalUrl(config, "/webhooks/status"),
      statusCallbackEvent: [...OUTBOUND_STATUS_EVENTS],
    }));
    sendJson(response, 201, { call });
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      sendError(response, 409, "IDEMPOTENCY_KEY_CONFLICT", "Idempotency key belongs to another destination");
      return;
    }
    sendError(response, 502, "TWILIO_UNAVAILABLE", "Outbound call service is unavailable");
  }
}

export function createTwilioServer(dependencies: TwilioServerDependencies): Server {
  const config = dependencies.config;
  const gateway = dependencies.gateway ?? (config.twilio ? createTwilioOutboundCallGateway(config.twilio) : null);
  const signatureValidator = dependencies.signatureValidator ?? defaultSignatureValidator;
  const voiceSessionResponder = dependencies.voiceSessionResponder ?? new UnconfiguredVoiceSessionResponder();
  const idempotency = dependencies.idempotency ?? new InMemoryIdempotencyStore<OutboundCallResult>();

  return createServer(async (request, response) => {
    try {
      const pathname = route(request).pathname;
      if (request.method === "GET" && pathname === "/health") {
        sendJson(response, 200, {
          status: "ok",
          twilioConfigured: isTwilioConfigured(config),
          outboundCallingEnabled: isOutboundCallingEnabled(config),
        });
        return;
      }
      if (request.method === "POST" && pathname === "/webhooks/voice/inbound") {
        await handleVoiceWebhook(request, response, "inbound", { config, signatureValidator, voiceSessionResponder });
        return;
      }
      if (request.method === "POST" && pathname === "/webhooks/voice/outbound") {
        await handleVoiceWebhook(request, response, "outbound", { config, signatureValidator, voiceSessionResponder });
        return;
      }
      if (request.method === "POST" && pathname === "/webhooks/status") {
        await handleStatusWebhook(request, response, { config, signatureValidator });
        return;
      }
      if (request.method === "POST" && pathname === "/calls") {
        await handleOutboundCall(request, response, { config, gateway, idempotency });
        return;
      }
      sendError(response, 404, "NOT_FOUND", "Route not found");
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        sendError(response, 413, "REQUEST_TOO_LARGE", "Request body is too large");
        return;
      }
      sendError(response, 500, "INTERNAL_ERROR", "Unexpected server error");
    }
  });
}
