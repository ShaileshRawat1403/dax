import type { Operator, OperatorContext, OperatorResult } from "./base"
import type { PlannedTask } from "../planner/task-graph"
import {
  runBoundaryPass,
  runEntryPointPass,
  runIntegrationPass,
  runExecutionFlowPass,
  mergeExplorePassOutputs,
  createEmptyExplorePassOutputs,
  buildExploreResult,
  type RepoExplorePassOutputs,
} from "../explore/repo-explore"
import type { ArtifactRecord } from "../governance/artifact"

export class ExploreOperator implements Operator {
  type = "explore"

  async execute(task: PlannedTask, ctx: OperatorContext): Promise<OperatorResult> {
    try {
      switch (task.id) {
        case "explore-repo":
          return await this.exploreFullRepo(ctx)

        case "task_detect_boundaries":
          return await this.exploreBoundaries(ctx)

        case "task_detect_entrypoints":
          return await this.detectEntrypoints(ctx)

        case "task_map_architecture":
        case "task_trace_execution_flow":
          return await this.traceExecution(ctx)

        case "task_detect_integrations":
          return await this.detectIntegrations(ctx)

        case "task_generate_report":
          return await this.generateReport(task, ctx)

        default:
          return {
            success: false,
            output: null,
            error: new Error(`ExploreOperator does not support task ID: ${task.id}`),
          }
      }
    } catch (err) {
      return {
        success: false,
        output: null,
        error: err instanceof Error ? err : new Error(String(err)),
      }
    }
  }

  private async exploreBoundaries(ctx: OperatorContext): Promise<OperatorResult> {
    const delta = await runBoundaryPass(ctx.cwd)
    return {
      success: true,
      output: delta,
    }
  }

  private async exploreFullRepo(ctx: OperatorContext): Promise<OperatorResult> {
    const boundaries = await runBoundaryPass(ctx.cwd)
    const entrypoints = await runEntryPointPass(ctx.cwd)
    const integrations = await runIntegrationPass(ctx.cwd)
    const executionFlow = await runExecutionFlowPass(ctx.cwd)

    const merged = mergeExplorePassOutputs(
      mergeExplorePassOutputs(
        mergeExplorePassOutputs(mergeExplorePassOutputs(createEmptyExplorePassOutputs(), boundaries), entrypoints),
        integrations,
      ),
      executionFlow,
    )

    const result = buildExploreResult(merged)

    // Generate markdown summary for stream display
    const markdownOutput = this.formatExploreAsMarkdown(result)

    const reportArtifact: ArtifactRecord = {
      id: `art-${Math.random().toString(36).substr(2, 9)}`,
      sessionId: ctx.sessionId,
      taskId: "explore-repo",
      producingOperator: this.type,
      type: "explore_report",
      description: "Repository exploration report",
      path: "explore_report.json",
      timestamp: new Date().toISOString(),
    }

    return {
      success: true,
      output: result,
      markdownOutput,
      artifacts: [reportArtifact],
    }
  }

  private formatExploreAsMarkdown(result: any): string {
    let md = `## Repository Exploration\n\n`

    if (result.sections) {
      for (const section of result.sections) {
        if (section.findings && section.findings.length > 0) {
          md += `### ${section.title}\n`
          for (const finding of section.findings.slice(0, 5)) {
            md += `- ${finding}\n`
          }
          if (section.findings.length > 5) {
            md += `- ... and ${section.findings.length - 5} more\n`
          }
          md += `\n`
        }
        if (section.files && section.files.length > 0) {
          md += `### ${section.title}\n`
          for (const file of section.files.slice(0, 8)) {
            md += `- \`${file.path}\`\n`
          }
          if (section.files.length > 8) {
            md += `- ... and ${section.files.length - 8} more files\n`
          }
          md += `\n`
        }
      }
    }

    md += `**Artifact:** \`explore_report.json\`\n`

    return md
  }

  private async detectEntrypoints(ctx: OperatorContext): Promise<OperatorResult> {
    const delta = await runEntryPointPass(ctx.cwd)
    return {
      success: true,
      output: delta,
    }
  }

  private async traceExecution(ctx: OperatorContext): Promise<OperatorResult> {
    const delta = await runExecutionFlowPass(ctx.cwd)
    return {
      success: true,
      output: delta,
    }
  }

  private async detectIntegrations(ctx: OperatorContext): Promise<OperatorResult> {
    const delta = await runIntegrationPass(ctx.cwd)
    return {
      success: true,
      output: delta,
    }
  }

  private async generateReport(task: PlannedTask, ctx: OperatorContext): Promise<OperatorResult> {
    if (!ctx.graph) {
      return {
        success: false,
        output: null,
        error: new Error("Cannot generate report: OperatorContext is missing TaskGraph"),
      }
    }

    // Collect the accumulated outputs from previous task results
    const boundaries = ctx.graph.tasks.get("task_detect_boundaries")?.result as
      | Partial<RepoExplorePassOutputs>
      | undefined
    const entrypoints = ctx.graph.tasks.get("task_detect_entrypoints")?.result as
      | Partial<RepoExplorePassOutputs>
      | undefined
    const executionFlow = ctx.graph.tasks.get("task_trace_execution_flow")?.result as
      | Partial<RepoExplorePassOutputs>
      | undefined
    const integrations = ctx.graph.tasks.get("task_detect_integrations")?.result as
      | Partial<RepoExplorePassOutputs>
      | undefined

    const merged = mergeExplorePassOutputs(
      mergeExplorePassOutputs(
        mergeExplorePassOutputs(
          mergeExplorePassOutputs(createEmptyExplorePassOutputs(), boundaries ?? {}),
          entrypoints ?? {},
        ),
        integrations ?? {},
      ),
      executionFlow ?? {},
    )

    const result = buildExploreResult(merged)

    const reportArtifact: ArtifactRecord = {
      id: `art-${Math.random().toString(36).substr(2, 9)}`,
      sessionId: ctx.sessionId,
      taskId: task.id,
      producingOperator: this.type,
      type: "explore_report",
      description: "A JSON report generated by the ExploreOperator.",
      path: "explore_report.json", // In a real implementation, this would be a path to a saved file
      timestamp: new Date().toISOString(),
    }

    return {
      success: true,
      output: result,
      artifacts: [reportArtifact],
    }
  }
}
