import type { Operator, OperatorContext, OperatorResult } from "./base"
import type { PlannedTask } from "../planner/task-graph"
import type { ArtifactRecord } from "../governance/artifact"
import { ARTIFACT_SCHEMA_VERSION } from "../workflows/artifact-schemas"
import { writeWorkflowArtifact } from "./report-artifact"

export class ArtifactOperator implements Operator {
  type = "artifact"

  async execute(task: PlannedTask, ctx: OperatorContext): Promise<OperatorResult> {
    const contextPack = ctx.contextPack
    const artifacts = contextPack?.artifacts || []

    // Classify and index artifacts
    const byType: Record<string, number> = {}
    const byOperator: Record<string, number> = {}

    for (const artifact of artifacts) {
      byType[artifact.type] = (byType[artifact.type] || 0) + 1
      byOperator[artifact.producedBy] = (byOperator[artifact.producedBy] || 0) + 1
    }

    const timestamp = new Date().toISOString()

    const payload = {
      total_count: artifacts.length,
      by_type: byType,
      by_operator: byOperator,
      artifacts: artifacts.map((a: any) => ({
        id: a.id,
        type: a.type,
        name: a.name,
        path: a.path,
        produced_by: a.producedBy,
        timestamp: a.timestamp,
      })),
    }

    // Produce artifact inventory file
    const summary = `Indexed ${artifacts.length} artifacts across ${Object.keys(byType).length} types`

    // Add schema metadata to output
    const report = {
      schema_version: ARTIFACT_SCHEMA_VERSION,
      artifact_type: "artifact_inventory",
      workflow_id: contextPack?.workflowId,
      operator: this.type,
      created_at: timestamp,
      summary,
      payload,
    }
    const { artifact: artifactRecord } = await writeWorkflowArtifact({
      cwd: ctx.cwd,
      sessionId: ctx.sessionId,
      taskId: task.id,
      producingOperator: this.type,
      type: "artifact_inventory",
      filename: "artifact-inventory.json",
      description: `Indexed ${artifacts.length} artifacts from workflow`,
      payload: report,
      timestamp,
    })

    // Generate markdown output for stream display
    const markdownOutput = this.formatArtifactInventoryMarkdown(artifacts, byType, byOperator)

    return {
      success: true,
      output: report,
      markdownOutput,
      artifacts: [artifactRecord],
    }
  }

  private formatArtifactInventoryMarkdown(
    artifacts: any[],
    byType: Record<string, number>,
    byOperator: Record<string, number>,
  ): string {
    let md = `## Artifact Inventory\n\n`
    md += `**Total:** ${artifacts.length} artifacts\n\n`

    if (Object.keys(byType).length > 0) {
      md += `### 📦 By Type\n`
      for (const [type, count] of Object.entries(byType)) {
        md += `- **${type}:** ${count}\n`
      }
      md += `\n`
    }

    if (Object.keys(byOperator).length > 0) {
      md += `### 👤 By Operator\n`
      for (const [op, count] of Object.entries(byOperator)) {
        md += `- **${op}:** ${count}\n`
      }
      md += `\n`
    }

    md += `### 📋 Artifact List\n`
    for (const artifact of artifacts.slice(0, 10)) {
      md += `- \`${artifact.type}\` - ${artifact.path || "unknown path"}\n`
    }
    if (artifacts.length > 10) {
      md += `- ... and ${artifacts.length - 10} more\n`
    }

    return md
  }
}
