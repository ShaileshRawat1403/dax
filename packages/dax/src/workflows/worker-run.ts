import { Log } from "@/util/log"
import { HybridTransitions } from "@/state/hybrid-transitions"
import { ApprovalTransitions } from "@/approval/approval-transitions"
import type { WorkflowContext, WorkflowExecutionResult, WorkflowStepResult } from "./types"
import { Identifier } from "@/id/id"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import {
  ExternalWorkerId,
  WorkerContract,
  buildWorkerInvocation,
} from "@/worker/worker-adapter"
import type { WorkerInvocation } from "@/worker/worker-adapter"

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

export type WorkerRunEffectsShape = {
  createCheckout: (repoPath: string, runId: string) => Promise<WorkerCheckout>
  runWorker: (
    invocation: WorkerInvocation,
    cwd: string,
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  /** Kernel-owned diff of everything the worker changed (incl. untracked). */
  computeDiff: (checkoutPath: string) => Promise<string>
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
    const proc = Bun.spawn(invocation.command, {
      cwd,
      // Allowlist-only env from the adapter; the operator's shell env never
      // reaches the worker. PATH/HOME come through minimally for binaries.
      env: { ...invocation.env, PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      stdout: "pipe",
      stderr: "pipe",
    })
    const timeout = setTimeout(() => proc.kill(), invocation.timeoutMs)
    const exitCode = await proc.exited
    clearTimeout(timeout)
    return {
      exitCode,
      stdout: await new Response(proc.stdout).text(),
      stderr: await new Response(proc.stderr).text(),
    }
  },
  async computeDiff(checkoutPath) {
    // Stage everything (disposable checkout) so untracked files appear in
    // one kernel-computed diff, then read the staged diff against HEAD.
    const add = Bun.spawn(["git", "-C", checkoutPath, "add", "-A"], { stdout: "pipe", stderr: "pipe" })
    if ((await add.exited) !== 0) {
      throw new Error(`git add failed: ${await new Response(add.stderr).text()}`)
    }
    const diff = Bun.spawn(["git", "-C", checkoutPath, "diff", "--cached"], { stdout: "pipe", stderr: "pipe" })
    if ((await diff.exited) !== 0) {
      throw new Error(`git diff failed: ${await new Response(diff.stderr).text()}`)
    }
    return await new Response(diff.stdout).text()
  },
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

export function workerIdFromProviderHint(providerHint: string | undefined): ExternalWorkerId | null {
  if (!providerHint?.startsWith("worker:")) return null
  const parsed = ExternalWorkerId.safeParse(providerHint.slice("worker:".length))
  return parsed.success ? parsed.data : null
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
      await HybridTransitions.transition(this.runId, "failed", "invalid_worker")
      return { success: false, stepResults, error }
    }
    if (!this.contract.repoPath) {
      await HybridTransitions.transition(this.runId, "failed", "missing_repo_path")
      return { success: false, stepResults, error: "worker_run requires contract.repoPath" }
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
      const contract: WorkerContract = WorkerContract.parse({
        task: this.contract.intent,
        writeScope: [],
        forbiddenPaths: [],
        verification: [],
        runId: this.runId,
      })
      const invocation = buildWorkerInvocation({
        workerId,
        contract,
        hostEnv: process.env,
        timeoutMs: this.contract.timeoutMs,
      })

      checkout = await WorkerRunEffects.current.createCheckout(repoPath, this.runId)
      const result = await WorkerRunEffects.current.runWorker(invocation, checkout.path)
      if (result.exitCode !== 0) {
        throw new Error(`worker ${workerId} exited ${result.exitCode}: ${result.stderr.slice(0, 2000)}`)
      }

      // Kernel-owned diff: the worker's own account of its changes is never
      // consulted.
      const diff = await WorkerRunEffects.current.computeDiff(checkout.path)
      if (!diff.trim()) {
        throw new Error(`worker ${workerId} produced no changes — nothing to review`)
      }
      this.diffContent = diff

      const draftId = `draft_${Identifier.create("session", false)}`
      await HybridTransitions.createDraft(this.runId, draftId, "patch", diff, undefined)
      await HybridTransitions.completeStep(this.runId, stepId, [`draft:patch`, `worker:${workerId}`])

      log.info("run_worker completed", { runId: this.runId, workerId, diffBytes: diff.length })
      return {
        stepId,
        success: true,
        outputs: [
          {
            type: "summary",
            content: `External worker ${workerId} produced a kernel-computed patch (${diff.length} bytes).`,
          },
        ],
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("run_worker failed", { runId: this.runId, workerId, error: message })
      await HybridTransitions.failStep(this.runId, stepId, { code: "worker_failed", message })
      await HybridTransitions.transition(this.runId, "failed", "execution_error")
      return { stepId, success: false, outputs: [], error: message }
    } finally {
      await checkout?.cleanup().catch(() => {})
    }
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
