import { Log } from "@/util/log"
import { HybridTransitions } from "@/state/hybrid-transitions"
import { ApprovalTransitions } from "@/approval/approval-transitions"
import { appendEventOnly } from "@/state/events/event-transitions"
import type { WorkflowContext, WorkflowExecutionResult, WorkflowStepResult } from "./types"
import { Identifier } from "@/id/id"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import {
  ExternalWorkerId,
  WorkerContract,
  buildProviderInvocation,
} from "@/worker/worker-adapter"
import type { WorkerInvocation } from "@/worker/worker-adapter"
import type { RuntimePolicy } from "@/execution/execution-contract"
import { verifyWorkerPatch } from "@/worker/worker-verification"
import type { CheckDefinition, CheckResult } from "@/sdlc/check-types"
import { runSandboxedCommand, runSandboxedWorkerCheck } from "@/worker/worker-sandbox"

const log = Log.create({ service: "worker-run-workflow" })

/**
 * worker_run — the BYOA workflow (docs/dax/byoa-strategy.md).
 *
 * DAX governs an external coding agent as a capability worker:
 *
 *   disposable checkout -> external worker executes inside it ->
 *   DAX computes the diff (kernel-owned, never worker-reported) ->
 *   approval gate -> patch artifact for the operator to apply.
 *
 * The worker is selected via the contract's providerHint ("worker:claude" |
 * "worker:codex" | "worker:gemini"). The workflow fails closed on a missing
 * or unknown worker, a missing repoPath, a failed worker process, or an
 * empty diff — a worker that produced nothing has nothing to approve.
 *
 * Effects (checkout, process run, diff) are injectable for tests via
 * WorkerRunEffects; the defaults use git worktrees and Bun.spawn.
 */

export type WorkerCheckout = { path: string; cleanup: () => Promise<void> }

export type WorkerPatch = {
  content: string
  /** Repository-relative paths computed by Git after staging the worker's changes. */
  changedPaths: string[]
}

export type WorkerRunEffectsShape = {
  createCheckout: (repoPath: string, runId: string) => Promise<WorkerCheckout>
  runWorker: (
    invocation: WorkerInvocation,
    cwd: string,
  ) => Promise<{
    exitCode: number
    stdout: string
    stderr: string
    timedOut?: boolean
    sandboxProvider?: string
    /** True when DAX had to kill descendants the worker left behind. */
    reapedDescendants?: boolean
  }>
  /** Kernel-owned diff and changed paths (including untracked files). */
  computeDiff: (checkoutPath: string) => Promise<WorkerPatch>
  /** DAX-owned verification command runner; injectable for workflow tests. */
  runVerification: (check: CheckDefinition) => Promise<CheckResult>
}

const defaultEffects: WorkerRunEffectsShape = {
  async createCheckout(repoPath, runId) {
    const root = path.join(repoPath, ".dax", "worker-checkouts")
    const checkoutPath = path.join(root, runId)
    await mkdir(root, { recursive: true })
    const add = Bun.spawn(["git", "-C", repoPath, "worktree", "add", "--detach", checkoutPath, "HEAD"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    if ((await add.exited) !== 0) {
      throw new Error(`git worktree add failed: ${await new Response(add.stderr).text()}`)
    }
    return {
      path: checkoutPath,
      async cleanup() {
        const rm = Bun.spawn(["git", "-C", repoPath, "worktree", "remove", "--force", checkoutPath], {
          stdout: "pipe",
          stderr: "pipe",
        })
        await rm.exited
      },
    }
  },
  async runWorker(invocation, cwd) {
    return runSandboxedCommand({
      command: invocation.command,
      cwd,
      env: { ...invocation.env, PATH: process.env.PATH ?? "" },
      timeoutMs: invocation.timeoutMs,
      network: invocation.network === "none" ? "none" : "full",
    })
  },
  async computeDiff(checkoutPath) {
    // Stage everything (disposable checkout) so untracked files appear in
    // one kernel-computed diff, then read the staged diff against HEAD.
    const add = Bun.spawn(["git", "-C", checkoutPath, "add", "-A"], { stdout: "pipe", stderr: "pipe" })
    if ((await add.exited) !== 0) {
      throw new Error(`git add failed: ${await new Response(add.stderr).text()}`)
    }
    const diff = Bun.spawn(["git", "-C", checkoutPath, "diff", "--cached"], { stdout: "pipe", stderr: "pipe" })
    const paths = Bun.spawn(["git", "-C", checkoutPath, "diff", "--cached", "--name-only", "-z"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [diffExit, pathsExit] = await Promise.all([diff.exited, paths.exited])
    if (diffExit !== 0) {
      throw new Error(`git diff failed: ${await new Response(diff.stderr).text()}`)
    }
    if (pathsExit !== 0) {
      throw new Error(`git diff --name-only failed: ${await new Response(paths.stderr).text()}`)
    }
    const [content, changedPaths] = await Promise.all([
      new Response(diff.stdout).text(),
      new Response(paths.stdout)
        .text()
        .then((output) => output.split("\0").filter(Boolean)),
    ])
    return { content, changedPaths }
  },
  runVerification: runSandboxedWorkerCheck,
}

/** Test seam: swap effects, always restore. */
export const WorkerRunEffects = {
  current: defaultEffects,
  set(effects: Partial<WorkerRunEffectsShape>) {
    WorkerRunEffects.current = { ...defaultEffects, ...effects }
  },
  reset() {
    WorkerRunEffects.current = defaultEffects
  },
}

/**
 * Build a WorkerContract from the compiled ExecutionContract's runtimePolicy.
 * writeScope/forbiddenPaths/verification are empty when runtimePolicy is absent —
 * the kernel diff and approval gate remain the authority regardless.
 */
export function workerContractFromPolicy(
  intent: string,
  runId: string,
  runtimePolicy?: RuntimePolicy,
): WorkerContract {
  return WorkerContract.parse({
    task: intent,
    writeScope: runtimePolicy?.scope.targetFiles ?? [],
    forbiddenPaths: runtimePolicy?.sensitivity.forbiddenPatterns ?? [],
    verification: runtimePolicy?.postconditions.validationCommands ?? [],
    runId,
  })
}

export function workerIdFromProviderHint(providerHint: string | undefined): ExternalWorkerId | null {
  if (!providerHint?.startsWith("worker:")) return null
  const parsed = ExternalWorkerId.safeParse(providerHint.slice("worker:".length))
  return parsed.success ? parsed.data : null
}

export type WorkerScopeViolation = {
  path: string
  kind: "forbidden" | "outside_write_scope"
  patterns: string[]
}

function normalizeRepoPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "")
}

function pathMatchesPattern(path: string, pattern: string): boolean {
  const normalizedPath = normalizeRepoPath(path)
  const normalizedPattern = normalizeRepoPath(pattern)
  return (
    normalizedPath === normalizedPattern ||
    normalizedPath.startsWith(`${normalizedPattern.replace(/\/$/, "")}/`) ||
    new Bun.Glob(normalizedPattern).match(normalizedPath)
  )
}

/**
 * Enforce the operator-visible contract against DAX's own Git-derived paths.
 * Empty write scope is intentionally unrestricted; forbidden paths always win.
 */
export function validateWorkerPatchScope(paths: string[], contract: WorkerContract): WorkerScopeViolation[] {
  const violations: WorkerScopeViolation[] = []
  for (const path of paths) {
    const forbidden = contract.forbiddenPaths.filter((pattern) => pathMatchesPattern(path, pattern))
    if (forbidden.length > 0) {
      violations.push({ path, kind: "forbidden", patterns: forbidden })
      continue
    }

    if (
      contract.writeScope.length > 0 &&
      !contract.writeScope.some((pattern) => pathMatchesPattern(path, pattern))
    ) {
      violations.push({ path, kind: "outside_write_scope", patterns: contract.writeScope })
    }
  }
  return violations
}

function formatScopeViolations(violations: WorkerScopeViolation[]): string {
  return violations
    .map((violation) =>
      violation.kind === "forbidden"
        ? `forbidden path ${violation.path} (matched ${violation.patterns.join(", ")})`
        : `out-of-scope path ${violation.path} (allowed: ${violation.patterns.join(", ")})`,
    )
    .join("; ")
}

export class WorkerRunWorkflow {
  private runId: string
  private contract: WorkflowContext["contract"]

  constructor(context: WorkflowContext) {
    this.runId = context.runId
    this.contract = context.contract
  }

  async execute(): Promise<WorkflowExecutionResult> {
    const stepResults: WorkflowStepResult[] = []

    const workerId = workerIdFromProviderHint(this.contract.providerHint)
    if (!workerId) {
      const error = `worker_run requires providerHint "worker:<claude|codex|gemini>", got "${this.contract.providerHint ?? "none"}"`
      await this.failRun("invalid_worker", error)
      return { success: false, stepResults, error }
    }
    if (!this.contract.repoPath) {
      const error = "worker_run requires contract.repoPath"
      await this.failRun("missing_repo_path", error)
      return { success: false, stepResults, error }
    }

    const workerResult = await this.executeRunWorker(workerId, this.contract.repoPath)
    stepResults.push(workerResult)
    if (!workerResult.success) {
      return { success: false, stepResults, error: workerResult.error ?? "run_worker failed" }
    }

    const approvalResult = await this.executeRequestApproval(workerId)
    stepResults.push(approvalResult)
    if (!approvalResult.success) {
      return { success: false, stepResults, error: approvalResult.error ?? "request_approval failed" }
    }

    // Halt at the gate; resumeAfterApproval finishes the run.
    return { success: true, stepResults }
  }

  private diffContent: string | null = null

  private async executeRunWorker(workerId: ExternalWorkerId, repoPath: string): Promise<WorkflowStepResult> {
    const stepId = `step_${Identifier.create("part", false)}`
    await HybridTransitions.addStep(this.runId, stepId, `Run governed worker (${workerId})`, "executed")
    await HybridTransitions.startStep(this.runId, stepId)

    let checkout: WorkerCheckout | null = null
    try {
      const contract = workerContractFromPolicy(
        this.contract.intent,
        this.runId,
        this.contract.runtimePolicy,
      )

      // Scope provenance is part of the receipt. Event ordering is mandatory:
      // an unrecorded contract must never race later evidence or review state.
      await appendEventOnly(this.runId, "contract_refined", {
        writeScope: contract.writeScope,
        forbiddenPaths: contract.forbiddenPaths,
        verification: contract.verification,
        provenance: this.contract.runtimePolicy?.provenance ?? {
          writeScope: "inferred-unreviewed",
          forbiddenPaths: "inferred-unreviewed",
          verification: "inferred-unreviewed",
        },
      })

      // Routed through the registry rather than the legacy external-CLI
      // helper, so the run path resolves an approved provider adapter and the
      // identity it reports is the one recorded as evidence below.
      const invocation = buildProviderInvocation({
        providerId: workerId,
        contract,
        hostEnv: process.env,
        timeoutMs: this.contract.timeoutMs,
      })

      checkout = await WorkerRunEffects.current.createCheckout(repoPath, this.runId)
      const result = await WorkerRunEffects.current.runWorker(invocation, checkout.path)
      // Recorded before the failure throws below. Isolation and process
      // ownership held regardless of how the worker exited, and a timeout is
      // precisely when the operator needs to see that nothing was left behind.
      if (result.sandboxProvider) {
        await appendEventOnly(this.runId, "worker_sandbox_recorded", {
          provider: result.sandboxProvider,
          providerId: invocation.providerId,
          filesystem: "checkout-write-only",
          network: invocation.network,
          reapedDescendants: result.reapedDescendants ?? false,
        })
      }
      if (result.timedOut) {
        throw new Error(`worker ${workerId} timed out after ${invocation.timeoutMs}ms`)
      }
      if (result.exitCode !== 0) {
        throw new Error(`worker ${workerId} exited ${result.exitCode}: ${result.stderr.slice(0, 2000)}`)
      }

      // Kernel-owned diff: the worker's own account of its changes is never
      // consulted.
      const patch = await WorkerRunEffects.current.computeDiff(checkout.path)
      if (!patch.content.trim()) {
        throw new Error(`worker ${workerId} produced no changes — nothing to review`)
      }
      const scopeViolations = validateWorkerPatchScope(patch.changedPaths, contract)
      if (scopeViolations.length > 0) {
        throw new Error(`worker ${workerId} violated its governed scope: ${formatScopeViolations(scopeViolations)}`)
      }
      this.diffContent = patch.content

      await HybridTransitions.completeStep(this.runId, stepId, [
        `worker:${workerId}`,
        `diff:${patch.changedPaths.length}`,
        ...(result.sandboxProvider ? [`sandbox:${result.sandboxProvider}`] : []),
      ])

      const verification = await this.executeVerifyWorkerPatch(checkout.path, contract)
      if (!verification.success) {
        return verification
      }

      const draftId = `draft_${Identifier.create("session", false)}`
      await HybridTransitions.createDraft(this.runId, draftId, "patch", patch.content, undefined)

      log.info("run_worker completed", { runId: this.runId, workerId, diffBytes: patch.content.length })
      return {
        stepId,
        success: true,
        outputs: [
          {
            type: "summary",
            content: `External worker ${workerId} produced a kernel-computed patch (${patch.content.length} bytes).`,
          },
        ],
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("run_worker failed", { runId: this.runId, workerId, error: message })
      await HybridTransitions.failStep(this.runId, stepId, { code: "worker_failed", message })
      await this.failRun("execution_error", message)
      return { stepId, success: false, outputs: [], error: message }
    } finally {
      await checkout?.cleanup().catch(() => {})
    }
  }

  private async executeVerifyWorkerPatch(checkoutPath: string, contract: WorkerContract): Promise<WorkflowStepResult> {
    const stepId = `step_${Identifier.create("part", false)}`
    try {
      await HybridTransitions.addStep(this.runId, stepId, "Verify worker patch", "executed")
      await HybridTransitions.startStep(this.runId, stepId)

      const verification = await verifyWorkerPatch({
        runId: this.runId,
        cwd: checkoutPath,
        commands: contract.verification,
        run: WorkerRunEffects.current.runVerification,
      })
      const artifactId = `verification_${Identifier.create("session", false)}`

      // The event log retains the exact DAX-run check results and receipt digests.
      // It is required evidence: a run must not reach human review without it.
      await appendEventOnly(this.runId, "verification_recorded", {
        status: verification.passed ? "passed" : "failed",
        receipts: verification.receipts,
        checks: verification.checks,
      })
      await appendEventOnly(this.runId, "artifact_created", {
        artifactId,
        artifactType: "verification_report",
      })

      const receiptIds = verification.receipts.map((receipt) => receipt.receiptId)
      if (!verification.passed) {
        const message = verification.failureSummary ?? "DAX verification failed"
        await HybridTransitions.failStep(this.runId, stepId, { code: "verification_failed", message })
        await this.failRun("verification_failed", message)
        return { stepId, success: false, outputs: [], error: message }
      }

      await HybridTransitions.completeStep(this.runId, stepId, [artifactId, ...receiptIds])
      return {
        stepId,
        success: true,
        outputs: [
          {
            type: "report",
            artifactId,
            content: `DAX verification passed: ${verification.checks.map((check) => check.command).join(", ")}.`,
          },
        ],
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await HybridTransitions.failStep(this.runId, stepId, { code: "verification_error", message })
      await this.failRun("verification_error", message)
      return { stepId, success: false, outputs: [], error: message }
    }
  }

  private async failRun(code: string, message: string): Promise<void> {
    await HybridTransitions.transition(this.runId, "failed", "run_failed", {
      error: { code, message, retryable: false },
    })
  }

  private async executeRequestApproval(workerId: ExternalWorkerId): Promise<WorkflowStepResult> {
    const stepId = `step_${Identifier.create("part", false)}`
    try {
      await HybridTransitions.addStep(this.runId, stepId, "Request Approval", "approved")
      await HybridTransitions.startStep(this.runId, stepId)

      const approval = await ApprovalTransitions.create({
        runId: this.runId,
        stepId,
        type: "patch_apply",
        risk: this.contract.riskLevel ?? "medium",
        title: `Approve governed ${workerId} changes`,
        reason: `External worker ${workerId} produced a kernel-computed diff that requires human approval.`,
        context: { stepId },
        expectedConsequence: "The reviewed patch becomes an approved artifact for the operator to apply.",
        source: "workflow",
      })

      await HybridTransitions.addApproval(this.runId, approval.approvalId)
      await HybridTransitions.transition(this.runId, "waiting_approval", "approval_required")
      await HybridTransitions.completeStep(this.runId, stepId, [approval.approvalId])

      return { stepId, success: true, outputs: [] }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("request_approval failed", { runId: this.runId, error: message })
      return { stepId, success: false, outputs: [], error: message }
    }
  }

  async resumeAfterApproval(approvalId: string, decision: "approved" | "denied"): Promise<WorkflowExecutionResult> {
    if (decision === "denied") {
      await HybridTransitions.resolveApproval(this.runId, approvalId, "rejected")
      await HybridTransitions.transition(this.runId, "failed", "approval_denied")
      return { success: false, stepResults: [], error: "Approval was denied" }
    }

    await HybridTransitions.resolveApproval(this.runId, approvalId, "approved")

    const stepId = `step_${Identifier.create("part", false)}`
    await HybridTransitions.addStep(this.runId, stepId, "Finalize Outcome", "executed")
    await HybridTransitions.startStep(this.runId, stepId)
    await HybridTransitions.completeStep(this.runId, stepId, ["approved:patch"])
    await HybridTransitions.transition(this.runId, "completed", "workflow_completed")

    log.info("worker_run completed after approval", { runId: this.runId, approvalId })
    return { success: true, stepResults: [{ stepId, success: true, outputs: [] }] }
  }
}
