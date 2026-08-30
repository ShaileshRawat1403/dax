import { afterAll, describe, expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { Instance } from "@/project/instance"
import {
  CONFORMANCE_POINTS,
  observeNativeKernel,
  observeWorkerKernel,
  type ConformancePoint,
  type KernelObservation,
} from "./execution-kernel-observations"

/**
 * Invariant 3 — Universal Execution Boundary.
 *
 * DAX has two execution kernels: governed native tool execution and governed
 * external-worker execution. Workflow presets, step projections and signoff
 * are interactions over or around those kernels, not additional authority
 * boundaries, and therefore never enter this denominator.
 *
 * Both rows below enter through production dispatch. Native is born and driven
 * by SessionPrompt and its real tool resolver/settlement/completion path. Worker
 * is selected by RunGateway.createRun/RunFactory; only the existing worker
 * side-effect seam is replaced, while real checkout, Git diff, workflow,
 * approval, event and Gateway code remains in the path.
 */

const testHome = mkdtempSync(path.join(os.tmpdir(), "dax-two-kernel-conformance-"))
const previousTestHome = process.env.DAX_TEST_HOME
const previousGuardApprovalTimeout = process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS
const previousShadowAudit = process.env.DAX_DISABLE_SHADOW_AUDIT
process.env.DAX_TEST_HOME = testHome
process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS = "10000"
process.env.DAX_DISABLE_SHADOW_AUDIT = "1"

let observations: Promise<KernelObservation[]> | undefined

function observeKernels(): Promise<KernelObservation[]> {
  observations ??= (async () => [await observeNativeKernel(testHome), await observeWorkerKernel(testHome)])()
  return observations
}

function pointMap(observation: KernelObservation): Record<ConformancePoint, boolean> {
  return Object.fromEntries(
    CONFORMANCE_POINTS.map((point) => [point, observation.points[point].satisfied]),
  ) as Record<ConformancePoint, boolean>
}

function score(observation: KernelObservation): number {
  return CONFORMANCE_POINTS.filter((point) => observation.points[point].satisfied).length
}

afterAll(async () => {
  await Instance.disposeAll()
  if (previousTestHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousTestHome
  if (previousGuardApprovalTimeout === undefined) delete process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS
  else process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS = previousGuardApprovalTimeout
  if (previousShadowAudit === undefined) delete process.env.DAX_DISABLE_SHADOW_AUDIT
  else process.env.DAX_DISABLE_SHADOW_AUDIT = previousShadowAudit
  rmSync(testHome, { recursive: true, force: true })
})

describe("invariant 3 — two-kernel universal execution boundary", () => {
  test("native evidence comes from SessionPrompt production dispatch", async () => {
    const [native] = await observeKernels()
    expect(native.kernel).toBe("native")
    expect(native.semantics).toEqual({ positive: true, failure: true, incomplete: true })
    expect(pointMap(native)).toEqual({
      contract_bound: true,
      input_validated: true,
      policy_emitted: true,
      approval_emitted: true,
      execution_emitted: true,
      output_validated: true,
      verification_emitted: true,
      completion_projected: true,
    })
  }, 30_000)

  test("worker evidence comes from Gateway and RunFactory production dispatch", async () => {
    const [, worker] = await observeKernels()
    expect(worker.kernel).toBe("worker")
    expect(worker.semantics).toEqual({ positive: true, failure: true, incomplete: true })
    expect(pointMap(worker)).toEqual({
      contract_bound: true,
      input_validated: true,
      policy_emitted: true,
      approval_emitted: true,
      execution_emitted: true,
      output_validated: true,
      verification_emitted: true,
      completion_projected: true,
    })
  }, 30_000)

  test("execution credit cannot come from workflow steps or worker containment", async () => {
    const [native, worker] = await observeKernels()
    expect(native.points.execution_emitted.references).toContain("tool_result_recorded")
    expect(worker.points.execution_emitted.references).toContain("mutation_recorded")
    expect(worker.points.execution_emitted.references).not.toContain("worker_sandbox_recorded")
    expect(worker.points.execution_emitted.references).not.toContain("step_completed")
  })

  test("the denominator contains exactly two kernels and excludes presets and signoff", async () => {
    const rows = await observeKernels()
    expect(rows.map((row) => row.kernel)).toEqual(["native", "worker"])
    expect(rows).toHaveLength(2)
    expect(rows.length * CONFORMANCE_POINTS.length).toBe(16)
    expect(rows.map((row) => row.kernel)).not.toContain("draft_and_approve")
    expect(rows.map((row) => row.kernel)).not.toContain("repo_analyze")
    expect(rows.map((row) => row.kernel)).not.toContain("review_and_signoff")
  })

  test("meter reports the current observed matrix out of sixteen", async () => {
    const rows = await observeKernels()
    const scores = Object.fromEntries(rows.map((row) => [row.kernel, score(row)]))
    const earned = rows.reduce((total, row) => total + score(row), 0)

    expect(scores).toEqual({ native: 8, worker: 8 })
    expect({ earned, total: rows.length * CONFORMANCE_POINTS.length }).toEqual({ earned: 16, total: 16 })
  })

  test("all retained kernels must prove all eight points", async () => {
    const rows = await observeKernels()
    const missing = rows.flatMap((row) =>
      CONFORMANCE_POINTS.filter((point) => !row.points[point].satisfied).map(
        (point) => `${row.kernel}: ${point}`,
      ),
    )

    expect(missing).toEqual([])
  })

  test("both execution kernels prove the same governance coverage", async () => {
    const counts = (await observeKernels()).map(score)
    const spread = Math.max(...counts) - Math.min(...counts)
    expect(spread).toBe(0)
  })

  test("there is exactly one lifecycle implementation", () => {
    expect(existsSync(path.join(import.meta.dir, "../state/hybrid-transitions.ts"))).toBe(false)
  })
})
