import type { Operator, OperatorContext, OperatorResult } from "./base"
import type { PlannedTask } from "../planner/task-graph"
import { skillRegistry } from "../skills/registry"
import type { ArtifactRecord } from "../governance/artifact"
import { ARTIFACT_SCHEMA_VERSION } from "../workflows/artifact-schemas"

interface VerificationCheck {
  id: string
  name: string
  passed: boolean
  details: string
}

export class VerifyOperator implements Operator {
  type = "verify"

  async execute(task: PlannedTask, ctx: OperatorContext): Promise<OperatorResult> {
    const skillId = "trust-verify"
    const skill = skillRegistry.get(skillId)

    const contextPack = ctx.contextPack
    const checks = this.runVerificationChecks(contextPack)

    const blockers = checks.filter((c) => !c.passed && c.details.includes("critical")).map((c) => c.name)
    const warnings = checks.filter((c) => !c.passed && !c.details.includes("critical")).map((c) => c.name)

    const passedCount = checks.filter((c) => c.passed).length
    const trustScore = passedCount / checks.length
    const evidence = contextPack?.artifacts?.map((a: any) => a.path) || []

    // Create structured report
    const payload = {
      checks_passed: passedCount,
      checks_failed: checks.length - passedCount,
      trust_score: trustScore,
      blockers,
      warnings,
      evidence,
      verification_summary:
        blockers.length > 0
          ? `Verification failed with ${blockers.length} critical blockers.`
          : warnings.length > 0
            ? `Verification passed with ${warnings.length} warnings.`
            : `Verification passed successfully.`,
    }

    // Generate markdown output for stream display
    const markdownOutput = this.formatVerificationAsMarkdown(checks, trustScore, blockers, warnings, evidence)

    const timestamp = new Date().toISOString()

    // Produce artifact with schema
    const artifact: ArtifactRecord = {
      id: `verify-report-${Date.now()}`,
      sessionId: ctx.sessionId,
      taskId: task.id,
      producingOperator: this.type,
      type: "verification_report",
      description: payload.verification_summary,
      path: `verification-report.json`,
      timestamp,
    } as any

    // Add schema metadata to output
    const report = {
      schema_version: ARTIFACT_SCHEMA_VERSION,
      artifact_type: "verification_report",
      workflow_id: contextPack?.workflowId,
      operator: this.type,
      created_at: timestamp,
      summary: payload.verification_summary,
      payload,
    }

    // Emit trust delta
    const trustDelta =
      trustScore < 0.5
        ? { taskId: task.id, change: -0.1, reason: "Verification failed: critical blockers found", timestamp }
        : { taskId: task.id, change: 0.05, reason: "Verification passed", timestamp }

    return {
      success: true,
      output: report,
      markdownOutput,
      artifacts: [artifact],
      trustDelta,
      findings: blockers.map((b) => ({
        id: `finding-${b}`,
        type: "security_risk" as const,
        severity: "critical" as const,
        title: `Blocker: ${b}`,
        description: `Verification check failed for ${b}`,
        evidence: [],
        confirmed: true,
        timestamp,
      })),
      risks: warnings.map((w) => ({
        id: `risk-${w}`,
        description: `Warning: ${w}`,
        likelihood: "medium" as const,
        impact: "medium" as const,
        status: "identified" as const,
        timestamp,
      })),
    }
  }

  private formatVerificationAsMarkdown(
    checks: VerificationCheck[],
    trustScore: number,
    blockers: string[],
    warnings: string[],
    evidence: string[],
  ): string {
    const passedChecks = checks.filter((c) => c.passed)
    const failedChecks = checks.filter((c) => !c.passed)

    let md = `## Verification Results\n\n`
    md += `**Trust Score:** ${Math.round(trustScore * 100)}% `
    md += blockers.length > 0 ? `❌ BLOCKED` : warnings.length > 0 ? `⚠️ WARNING` : `✅ PASSED`
    md += `\n\n`

    if (passedChecks.length > 0) {
      md += `### ✅ Passed Checks\n`
      for (const check of passedChecks) {
        md += `- ${check.name}\n`
      }
      md += `\n`
    }

    if (failedChecks.length > 0) {
      md += `### ❌ Failed Checks\n`
      for (const check of failedChecks) {
        md += `- **${check.name}**: ${check.details}\n`
      }
      md += `\n`
    }

    if (blockers.length > 0) {
      md += `### 🚫 Blockers\n`
      for (const blocker of blockers) {
        md += `- ${blocker}\n`
      }
      md += `\n`
    }

    if (warnings.length > 0) {
      md += `### ⚠️ Warnings\n`
      for (const warning of warnings) {
        md += `- ${warning}\n`
      }
      md += `\n`
    }

    if (evidence.length > 0) {
      md += `### 📄 Evidence\n`
      for (const e of evidence.slice(0, 5)) {
        md += `- \`${e}\`\n`
      }
    }

    return md
  }

  private runVerificationChecks(contextPack: any): VerificationCheck[] {
    const checks: VerificationCheck[] = []

    const hasExploreArtifacts = contextPack?.artifacts?.some((a: any) => a.type === "explore_report")
    checks.push({
      id: "check-explore-artifacts",
      name: "Explore Artifacts Present",
      passed: !!hasExploreArtifacts,
      details: hasExploreArtifacts ? "Explore artifacts found" : "No explore artifacts found - run explore first",
    })

    const trustScore = contextPack?.trustState?.score || 0
    checks.push({
      id: "check-trust-score",
      name: "Trust Score Threshold",
      passed: trustScore >= 0.3,
      details: `Trust score is ${trustScore}`,
    })

    const criticalQuestions = contextPack?.openQuestions?.filter(
      (q: any) => q.priority === "high" && q.status === "unanswered",
    )
    checks.push({
      id: "check-open-questions",
      name: "No Blocking Questions",
      passed: !criticalQuestions || criticalQuestions.length === 0,
      details: criticalQuestions?.length
        ? `${criticalQuestions.length} high-priority questions unanswered`
        : "No blocking questions",
    })

    return checks
  }
}
