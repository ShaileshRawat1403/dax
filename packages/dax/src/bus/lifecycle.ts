import z from "zod"
import { BusEvent } from "./bus-event"
import { Identifier } from "../id/id"
import { RunStatus, StepStatus, ApprovalRecord, ArtifactRecord, RunTrustState } from "../server/run-contract"

/**
 * Canonical DAX Lifecycle Events.
 * 
 * These events formalize the "intent -> plan -> execution -> intervention -> output -> trust" narrative.
 * They are additive and intended to eventually drive all session projections (TUI, Soothsayer, CLI).
 */
export namespace Lifecycle {
  /**
   * Emitted when the user input is parsed and an execution contract/intent is established.
   */
  export const IntentCreated = BusEvent.define(
    "intent.created",
    z.object({
      runId: Identifier.schema("session"),
      intentType: z.string(),
      goal: z.string(),
      riskLevel: z.enum(["low", "medium", "high"]),
      confidence: z.number(),
    }),
  )

  /**
   * Emitted when the Planner produces a TaskGraph (the formal execution plan).
   */
  export const PlanCompiled = BusEvent.define(
    "plan.compiled",
    z.object({
      runId: Identifier.schema("session"),
      planId: z.string(),
      tasks: z.array(z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        dependencies: z.array(z.string()),
      })),
    }),
  )

  /**
   * Emitted when a specific step in the plan is promoted to 'active' or 'running'.
   */
  export const PlanStepPromoted = BusEvent.define(
    "plan.step_promoted",
    z.object({
      runId: Identifier.schema("session"),
      stepId: z.string(),
      status: StepStatus,
    }),
  )

  /**
   * Emitted when execution is paused because it requires operator intervention
   * (e.g., RAO policy hit, explicit human-in-the-loop task).
   */
  export const InterventionRequired = BusEvent.define(
    "intervention.required",
    z.object({
      runId: Identifier.schema("session"),
      reason: z.string(),
      type: z.enum(["policy_violation", "hitl_task", "ambiguity", "error_recovery"]),
      approvalId: z.string().optional(),
    }),
  )

  /**
   * Emitted when a formal approval is requested.
   * (Kept separate from intervention.required for granular projection).
   */
  export const ApprovalRequested = BusEvent.define(
    "approval.requested",
    z.object({
      runId: Identifier.schema("session"),
      approval: ApprovalRecord,
    }),
  )

  /**
   * Emitted when an approval decision is reached.
   */
  export const ApprovalResolved = BusEvent.define(
    "approval.resolved",
    z.object({
      runId: Identifier.schema("session"),
      approvalId: z.string(),
      decision: z.enum(["approve", "deny"]),
      comment: z.string().optional(),
    }),
  )

  /**
   * Emitted when a meaningful artifact is produced during execution.
   */
  export const ArtifactCreated = BusEvent.define(
    "artifact.created",
    z.object({
      runId: Identifier.schema("session"),
      artifact: ArtifactRecord,
    }),
  )

  /**
   * Emitted when the audit posture or trust score of the session changes.
   */
  export const AuditPostureUpdated = BusEvent.define(
    "audit.posture_updated",
    z.object({
      runId: Identifier.schema("session"),
      trust: RunTrustState,
      finding: z.object({
        type: z.string(),
        severity: z.enum(["critical", "major", "minor", "info"]),
        title: z.string(),
      }).optional(),
    }),
  )

  /**
   * Emitted when the overall run state changes (created -> running -> completed/failed).
   */
  export const RunStateChanged = BusEvent.define(
    "run.state_changed",
    z.object({
      runId: Identifier.schema("session"),
      previousStatus: RunStatus,
      currentStatus: RunStatus,
      reason: z.string().optional(),
    }),
  )
}
