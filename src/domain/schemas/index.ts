/**
 * Shared domain contracts for PolicyScout.
 *
 * These are the Checkpoint-1 contracts every engineer codes against. Import
 * from "@/domain/schemas" and never redefine these shapes elsewhere. Do not
 * silently modify a contract after the first integration checkpoint — bump a
 * version and tell the team.
 */
export * from "./insurance-line.js";
export * from "./provenance.js";
export * from "./common.js";
export * from "./workflow-state.js";
export * from "./insurance-profile.js";
export * from "./private-constraints.js";
export * from "./confirmed-quote-request.js";
export * from "./evidence.js";
export * from "./provider-research-brief.js";
export * from "./normalized-quote.js";
export * from "./negotiation.js";
export * from "./recommendation.js";
