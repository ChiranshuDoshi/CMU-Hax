import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

import type { OutboundCallProvider, OutboundCallRequest, OutboundCallResult } from "./types";

const E164_PHONE_NUMBER_PATTERN = /^\+[1-9]\d{1,14}$/;
const SDK_TIMEOUT_SECONDS = 10;
const SDK_MAX_RETRIES = 0;

type ServerEnvironment = Readonly<Record<string, string | undefined>>;

export type TwilioCallPolicyErrorCode = "INVALID_DESTINATION" | "DESTINATION_NOT_ALLOWED";

export class TwilioConfigurationError extends Error {
  readonly code = "TWILIO_NOT_CONFIGURED";

  constructor(message: string) {
    super(message);
    this.name = "TwilioConfigurationError";
  }
}

export class TwilioCallPolicyError extends Error {
  constructor(
    readonly code: TwilioCallPolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TwilioCallPolicyError";
  }
}

export class TwilioOutboundCallError extends Error {
  readonly code = "TWILIO_OUTBOUND_CALL_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "TwilioOutboundCallError";
  }
}

export interface ElevenLabsTwilioGateway {
  outboundCall(input: {
    readonly agentId: string;
    readonly agentPhoneNumberId: string;
    readonly toNumber: string;
    readonly callRecordingEnabled: boolean;
  }): Promise<{
    readonly success: boolean;
    readonly message: string;
    readonly conversationId?: string;
    readonly callSid?: string;
  }>;
}

interface GatewayConfiguration {
  readonly apiKey: string;
  readonly timeoutInSeconds: number;
  readonly maxRetries: number;
}

type GatewayFactory = (configuration: GatewayConfiguration) => ElevenLabsTwilioGateway;

interface TwilioOutboundCallConfiguration {
  readonly apiKey: string;
  readonly agentId: string;
  readonly agentPhoneNumberId: string;
  readonly allowedDestinations: ReadonlySet<string>;
}

function requiredEnvironmentValue(name: string, environment: ServerEnvironment): string {
  const value = environment[name]?.trim();
  if (!value) throw new TwilioConfigurationError(`${name} is not configured`);
  return value;
}

function parseAllowedDestinations(environment: ServerEnvironment): ReadonlySet<string> {
  const configured = requiredEnvironmentValue("TWILIO_OUTBOUND_ALLOWED_DESTINATIONS", environment);
  const destinations = configured.split(",").map((value) => value.trim()).filter(Boolean);

  if (destinations.length === 0 || destinations.some((destination) => !E164_PHONE_NUMBER_PATTERN.test(destination))) {
    throw new TwilioConfigurationError("TWILIO_OUTBOUND_ALLOWED_DESTINATIONS must contain E.164 phone numbers");
  }

  return new Set(destinations);
}

function resolveConfiguration(environment: ServerEnvironment): TwilioOutboundCallConfiguration {
  return {
    apiKey: requiredEnvironmentValue("ELEVENLABS_API_KEY", environment),
    agentId: requiredEnvironmentValue("ELEVENLABS_NEGOTIATOR_AGENT_ID", environment),
    agentPhoneNumberId: requiredEnvironmentValue("ELEVENLABS_TWILIO_PHONE_NUMBER_ID", environment),
    allowedDestinations: parseAllowedDestinations(environment),
  };
}

function validateDestination(toNumber: string, allowedDestinations: ReadonlySet<string>): string {
  const destination = toNumber.trim();
  if (!E164_PHONE_NUMBER_PATTERN.test(destination)) {
    throw new TwilioCallPolicyError("INVALID_DESTINATION", "Destination must be an E.164 phone number");
  }
  if (!allowedDestinations.has(destination)) {
    throw new TwilioCallPolicyError("DESTINATION_NOT_ALLOWED", "Destination is not in the outbound call allowlist");
  }
  return destination;
}

function requiredResponseIdentifier(value: string | undefined): string | null {
  const identifier = value?.trim();
  return identifier || null;
}

export class ElevenLabsTwilioOutboundCallProvider implements OutboundCallProvider {
  constructor(
    private readonly environment: ServerEnvironment = process.env,
    private readonly createGateway: GatewayFactory = ({ apiKey, timeoutInSeconds, maxRetries }) => {
      const client = new ElevenLabsClient({ apiKey, timeoutInSeconds, maxRetries });
      return client.conversationalAi.twilio;
    },
  ) {}

  async place(input: OutboundCallRequest): Promise<OutboundCallResult> {
    const configuration = resolveConfiguration(this.environment);
    const toNumber = validateDestination(input.toNumber, configuration.allowedDestinations);
    const gateway = this.createGateway({
      apiKey: configuration.apiKey,
      timeoutInSeconds: SDK_TIMEOUT_SECONDS,
      maxRetries: SDK_MAX_RETRIES,
    });
    const response = await gateway.outboundCall({
      agentId: configuration.agentId,
      agentPhoneNumberId: configuration.agentPhoneNumberId,
      toNumber,
      callRecordingEnabled: false,
    });
    const conversationId = requiredResponseIdentifier(response.conversationId);
    const callSid = requiredResponseIdentifier(response.callSid);

    if (!response.success || conversationId === null || callSid === null) {
      throw new TwilioOutboundCallError("Outbound call provider returned an incomplete result");
    }

    return { conversationId, callSid };
  }
}
