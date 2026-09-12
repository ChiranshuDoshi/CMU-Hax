import twilio from "twilio";

import type { TwilioCredentials } from "./config.js";

export type OutboundCallStatusCallbackEvent =
  | "initiated"
  | "ringing"
  | "answered"
  | "completed";

export interface OutboundCallRequest {
  to: string;
  from: string;
  url: string;
  statusCallback: string;
  statusCallbackEvent: OutboundCallStatusCallbackEvent[];
}

export interface OutboundCallResult {
  sid: string;
}

export interface OutboundCallGateway {
  createCall(request: OutboundCallRequest): Promise<OutboundCallResult>;
}

/**
 * Creates the thin server-side boundary for Twilio outbound call creation.
 * Authorization, idempotency, and audit controls belong to the caller.
 */
export function createTwilioOutboundCallGateway(
  credentials: TwilioCredentials,
): OutboundCallGateway {
  const client = twilio(credentials.accountSid, credentials.authToken);

  return {
    async createCall(request) {
      const call = await client.calls.create({
        to: request.to,
        from: request.from,
        url: request.url,
        statusCallback: request.statusCallback,
        statusCallbackEvent: request.statusCallbackEvent,
      });

      return { sid: call.sid };
    },
  };
}
