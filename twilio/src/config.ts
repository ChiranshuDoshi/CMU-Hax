const DEFAULT_PORT = 3010;
const MIN_PORT = 1;
const MAX_PORT = 65_535;
const E164_NUMBER_PATTERN = /^\+[1-9]\d{1,14}$/;

export interface TwilioCredentials {
  readonly accountSid: string;
  readonly authToken: string;
  readonly phoneNumber: string;
}

export interface TwilioServiceConfig {
  readonly port: number;
  readonly publicWebhookBaseUrl: URL | null;
  readonly twilio: TwilioCredentials | null;
  readonly internalApiToken: string | null;
  readonly allowedDestinations: ReadonlySet<string>;
}

/** An invalid service configuration. Messages intentionally never include environment values. */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

function readOptionalSetting(environment: Environment, name: string): string | null {
  const value = environment[name];
  if (value === undefined) return null;
  if (value.trim().length === 0) {
    throw new ConfigurationError(`${name} must not be empty when configured`);
  }
  return value.trim();
}

function parsePort(environment: Environment): number {
  const configuredPort = readOptionalSetting(environment, "PORT");
  if (configuredPort === null) return DEFAULT_PORT;
  if (!/^\d+$/.test(configuredPort)) {
    throw new ConfigurationError("PORT must be a whole number between 1 and 65535");
  }

  const port = Number(configuredPort);
  if (!Number.isSafeInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new ConfigurationError("PORT must be a whole number between 1 and 65535");
  }
  return port;
}

function parseTwilioCredentials(environment: Environment): TwilioCredentials | null {
  const accountSid = readOptionalSetting(environment, "TWILIO_ACCOUNT_SID");
  const authToken = readOptionalSetting(environment, "TWILIO_AUTH_TOKEN");
  const phoneNumber = readOptionalSetting(environment, "TWILIO_PHONE_NUMBER");
  const configuredCredentialCount = [accountSid, authToken, phoneNumber].filter(
    (value) => value !== null,
  ).length;

  if (configuredCredentialCount === 0) return null;
  if (configuredCredentialCount !== 3) {
    throw new ConfigurationError(
      "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER must be configured together",
    );
  }
  if (accountSid === null || authToken === null || phoneNumber === null) {
    throw new ConfigurationError(
      "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER must be configured together",
    );
  }
  if (!isE164Number(phoneNumber)) {
    throw new ConfigurationError("TWILIO_PHONE_NUMBER must be a valid E.164 number");
  }

  return { accountSid, authToken, phoneNumber };
}

function parsePublicWebhookBaseUrl(environment: Environment): URL | null {
  const configuredUrl = readOptionalSetting(environment, "TWILIO_PUBLIC_WEBHOOK_BASE_URL");
  if (configuredUrl === null) return null;

  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new ConfigurationError("TWILIO_PUBLIC_WEBHOOK_BASE_URL must be a valid absolute HTTP(S) URL");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== "/" ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new ConfigurationError("TWILIO_PUBLIC_WEBHOOK_BASE_URL must be an absolute HTTP(S) origin without a path, query, or fragment");
  }
  return url;
}

function parseAllowedDestinations(environment: Environment): ReadonlySet<string> | null {
  const configuredAllowlist = readOptionalSetting(environment, "TWILIO_OUTBOUND_ALLOWED_DESTINATIONS");
  if (configuredAllowlist === null) return null;

  const destinations = configuredAllowlist.split(",").map((destination) => destination.trim());
  if (destinations.some((destination) => !isE164Number(destination))) {
    throw new ConfigurationError(
      "TWILIO_OUTBOUND_ALLOWED_DESTINATIONS must be a comma-separated list of E.164 numbers",
    );
  }
  return new Set(destinations);
}

/** Returns whether a phone number uses the canonical E.164 dialing format. */
export function isE164Number(value: string): boolean {
  return E164_NUMBER_PATTERN.test(value);
}

/**
 * Loads the dedicated Twilio service configuration without reading or changing
 * any configuration used by the main Next.js application.
 */
export function loadConfig(environment: Environment = process.env): TwilioServiceConfig {
  const publicWebhookBaseUrl = parsePublicWebhookBaseUrl(environment);
  const internalApiToken = readOptionalSetting(environment, "TWILIO_INTERNAL_API_TOKEN");
  const allowedDestinations = parseAllowedDestinations(environment);
  const twilio = parseTwilioCredentials(environment);
  const configuredOutboundPolicyCount = [internalApiToken, allowedDestinations]
    .filter((value) => value !== null).length;

  if (configuredOutboundPolicyCount === 1) {
    throw new ConfigurationError(
      "TWILIO_INTERNAL_API_TOKEN and TWILIO_OUTBOUND_ALLOWED_DESTINATIONS must be configured together",
    );
  }
  if (twilio === null && publicWebhookBaseUrl !== null) {
    throw new ConfigurationError(
      "TWILIO_PUBLIC_WEBHOOK_BASE_URL requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER",
    );
  }
  if (twilio !== null && publicWebhookBaseUrl === null) {
    throw new ConfigurationError(
      "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER require TWILIO_PUBLIC_WEBHOOK_BASE_URL",
    );
  }
  if (configuredOutboundPolicyCount === 2 && twilio === null) {
    throw new ConfigurationError(
      "Complete outbound calling configuration requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER",
    );
  }

  return {
    port: parsePort(environment),
    publicWebhookBaseUrl,
    twilio,
    internalApiToken,
    allowedDestinations: allowedDestinations ?? new Set(),
  };
}

export function isTwilioConfigured(config: TwilioServiceConfig): boolean {
  return config.twilio !== null && config.publicWebhookBaseUrl !== null;
}

export function isOutboundCallingEnabled(config: TwilioServiceConfig): boolean {
  return (
    isTwilioConfigured(config) &&
    config.publicWebhookBaseUrl !== null &&
    config.internalApiToken !== null &&
    config.allowedDestinations.size > 0
  );
}
