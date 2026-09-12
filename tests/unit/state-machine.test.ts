import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  nextStates,
  InvalidTransitionError,
} from "../../src/domain/state-machine/workflow-machine.js";

describe("workflow state machine (test #30)", () => {
  it("allows the canonical happy-path transition", () => {
    expect(canTransition("confirmed", "researching")).toBe(true);
    expect(canTransition("quotes_ready", "negotiation_target_selected")).toBe(
      true
    );
  });

  it("rejects invalid transitions", () => {
    expect(canTransition("draft", "report_ready")).toBe(false);
    expect(() => assertTransition("draft", "report_ready")).toThrow(
      InvalidTransitionError
    );
  });

  it("permits failure/handoff escapes from working states", () => {
    expect(canTransition("initial_conversations_running", "failed")).toBe(true);
    expect(
      canTransition("negotiation_running", "human_handoff_required")
    ).toBe(true);
  });

  it("archived is terminal", () => {
    expect(nextStates("archived")).toHaveLength(0);
  });
});
