import { type WorkflowState } from "../schemas/workflow-state.js";

/**
 * Server-enforced workflow transitions. (Spec §8.)
 *
 * The happy path follows the canonical workflow; `failed`, `archived`, and
 * `human_handoff_required` are reachable from most working states and are
 * appended automatically below. Invalid transitions are rejected.
 */
const HAPPY_PATH: Partial<Record<WorkflowState, WorkflowState[]>> = {
  draft: ["profile_in_progress"],
  profile_in_progress: ["documents_uploaded", "ready_for_confirmation"],
  documents_uploaded: ["parsing_documents", "profile_in_progress"],
  parsing_documents: ["profile_extracted"],
  profile_extracted: ["intake_in_progress", "ready_for_confirmation", "profile_in_progress"],
  intake_in_progress: ["ready_for_confirmation", "profile_in_progress"],
  ready_for_confirmation: ["confirmed", "profile_in_progress"],
  confirmed: ["researching"],
  researching: ["providers_ranked"],
  providers_ranked: ["top_five_confirmed"],
  top_five_confirmed: ["initial_conversations_ready"],
  initial_conversations_ready: ["initial_conversations_running"],
  initial_conversations_running: ["quotes_processing"],
  quotes_processing: ["quotes_ready"],
  quotes_ready: ["negotiation_target_selected"],
  negotiation_target_selected: ["negotiation_goal_confirmed", "quotes_ready"],
  negotiation_goal_confirmed: ["negotiation_running"],
  negotiation_running: ["report_ready"],
  report_ready: [],
  human_handoff_required: [],
  failed: [],
  archived: [],
};

/** States from which no further transition is possible. */
export const TERMINAL_STATES: ReadonlySet<WorkflowState> = new Set([
  "archived",
]);

/** States that may bail out to failure / human handoff. */
const CAN_FAIL: ReadonlySet<WorkflowState> = new Set<WorkflowState>([
  "parsing_documents",
  "researching",
  "initial_conversations_running",
  "quotes_processing",
  "negotiation_running",
]);
const CAN_HANDOFF: ReadonlySet<WorkflowState> = new Set<WorkflowState>([
  "initial_conversations_running",
  "quotes_processing",
  "negotiation_running",
  "quotes_ready",
]);

/** Full transition map with terminal escapes folded in. */
export const TRANSITIONS: Record<WorkflowState, ReadonlySet<WorkflowState>> =
  (Object.keys(HAPPY_PATH) as WorkflowState[]).reduce(
    (acc, state) => {
      const next = new Set<WorkflowState>(HAPPY_PATH[state] ?? []);
      if (CAN_FAIL.has(state)) next.add("failed");
      if (CAN_HANDOFF.has(state)) next.add("human_handoff_required");
      // Anything not already terminal may be archived (e.g. reset demo).
      if (!TERMINAL_STATES.has(state)) next.add("archived");
      acc[state] = next;
      return acc;
    },
    {} as Record<WorkflowState, ReadonlySet<WorkflowState>>
  );

export function canTransition(from: WorkflowState, to: WorkflowState): boolean {
  return TRANSITIONS[from]?.has(to) ?? false;
}

/** The valid next states from `state` (what the UI offers as "next action"). */
export function nextStates(state: WorkflowState): WorkflowState[] {
  return [...(TRANSITIONS[state] ?? [])];
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: WorkflowState,
    public readonly to: WorkflowState
  ) {
    super(`Invalid workflow transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

/** Throw unless the transition is allowed. Returns the new state on success. */
export function assertTransition(
  from: WorkflowState,
  to: WorkflowState
): WorkflowState {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
  return to;
}
