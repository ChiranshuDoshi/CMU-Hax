import { describe, expect, it } from "vitest";

import {
  ConfigurationError,
  isE164Number,
  isOutboundCallingEnabled,
  isTwilioConfigured,
  loadConfig,
} from "../src/config.js";

const COMPLETE_TWILIO_ENV = {
  TWILIO_ACCOUNT_SID: "AC123",
  TWILIO_AUTH_TOKEN: "secret-token",
  TWILIO_PHONE_NUMBER: "+15551234567",
};

const COMPLETE_OUTBOUND_POLICY = {
  TWILIO_PUBLIC_WEBHOOK_BASE_URL: "https://calls.example.com",
  TWILIO_INTERNAL_API_TOKEN: "service-token",
  TWILIO_OUTBOUND_ALLOWED_DESTINATIONS: "+15551234567, +15557654321",
};

describe("Twilio service configuration", () => {
  it("starts safely without any Twilio configuration", () => {
    const config = loadConfig({});

    expect(config).toMatchObject({
      port: 3010,
      publicWebhookBaseUrl: null,
      twilio: null,
      internalApiToken: null,
    });
    expect(config.allowedDestinations.size).toBe(0);
    expect(isTwilioConfigured(config)).toBe(false);
    expect(isOutboundCallingEnabled(config)).toBe(false);
  });

  it("loads complete Twilio and outbound calling configuration", () => {
    const config = loadConfig({
      PORT: "3025",
      ...COMPLETE_TWILIO_ENV,
      ...COMPLETE_OUTBOUND_POLICY,
    });

    expect(config.port).toBe(3025);
    expect(config.publicWebhookBaseUrl?.toString()).toBe("https://calls.example.com/");
    expect(config.twilio).toEqual({
      accountSid: COMPLETE_TWILIO_ENV.TWILIO_ACCOUNT_SID,
      authToken: COMPLETE_TWILIO_ENV.TWILIO_AUTH_TOKEN,
      phoneNumber: COMPLETE_TWILIO_ENV.TWILIO_PHONE_NUMBER,
    });
    expect(config.internalApiToken).toBe("service-token");
    expect(config.allowedDestinations).toEqual(new Set(["+15551234567", "+15557654321"]));
    expect(isTwilioConfigured(config)).toBe(true);
    expect(isOutboundCallingEnabled(config)).toBe(true);
  });

  it("supports inbound webhooks without enabling outbound calling", () => {
    const config = loadConfig({
      ...COMPLETE_TWILIO_ENV,
      TWILIO_PUBLIC_WEBHOOK_BASE_URL: "https://calls.example.com",
    });

    expect(isTwilioConfigured(config)).toBe(true);
    expect(isOutboundCallingEnabled(config)).toBe(false);
  });

  it.each([
    [{ TWILIO_ACCOUNT_SID: "AC123" }],
    [{ TWILIO_AUTH_TOKEN: "secret-token", TWILIO_PHONE_NUMBER: "+15551234567" }],
  ])("rejects partial Twilio credentials", (environment) => {
    expect(() => loadConfig(environment)).toThrow(ConfigurationError);
  });

  it.each([
    [{ TWILIO_PUBLIC_WEBHOOK_BASE_URL: "https://calls.example.com" }],
    [{ TWILIO_INTERNAL_API_TOKEN: "service-token" }],
    [{ TWILIO_OUTBOUND_ALLOWED_DESTINATIONS: "+15551234567" }],
  ])("rejects partial outbound policy configuration", (environment) => {
    expect(() => loadConfig(environment)).toThrow(ConfigurationError);
  });

  it("rejects an outbound policy without Twilio credentials", () => {
    expect(() => loadConfig({
      TWILIO_INTERNAL_API_TOKEN: COMPLETE_OUTBOUND_POLICY.TWILIO_INTERNAL_API_TOKEN,
      TWILIO_OUTBOUND_ALLOWED_DESTINATIONS: COMPLETE_OUTBOUND_POLICY.TWILIO_OUTBOUND_ALLOWED_DESTINATIONS,
    })).toThrow(ConfigurationError);
  });

  it("rejects a public webhook URL without Twilio credentials", () => {
    expect(() => loadConfig({
      TWILIO_PUBLIC_WEBHOOK_BASE_URL: COMPLETE_OUTBOUND_POLICY.TWILIO_PUBLIC_WEBHOOK_BASE_URL,
    })).toThrow(ConfigurationError);
  });

  it.each([
    [{ PORT: "0" }],
    [{ PORT: "65536" }],
    [{ PORT: "3.1" }],
    [{ ...COMPLETE_TWILIO_ENV, TWILIO_PHONE_NUMBER: "15551234567" }],
    [{ ...COMPLETE_TWILIO_ENV, TWILIO_PUBLIC_WEBHOOK_BASE_URL: "not a URL" }],
    [{ ...COMPLETE_TWILIO_ENV, TWILIO_PUBLIC_WEBHOOK_BASE_URL: "ftp://calls.example.com" }],
    [{ ...COMPLETE_TWILIO_ENV, TWILIO_PUBLIC_WEBHOOK_BASE_URL: "https://calls.example.com/base" }],
    [{ ...COMPLETE_TWILIO_ENV, TWILIO_PUBLIC_WEBHOOK_BASE_URL: "https://calls.example.com", TWILIO_INTERNAL_API_TOKEN: "token", TWILIO_OUTBOUND_ALLOWED_DESTINATIONS: "+15551234567,not-a-number" }],
  ])("rejects malformed configuration", (environment) => {
    expect(() => loadConfig(environment)).toThrow(ConfigurationError);
  });

  it("does not expose configured secrets in configuration errors", () => {
    const secret = "should-never-appear-in-an-error";

    try {
      loadConfig({ TWILIO_ACCOUNT_SID: secret });
      throw new Error("Expected configuration loading to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(String(error)).not.toContain(secret);
    }
  });

  it.each([
    ["+15551234567", true],
    ["+1", false],
    ["15551234567", false],
    ["+1555123456789012", false],
    ["+1555 123 4567", false],
  ])("validates E.164 numbers", (value, expected) => {
    expect(isE164Number(value)).toBe(expected);
  });
});
