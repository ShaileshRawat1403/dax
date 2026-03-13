import type { Operator, OperatorContext, OperatorResult } from "./base"
import type { PlannedTask } from "../planner/task-graph"
import { skillRegistry } from "../skills/registry"
import type { ArtifactRecord } from "../governance/artifact"
import { ARTIFACT_SCHEMA_VERSION } from "../workflows/artifact-schemas"

export class ReleaseOperator implements Operator {
  type = "release"

  async execute(task: PlannedTask, ctx: OperatorContext): Promise<OperatorResult> {
    const skillId = "release-readiness"
    const skill = skillRegistry.get(skillId)

    const contextPack = ctx.contextPack

    const trustState = contextPack?.trustState
    const artifacts = contextPack?.artifacts || []
    const risks = contextPack?.risks || []
    const findings = contextPack?.validatedFindings || []

    // Determine readiness with governance gates
    const blockers: string[] = []
    const warnings: string[] = []
    const missingEvidence: string[] = []

    // Governance Gate 1: Missing verification report blocks release
    const hasVerification = artifacts.some((a: any) => a.type === "verification_report")
    if (!hasVerification) {
      blockers.push("Verification report missing - release blocked by governance policy")
    }

    // Governance Gate 2: Low trust blocks release
    const trustScore = trustState?.score || 0
    if (trustScore < 0.4) {
      blockers.push(`Trust score too low: ${trustScore.toFixed(2)} - release blocked by governance policy`)
    }

    // Check for artifact inventory
    const hasInventory = artifacts.some((a: any) => a.type === "artifact_inventory")
    if (!hasInventory) {
      missingEvidence.push("Artifact inventory missing")
    }

    // Check for critical risks
    const criticalRisks = risks.filter((r: any) => r.impact === "high" && r.status === "identified")
    if (criticalRisks.length > 0) {
      blockers.push(`${criticalRisks.length} critical risks identified`)
    }

    // Check for critical findings
    const criticalFindings = findings.filter((f: any) => f.severity === "critical")
    if (criticalFindings.length > 0) {
      blockers.push(`${criticalFindings.length} critical findings`)
    }

    // Determine overall status
    let status: "ready" | "blocked" | "needs-work" = "ready"
    if (blockers.length > 0) {
      status = "blocked"
    } else if (warnings.length > 0 || missingEvidence.length > 0) {
      status = "needs-work"
    }

    // Create summary and next steps
    const release_summary =
      status === "blocked"
        ? `Release BLOCKED. ${blockers.length} governance policy violation(s) must be resolved.`
        : status === "needs-work"
          ? `Release needs additional work. ${missingEvidence.length} evidence gap(s) and ${warnings.length} warning(s).`
          : `Release ready. All governance checks passed.`

    const recommended_next_steps =
      status === "blocked"
        ? ["Address all governance blockers", "Run verification again", "Re-assess release readiness"]
        : status === "needs-work"
          ? ["Complete missing evidence", "Address warnings", "Re-run release check"]
          : ["Proceed with release"]

    const timestamp = new Date().toISOString()

    const payload = {
      status,
      blockers,
      warnings,
      missing_evidence: missingEvidence,
      release_summary,
      recommended_next_steps,
    }

    // Produce artifact with schema
    const artifact: ArtifactRecord = {
      id: `release-readiness-${Date.now()}`,
      sessionId: ctx.sessionId,
      taskId: task.id,
      producingOperator: this.type,
      type: "release_report",
      description: release_summary,
      path: `release-readiness.json`,
      timestamp,
    } as any

    // Add schema metadata to output
    const report = {
      schema_version: ARTIFACT_SCHEMA_VERSION,
      artifact_type: "release_report",
      workflow_id: contextPack?.workflowId,
      operator: this.type,
      created_at: timestamp,
      summary: release_summary,
      payload,
    }

    return {
      success: true,
      output: report,
      artifacts: [artifact],
    }
  }
}
