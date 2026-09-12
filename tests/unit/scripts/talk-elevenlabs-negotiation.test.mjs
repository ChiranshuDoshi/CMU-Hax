import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "vitest";

const SCRIPT_PATH = resolve("scripts/talk-elevenlabs-negotiation.py");
const HASH = "a".repeat(64);
const PYTHON_HELPER = String.raw`
import importlib.util
import contextlib
import io
import json
import pathlib
import sys
import types

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("talk_elevenlabs_negotiation", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
session = module.load_session(pathlib.Path(sys.argv[2]))
operation = sys.argv[3]

if operation == "dynamic":
    result = module.build_dynamic_variables(session)
elif operation == "leverage":
    result = module.build_verified_competing_quote_response(session)
else:
    class FakeElevenLabs:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class FakeClientTools:
        def __init__(self):
            self.registered = {}

        def register(self, name, callback):
            self.registered[name] = callback

    class FakeConversationInitiationData:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class FakeThread:
        def is_alive(self):
            return False

    class FakeConversation:
        instances = []

        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self._thread = FakeThread()
            self.start_calls = 0
            self.end_calls = 0
            self.wait_calls = 0
            self.__class__.instances.append(self)

        def start_session(self):
            self.start_calls += 1

        def end_session(self):
            self.end_calls += 1
            self.kwargs["callback_end_session"]()

        def wait_for_session_end(self):
            self.wait_calls += 1
            return "conversation-test-id"

    client_module = types.ModuleType("elevenlabs.client")
    client_module.ElevenLabs = FakeElevenLabs
    conversation_module = types.ModuleType("elevenlabs.conversational_ai.conversation")
    conversation_module.ClientTools = FakeClientTools
    conversation_module.Conversation = FakeConversation
    conversation_module.ConversationInitiationData = FakeConversationInitiationData
    sys.modules["elevenlabs"] = types.ModuleType("elevenlabs")
    sys.modules["elevenlabs.client"] = client_module
    sys.modules["elevenlabs.conversational_ai"] = types.ModuleType("elevenlabs.conversational_ai")
    sys.modules["elevenlabs.conversational_ai.conversation"] = conversation_module

    class FakeAudio:
        def __init__(self):
            self.error = None

    module.preflight_audio = lambda: None
    module.TerminalAudioInterface = FakeAudio
    leverage = module.build_verified_competing_quote_response(session)
    with contextlib.redirect_stdout(io.StringIO()):
        conversation_id = module.run_live("api-key", "agent-id", {"user_display_name": "Alex Morgan"}, leverage)
    conversation = FakeConversation.instances[0]
    result = {
        "conversation_id": conversation_id,
        "conversation_instances": len(FakeConversation.instances),
        "start_calls": conversation.start_calls,
        "end_calls": conversation.end_calls,
        "wait_calls": conversation.wait_calls,
        "tool_payload": conversation.kwargs["client_tools"].registered["get_verified_competing_quote"]({}),
    }
print(json.dumps(result))
`;

function createSession(overrides = {}) {
  const competing = {
    providerId: "provider-competitor",
    providerName: "Verified Mutual",
    quoteId: "quote-competitor",
    effectiveComparisonCostCents: 123456,
    coverageEquivalence: { status: "equivalent", differences: [] },
    evidenceIds: ["evidence-1"],
  };
  return {
    participant: { displayName: "  Alex Morgan  " },
    handoff: {
      workflowId: "workflow-1",
      specificationHash: HASH,
      target: {
        providerId: "provider-target",
        providerName: "Target Insurance",
        quoteId: "quote-target",
        effectiveComparisonCostCents: 180000,
        policyTermMonths: 12,
        coverageEquivalence: { status: "equivalent", differences: [] },
      },
      verifiedCompetingQuote: competing,
    },
    goal: {
      id: "goal-1",
      workflowId: "workflow-1",
      selectedQuoteId: "quote-target",
      targetProviderId: "provider-target",
      verifiedCompetingQuoteId: competing.quoteId,
    },
    explicitSelection: {
      providerId: "provider-target",
      quoteId: "quote-target",
      specificationHash: HASH,
    },
    ...overrides,
  };
}

async function invoke(session, operation) {
  const directory = await mkdtemp(resolve(tmpdir(), "terminal-negotiation-"));
  const sessionPath = resolve(directory, "session.json");
  await writeFile(sessionPath, JSON.stringify(session));
  try {
    const result = spawnSync("python3", ["-c", PYTHON_HELPER, SCRIPT_PATH, sessionPath, operation], {
      encoding: "utf8",
    });
    return { ...result, json: result.status === 0 ? JSON.parse(result.stdout) : null };
  } finally {
    await rm(directory, { recursive: true });
  }
}

describe("terminal ElevenLabs negotiation session", () => {
  it("uses the trimmed participant identity as a safe dynamic variable", async () => {
    const result = await invoke(createSession(), "dynamic");

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.user_display_name, "Alex Morgan");
  });

  it("returns only verified competing leverage without private goal values", async () => {
    const session = createSession();
    session.goal.targetAmountCents = 99999;
    const result = await invoke(session, "leverage");

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.json, {
      has_verified_competing_quote: true,
      allowed_leverage_text: "A verified comparable quote from Verified Mutual has a normalized comparison cost of 123456 cents.",
    });
    assert.doesNotMatch(JSON.stringify(result.json), /99999/);
  });

  it("returns no leverage when the prepared session has no verified competing quote", async () => {
    const session = createSession();
    session.handoff.verifiedCompetingQuote = null;
    session.goal.verifiedCompetingQuoteId = null;
    const result = await invoke(session, "leverage");

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.json, { has_verified_competing_quote: false });
  });

  it("rejects competing quotes with non-qualifying coverage", async () => {
    for (const status of ["not_comparable", "worse_than_requested"]) {
      const session = createSession();
      session.handoff.verifiedCompetingQuote.coverageEquivalence.status = status;
      const result = await invoke(session, "leverage");

      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.json, { has_verified_competing_quote: false });
    }
  });

  it("rejects missing or invalid participant identity", async () => {
    const missing = createSession();
    delete missing.participant;
    const missingResult = await invoke(missing, "dynamic");
    assert.notEqual(missingResult.status, 0);
    assert.match(missingResult.stderr, /participant\.displayName/);

    for (const displayName of ["   ", "Alex\u0000Morgan", "Alex\u0085Morgan", "x".repeat(121)]) {
      const invalidResult = await invoke(createSession({ participant: { displayName } }), "dynamic");
      assert.notEqual(invalidResult.status, 0);
      assert.match(invalidResult.stderr, /participant\.displayName/);
    }
  });

  it("runs one conversation with verified leverage and always performs SDK cleanup", async () => {
    const result = await invoke(createSession(), "run-live");

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.json, {
      conversation_id: "conversation-test-id",
      conversation_instances: 1,
      start_calls: 1,
      end_calls: 1,
      wait_calls: 1,
      tool_payload: {
        has_verified_competing_quote: true,
        allowed_leverage_text: "A verified comparable quote from Verified Mutual has a normalized comparison cost of 123456 cents.",
      },
    });
  });
});
