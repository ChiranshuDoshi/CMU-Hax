import { beforeEach, describe, expect, it, vi } from "vitest";

const { VoiceResponse, voiceResponses } = vi.hoisted(() => {
  const voiceResponses: Array<{
    say: ReturnType<typeof vi.fn>;
    hangup: ReturnType<typeof vi.fn>;
    toString: ReturnType<typeof vi.fn>;
  }> = [];

  class VoiceResponse {
    readonly say = vi.fn();
    readonly hangup = vi.fn();
    readonly toString = vi.fn(
      () =>
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Say>The AI voice service has not been connected. Goodbye.</Say><Hangup/></Response>",
    );

    constructor() {
      voiceResponses.push(this);
    }
  }

  return { VoiceResponse, voiceResponses };
});

vi.mock("twilio", () => ({
  default: {
    twiml: {
      VoiceResponse,
    },
  },
}));

import { UnconfiguredVoiceSessionResponder } from "../src/voice-session.js";

describe("UnconfiguredVoiceSessionResponder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    voiceResponses.length = 0;
  });

  it("tells the caller the service is unavailable and ends the call", () => {
    const responder = new UnconfiguredVoiceSessionResponder();

    const twiml = responder.createTwiML({
      direction: "inbound",
      callSid: "CA_test_call",
      from: "+15550000001",
      to: "+15550000002",
    });

    expect(voiceResponses).toHaveLength(1);
    expect(voiceResponses[0]?.say).toHaveBeenCalledWith(
      "The AI voice service has not been connected. Goodbye.",
    );
    expect(voiceResponses[0]?.hangup).toHaveBeenCalledOnce();
    expect(twiml).toContain("AI voice service has not been connected");
    expect(twiml).toContain("<Hangup/>");
  });
});
