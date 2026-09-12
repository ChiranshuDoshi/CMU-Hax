import { z } from "zod";

/**
 * Server-enforced workflow states. (Spec §8.)
 * The state machine in src/domain/state-machine consumes this list.
 */
export const WorkflowStateSchema = z.enum([
  "draft",
  "profile_in_progress",
  "documents_uploaded",
  "parsing_documents",
  "profile_extracted",
  "intake_in_progress",
  "ready_for_confirmation",
  "confirmed",
  "researching",
  "providers_ranked",
  "top_five_confirmed",
  "initial_conversations_ready",
  "initial_conversations_running",
  "quotes_processing",
  "quotes_ready",
  "negotiation_target_selected",
  "negotiation_goal_confirmed",
  "negotiation_running",
  "report_ready",
  "human_handoff_required",
  "failed",
  "archived",
]);

export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

export const WORKFLOW_STATES = WorkflowStateSchema.options;
