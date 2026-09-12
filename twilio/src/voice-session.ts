import twilio from "twilio";

export type CallDirection = "inbound" | "outbound";

export interface VoiceCallContext {
  direction: CallDirection;
  callSid: string;
  from: string;
  to: string;
}

export interface VoiceSessionResponder {
  createTwiML(context: VoiceCallContext): string;
}

const UNCONFIGURED_SERVICE_MESSAGE =
  "The AI voice service has not been connected. Goodbye.";

/**
 * A safe default for unconfigured voice webhooks. It deliberately does not
 * attempt to connect a caller to an AI provider or media stream.
 */
export class UnconfiguredVoiceSessionResponder
  implements VoiceSessionResponder
{
  createTwiML(_context: VoiceCallContext): string {
    const response = new twilio.twiml.VoiceResponse();
    response.say(UNCONFIGURED_SERVICE_MESSAGE);
    response.hangup();

    return response.toString();
  }
}
