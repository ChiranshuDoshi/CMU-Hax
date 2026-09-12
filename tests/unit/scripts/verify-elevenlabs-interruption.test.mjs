import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, it } from "vitest";

const SCRIPT_PATH = resolve("scripts/verify-elevenlabs-interruption.py");
const PYTHON_HELPER = String.raw`
import importlib.util
import json
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("verify_elevenlabs_interruption", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
if sys.argv[2] == "interface":
    audio = module.ScriptedAudioInterface({}, clock=lambda: 1.0)
    audio.output(b"\x01\x02\x03")
    buffered_before = len(audio.output_buffer)
    audio.interrupt()
    audio.stop()
    result = {
        "bufferedBefore": buffered_before,
        "bufferedAfter": len(audio.output_buffer),
        "interruptions": audio.interruptions,
        "cleanStop": audio.clean_stop,
    }
elif sys.argv[2] == "blocking_cleanup":
    import threading
    import time

    class BlockingConversation:
        def __init__(self):
            self.entered = threading.Event()

        def end_session(self):
            self.entered.set()
            threading.Event().wait(10)

        def wait_for_session_end(self):
            raise AssertionError("wait_for_session_end must not run while end_session is blocked")

    conversation = BlockingConversation()
    audio = module.ScriptedAudioInterface({}, clock=time.monotonic)
    started_at = time.monotonic()
    error = None
    try:
        module.cleanup_session_bounded(conversation, audio, True, 0.05)
    except RuntimeError as caught:
        error = str(caught)
    result = {
        "entered": conversation.entered.is_set(),
        "elapsedMs": round((time.monotonic() - started_at) * 1000),
        "error": error,
        "cleanStop": audio.clean_stop,
    }
else:
    payload = json.loads(sys.stdin.read())
    result = module.evaluate_verification(payload)
print(json.dumps(result))
`;

function passingResult() {
  const opening = "Hi, I'm PolicyScout, an AI agent working on behalf of Alex Morgan. We're reviewing Alex Morgan's quote. What can you do to lower the price without changing coverage?";
  const responseTexts = [
    opening,
    "I hear the $1,900 base price remains fixed. What discount can you apply while keeping every coverage term unchanged?",
    "So the policy-period cost is $1,800, derived monthly cost is $150.00, coverage is unchanged, the $100 e-billing discount applies, there are no added fees, and the offer is non-binding pending human review. Is that correct?",
    "Thank you for confirming. I have recorded the improved terms.",
  ];
  const responses = responseTexts.map((text, index) => ({ text, atMs: index * 1_000 }));
  const transcripts = [
    { role: "agent", text: responseTexts[0], atMs: 0 },
    { role: "user", text: "The current policy-period cost is $2,000.", atMs: 500 },
    { role: "user", text: "Sorry, correction: the base price is $1,900 and remains fixed.", atMs: 1_000 },
    { role: "agent", text: responseTexts[1], atMs: 2_000 },
    { role: "user", text: "I can apply a $100 e-billing discount. The final policy-period cost is $1,800, the derived monthly effective cost is $150.00, coverage is unchanged, there are zero added fees, and the offer is non-binding pending human review.", atMs: 3_000 },
    { role: "agent", text: responseTexts[2], atMs: 4_000 },
    { role: "user", text: "I explicitly confirm your final readback: $1,800, $150.00 derived monthly, coverage unchanged, a $100 e-billing discount, zero added fees, non-binding pending human review.", atMs: 5_000 },
    { role: "agent", text: responseTexts[3], atMs: 6_000 },
  ];

  return {
    passed: true,
    check: "elevenlabs-live-interruption",
    timeline: [
      { type: "agent_response", text: responseTexts[0], atMs: 0 },
      { type: "audio_buffered", bytes: 6_400, atMs: 600 },
      { type: "input_audio", turn: "correction", atMs: 700 },
      { type: "interruption", bufferedBytes: 6_400, atMs: 900 },
      { type: "user_transcript", text: transcripts[2].text, atMs: 1_000 },
      { type: "agent_response", text: responseTexts[1], atMs: 2_000 },
      { type: "user_transcript", text: transcripts[4].text, atMs: 3_000 },
      { type: "agent_response", text: responseTexts[2], atMs: 4_000 },
      { type: "user_transcript", text: transcripts[6].text, atMs: 5_000 },
      { type: "tool_call", text: "record_negotiation_event", atMs: 5_500 },
    ],
    transcripts,
    responses,
    corrections: [],
    interruptions: [{ atMs: 900, bargeInAtMs: 700, bufferedBytes: 6_400, nonzeroBufferedBytes: 6_000, latencyMs: 200 }],
    toolCalls: [
      {
        name: "record_negotiation_event",
        arguments: {
          outcome: "improved_terms",
          providerResponse: transcripts[6].text,
          finalCostCents: 180_000,
          derivedMonthlyEffectiveCostCents: 15_000,
          coverageUnchanged: true,
          concessionType: "$100 e-billing discount",
          addedFeesCents: 0,
          bindingStatus: "pending_review",
        },
        atMs: 5_500,
      },
    ],
    conversationId: "conversation-live-interruption-test",
    conversationCount: 1,
    cleanStop: true,
    interruptionLatencyBoundMs: 3_000,
    participantDisplayName: "Alex Morgan",
    expectedOpening: opening,
    scenario: {
      participantName: "Alex Morgan",
      opening,
      unresolvedObjective: "lower the price while keeping every coverage term unchanged",
      originalPriceCents: 200_000,
      expectedCorrectedPriceCents: 190_000,
      expectedLowerPriceCents: 180_000,
      expectedDerivedMonthlyCents: 15_000,
      expectedDiscountCents: 10_000,
    },
  };
}

function evaluate(result) {
  const processResult = invokePython("evaluate", JSON.stringify(result));
  assert.equal(processResult.status, 0, processResult.stderr);
  return JSON.parse(processResult.stdout);
}

function invokePython(operation, input = "") {
  return spawnSync("python3", ["-c", PYTHON_HELPER, SCRIPT_PATH, operation], {
    encoding: "utf8",
    input,
  });
}

function replaceResponse(result, index, text) {
  const transcriptIndexes = [0, 3, 5, 7];
  const timelineIndexes = [0, 5, 7];
  result.responses[index].text = text;
  result.transcripts[transcriptIndexes[index]].text = text;
  if (timelineIndexes[index] !== undefined) result.timeline[timelineIndexes[index]].text = text;
}

describe("live ElevenLabs interruption verifier", () => {
  it("imports without the ElevenLabs SDK and accepts a complete simulated result", () => {
    assert.deepEqual(evaluate(passingResult()), []);
  });

  it("buffers output, measures interruption, and stops without audio hardware", () => {
    const processResult = invokePython("interface");
    assert.equal(processResult.status, 0, processResult.stderr);
    const result = JSON.parse(processResult.stdout);

    assert.equal(result.bufferedBefore, 3);
    assert.equal(result.bufferedAfter, 0);
    assert.equal(result.interruptions.length, 1);
    assert.equal(result.interruptions[0].bufferedBytes, 3);
    assert.equal(result.interruptions[0].nonzeroBufferedBytes, 3);
    assert.equal(result.cleanStop, true);
  });

  it("bounds a blocking synchronous SDK close and still stops local audio", () => {
    const processResult = invokePython("blocking_cleanup");
    assert.equal(processResult.status, 0, processResult.stderr);
    const result = JSON.parse(processResult.stdout);

    assert.equal(result.entered, true);
    assert.match(result.error, /bounded cleanup window/i);
    assert.ok(result.elapsedMs < 1_000, `cleanup took ${result.elapsedMs}ms`);
    assert.equal(result.cleanStop, true);
  });

  it("accepts a number-word corrected price and small timestamp rounding", () => {
    const result = passingResult();
    const response = "Thanks. With the base price fixed at one thousand nine hundred dollars, what fee waivers or approved discounts might be available to lower the overall cost?";
    replaceResponse(result, 1, response);
    result.timeline[3].atMs = 1_002;
    result.interruptions[0].atMs = 902;
    result.interruptions[0].bargeInAtMs = 702;
    result.interruptions[0].latencyMs = 200;
    result.timeline[4].atMs = 2_002;
    assert.deepEqual(evaluate(result), []);
  });

  it("accepts a correctly tagged correction barge-in when final ASR arrives after 15 seconds", () => {
    const result = passingResult();
    // Keep the server interruption tied to the correction audio, but model a delayed
    // final transcript and the ordered follow-up events arriving much later.
    result.transcripts[2].atMs = 16_001;
    result.responses[1].atMs = 17_000;
    result.responses[2].atMs = 19_000;
    result.responses[3].atMs = 21_000;
    result.timeline[3].atMs = 16_001;
    result.timeline[4].atMs = 17_000;
    result.timeline[5].atMs = 18_000;
    result.timeline[6].atMs = 19_000;
    result.timeline[7].atMs = 20_000;
    result.timeline[8].atMs = 21_000;
    result.timeline[9].atMs = 21_500;
    result.toolCalls[0].atMs = 21_500;
    assert.deepEqual(evaluate(result), []);
  });

  it("rejects a tool call whose event timestamp predates confirmation even when timeline order is spoofed", () => {
    const result = passingResult();
    result.toolCalls[0].atMs = 4_500;
    const issues = evaluate(result);
    assert.ok(issues.includes("record_negotiation_event was called before final provider confirmation"));
  });

  const invalidCases = [
    ["repeats the opening", (result) => {
      result.responses.push({ text: result.expectedOpening, atMs: 7_000 });
      result.transcripts.push({ role: "agent", text: result.scenario.opening });
      result.timeline.push({ type: "agent_response", text: result.scenario.opening });
    }],
    ["uses hackathon language in the opening", (result) => {
      replaceResponse(result, 0, `${result.scenario.opening} This is for a hackathon demo.`);
      result.expectedOpening = result.responses[0].text;
    }],
    ["omits participant identity", (result) => {
      replaceResponse(result, 0, "Hello, I'm PolicyScout calling about the current auto policy quote.");
      result.expectedOpening = result.responses[0].text;
    }],
    ["has no interruption", (result) => { result.interruptions = []; }],
    ["interrupts without buffered audio", (result) => { result.interruptions[0].bufferedBytes = 0; }],
    ["only has a spurious interruption before the correction barge-in", (result) => {
      result.interruptions = [{
        atMs: 400,
        bargeInAtMs: 200,
        bufferedBytes: 6_400,
        nonzeroBufferedBytes: 6_000,
        latencyMs: 200,
      }];
    }],
    ["restarts after interruption", (result) => { replaceResponse(result, 1, result.scenario.opening); }],
    ["uses the stale price after correction", (result) => {
      replaceResponse(result, 1, "Thanks. The current cost is $2,000. What can you lower it to?");
    }],
    ["does not resume the unresolved objective", (result) => {
      replaceResponse(result, 1, "Thanks for the correction. How are you today?");
    }],
    ["does not reuse the provider's fixed-price constraint", (result) => {
      replaceResponse(result, 1, "Thanks for correcting that to $1,900. What discount can you apply while keeping coverage unchanged?");
    }],
    ["uses the wrong number-word correction", (result) => {
      replaceResponse(result, 1, "Thanks. With the base price fixed at one thousand eight hundred dollars, what fee waivers or approved discounts might be available?");
    }],
    ["does not obtain the expected lower price", (result) => {
      result.transcripts[4].text = "I can lower it to $1,700 with unchanged coverage and no added fees. It is binding.";
      result.transcripts[6].text = "That is correct: $1,700, unchanged coverage, no fees, and binding.";
      result.timeline[5].text = result.transcripts[4].text;
      result.timeline[7].text = result.transcripts[6].text;
      replaceResponse(result, 2, "So the policy-period cost is $1,700, derived monthly cost is $141.67, coverage is unchanged, the $100 e-billing discount applies, there are no added fees, and the offer is non-binding pending human review. Is that correct?");
      replaceResponse(result, 3, "Thank you for confirming the $1,700 offer. I have recorded the improved terms.");
      result.toolCalls[0].arguments.providerResponse = result.transcripts[6].text;
      result.toolCalls[0].arguments.finalCostCents = 170_000;
      result.toolCalls[0].arguments.derivedMonthlyEffectiveCostCents = 14_167;
    }],
    ["records before provider confirmation", (result) => {
      result.toolCalls[0].atMs = 4_500;
      result.timeline.splice(7, 0, result.timeline.pop());
    }],
    ["offers after the agent readback", (result) => {
      const offer = result.timeline.splice(6, 1)[0];
      result.timeline.splice(8, 0, offer);
    }],
    ["only partially confirms the readback", (result) => {
      result.transcripts[6].text = "I confirm the $1,800 policy-period cost.";
      result.timeline[7].text = result.transcripts[6].text;
    }],
    ["reverses the seller and agent roles", (result) => {
      for (const event of result.transcripts) event.role = event.role === "agent" ? "user" : "agent";
    }],
    ["reintroduces itself with a paraphrased opening", (result) => {
      replaceResponse(result, 1, "Hi, I'm PolicyScout calling for Alex Morgan about your current auto policy quote. The base price is fixed; what discount can you apply while keeping coverage unchanged?");
    }],
    ["splits the final memory across superficial responses", (result) => {
      replaceResponse(result, 2, "The policy-period cost is $1,800 and coverage is unchanged.");
      replaceResponse(result, 3, "There are no added fees, it is non-binding pending human review, and the e-billing discount applies.");
    }],
    ["swaps labeled amounts", (result) => {
      replaceResponse(result, 2, "So the policy-period cost is $150.00, derived monthly cost is $1,800, coverage is unchanged, the $100 e-billing discount applies, there are no added fees, and the offer is non-binding pending human review. Is that correct?");
    }],
    ["labels an e-billing charge as a discount", (result) => {
      replaceResponse(result, 2, "So the policy-period cost is $1,800, derived monthly cost is $150.00, coverage is unchanged, the $100 e-billing charge applies, there are no added fees, and the offer is non-binding pending human review. Is that correct?");
    }],
    ["records the event more than once", (result) => { result.toolCalls.push(structuredClone(result.toolCalls[0])); }],
    ["records a malformed event", (result) => { delete result.toolCalls[0].arguments.coverageUnchanged; }],
    ["omits the conversation ID", (result) => { result.conversationId = ""; }],
    ["serializes a private goal key", (result) => { result.scenario.privateTargetCents = 200_000; }],
  ];

  for (const [description, mutate] of invalidCases) {
    it(`rejects a result that ${description}`, () => {
      const result = passingResult();
      mutate(result);

      const issues = evaluate(result);
      assert.ok(Array.isArray(issues));
      assert.ok(issues.length > 0, `expected at least one issue for: ${description}`);
      assert.ok(issues.every((issue) => typeof issue === "string" && issue.length > 0));
    });
  }
});
