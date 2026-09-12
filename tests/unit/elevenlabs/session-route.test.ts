import { afterEach, describe, expect, it } from "vitest";

import { handleSessionPatch } from "@/app/api/conversations/sessions/[sessionId]/route";
import { ConversationSessionService } from "@/server/services/conversations";

const originalDemoMode = process.env.DEMO_MODE;

afterEach(() => {
  if (originalDemoMode === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = originalDemoMode;
});

function patchRequest(body: unknown, origin = "http://localhost"): Request {
  return new Request("http://localhost/api/conversations/sessions/session", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

describe("conversation session PATCH route", () => {
  it("applies basic lifecycle and transcript actions", async () => {
    process.env.DEMO_MODE = "true";
    const sessions = new ConversationSessionService();
    const created = sessions.create("voice_smoke");
    const context = { params: Promise.resolve({ sessionId: created.id }) };

    expect((await handleSessionPatch(patchRequest({ action: "activate", conversationId: "conv-1" }), context, sessions)).status).toBe(200);
    expect((await handleSessionPatch(patchRequest({ action: "transcript", role: "user", message: "hello" }), context, sessions)).status).toBe(200);
    expect((await handleSessionPatch(patchRequest({ action: "processing" }), context, sessions)).status).toBe(200);
    const response = await handleSessionPatch(patchRequest({ action: "complete" }), context, sessions);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.session.state).toBe("completed");
    expect(body.session.transcript).toHaveLength(1);
  });

  it("applies the same local same-origin gate", async () => {
    process.env.DEMO_MODE = "true";
    const sessions = new ConversationSessionService();
    const created = sessions.create("voice_smoke");
    const response = await handleSessionPatch(
      patchRequest({ action: "cancel" }, "http://evil.test"),
      { params: Promise.resolve({ sessionId: created.id }) },
      sessions,
    );

    expect(response.status).toBe(403);
    expect(sessions.get(created.id).state).toBe("connecting");
  });

  it("does not expose a model-queryable negotiation goal action", async () => {
    process.env.DEMO_MODE = "true";
    const sessions = new ConversationSessionService();
    const created = sessions.create("voice_smoke");
    const response = await handleSessionPatch(
      patchRequest({
        action: "check_goal",
        proposedPolicyPeriodCostCents: 1,
        coverageUnchanged: true,
        addedFeesCents: 0,
      }),
      { params: Promise.resolve({ sessionId: created.id }) },
      sessions,
    );

    expect(response.status).toBe(400);
    expect(sessions.get(created.id).state).toBe("connecting");
  });
});
