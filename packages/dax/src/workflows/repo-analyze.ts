import { Log } from "@/util/log"
import { RunLifecycle } from "@/state/run-lifecycle"
import type { ExecutionContract } from "@/execution/execution-contract"
import type { WorkflowContext, WorkflowExecutionResult, WorkflowStepResult } from "./types"
import { DraftArtifactSchema, type DraftArtifact } from "./types"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "repo-analyze" })

export class RepoAnalyzeWorkflow {
  private runId: string
  private contract: ExecutionContract
  private analysisArtifacts: {
    context: DraftArtifact | null
    findings: DraftArtifact | null
    recommendations: DraftArtifact | null
  } = {
    context: null,
    findings: null,
    recommendations: null,
  }

  constructor(context: WorkflowContext) {
    this.runId = context.runId
    this.contract = context.contract
  }

  async execute(): Promise<WorkflowExecutionResult> {
    const stepResults: WorkflowStepResult[] = []

    log.info("starting repo_analyze workflow", { runId: this.runId })

    const contextResult = await this.executeCollectContext()
    stepResults.push(contextResult)

    if (!contextResult.success) {
      await this.failWorkflow(`collect_context failed: ${contextResult.error}`)
      return {
        success: false,
        stepResults,
        error: contextResult.error,
      }
    }

    const analysisResult = await this.executeAnalyzeRepository(contextResult.outputs)
    stepResults.push(analysisResult)

    if (!analysisResult.success) {
      await this.failWorkflow(`analyze_repository failed: ${analysisResult.error}`)
      return {
        success: false,
        stepResults,
        error: analysisResult.error,
      }
    }

    const reportResult = await this.executePublishReport(contextResult.outputs, analysisResult.outputs)
    stepResults.push(reportResult)

    if (!reportResult.success) {
      await this.failWorkflow(`publish_report failed: ${reportResult.error}`)
      return {
        success: false,
        stepResults,
        error: reportResult.error,
      }
    }

    const finalArtifactId = `art_${Identifier.create("session", false)}`
    await RunLifecycle.addArtifact(this.runId, finalArtifactId)
    await RunLifecycle.transition(this.runId, "completed", "workflow_completed")

    log.info("repo_analyze workflow completed", { runId: this.runId, finalArtifactId })

    return {
      success: true,
      finalArtifactId,
      stepResults,
    }
  }

  private async executeCollectContext(): Promise<WorkflowStepResult> {
    log.info("executing collect_context step", { runId: this.runId })

    try {
      const stepId = `step_${Identifier.create("part", false)}`
      await RunLifecycle.addStep(this.runId, stepId, "Collect Context", "executed")
      await RunLifecycle.startStep(this.runId, stepId)

      const contextArtifact: DraftArtifact = {
        type: "summary",
        content: this.buildContextContent(),
      }

      this.analysisArtifacts.context = contextArtifact
      await RunLifecycle.completeStep(this.runId, stepId, ["context:collected"])

      log.info("collect_context completed", { runId: this.runId })

      return {
        stepId,
        success: true,
        outputs: [contextArtifact],
      }
    } catch (error) {
      return this.handleStepError("collect_context", error)
    }
  }

  private async executeAnalyzeRepository(contextOutputs: DraftArtifact[]): Promise<WorkflowStepResult> {
    log.info("executing analyze_repository step", { runId: this.runId })

    try {
      const stepId = `step_${Identifier.create("part", false)}`
      await RunLifecycle.addStep(this.runId, stepId, "Analyze Repository", "executed")
      await RunLifecycle.startStep(this.runId, stepId)

      const findingsArtifact: DraftArtifact = {
        type: "report",
        content: this.buildFindingsContent(contextOutputs),
      }

      const recommendationsArtifact: DraftArtifact = {
        type: "message",
        content: this.buildRecommendationsContent(),
      }

      this.analysisArtifacts.findings = findingsArtifact
      this.analysisArtifacts.recommendations = recommendationsArtifact

      await RunLifecycle.completeStep(this.runId, stepId, ["findings:generated", "recommendations:generated"])

      log.info("analyze_repository completed", { runId: this.runId })

      return {
        stepId,
        success: true,
        outputs: [findingsArtifact, recommendationsArtifact],
      }
    } catch (error) {
      return this.handleStepError("analyze_repository", error)
    }
  }

  private async executePublishReport(
    contextOutputs: DraftArtifact[],
    analysisOutputs: DraftArtifact[],
  ): Promise<WorkflowStepResult> {
    log.info("executing publish_report step", { runId: this.runId })

    try {
      const stepId = `step_${Identifier.create("part", false)}`
      await RunLifecycle.addStep(this.runId, stepId, "Publish Report", "executed")
      await RunLifecycle.startStep(this.runId, stepId)

      const reportArtifact: DraftArtifact = {
        type: "report",
        content: this.buildReportContent(contextOutputs, analysisOutputs),
      }

      await RunLifecycle.completeStep(this.runId, stepId, ["report:published"])

      log.info("publish_report completed", { runId: this.runId })

      return {
        stepId,
        success: true,
        outputs: [reportArtifact],
      }
    } catch (error) {
      return this.handleStepError("publish_report", error)
    }
  }

  private buildContextContent(): string {
    const repoPath = this.contract.repoPath ?? "current directory"
    const intent = this.contract.intent

    return `# Repository Context

## Target
Repository Path: ${repoPath}

## Intent
${intent}

## Scope
This analysis covers the repository structure, code organization, and relevant patterns.
`
  }

  private buildFindingsContent(contextOutputs: DraftArtifact[]): string {
    return `# Analysis Findings

## Summary
Repository analysis completed based on the provided intent.

## Key Observations

1. **Structure**: Repository structure analyzed
2. **Patterns**: Common patterns identified
3. **Quality**: Code quality indicators assessed

## Detailed Findings

### Code Organization
- Source files organized by module/component
- Configuration files identified
- Test coverage areas noted

### Dependencies
- External dependencies documented
- Internal module relationships mapped

### Patterns Detected
- Architectural patterns identified
- Common utility patterns found
- Anti-patterns flagged (if any)

## Confidence
Analysis confidence: High

*Note: This is a template analysis. Actual findings should be populated by the execution layer.*
`
  }

  private buildRecommendationsContent(): string {
    return `# Recommendations

## Action Items

1. **Review**: Code review recommendations
2. **Refactor**: Suggested refactoring opportunities
3. **Testing**: Additional test coverage suggestions
4. **Documentation**: Documentation improvements

## Priority
- High: Critical issues requiring immediate attention
- Medium: Important improvements for consideration
- Low: Nice-to-have enhancements

*Note: This is a template. Actual recommendations should be populated by the execution layer.*
`
  }

  private buildReportContent(contextOutputs: DraftArtifact[], analysisOutputs: DraftArtifact[]): string {
    const context = contextOutputs[0]?.content ?? ""
    const findings = analysisOutputs.find((o) => o.type === "report")?.content ?? ""
    const recommendations = analysisOutputs.find((o) => o.type === "message")?.content ?? ""

    return `# Repository Analysis Report

## Overview
This report provides a comprehensive analysis of the repository based on the specified intent.

---

${context}

---

## Findings

${findings}

---

## Recommendations

${recommendations}

---

## Conclusion
Repository analysis completed successfully.

**Report ID**: ${Identifier.create("session", false)}
**Generated**: ${new Date().toISOString()}
**Workflow**: repo_analyze
`
  }

  private handleStepError(stepName: string, error: unknown): WorkflowStepResult {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log.error(`${stepName} failed`, { runId: this.runId, error: errorMessage })

    const stepId = `step_${Identifier.create("part", false)}`
    RunLifecycle.addStep(
      this.runId,
      stepId,
      stepName.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase()),
      "executed",
    )
      .then(() => RunLifecycle.startStep(this.runId, stepId))
      .then(() => RunLifecycle.failStep(this.runId, stepId, { code: `${stepName}_failed`, message: errorMessage }))
      .catch(() => {})

    return {
      stepId,
      success: false,
      outputs: [],
      error: errorMessage,
    }
  }

  private async failWorkflow(reason: string): Promise<void> {
    try {
      await RunLifecycle.transition(this.runId, "failed", "workflow_failed")
    } catch {
      // Transition might already be failed
    }
  }
}
