import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { rmSync } from "fs"
import { formatStrandedRunTable, toStrandedRunRow } from "./recover"
import type { RunState } from "@/state/run-state"

function fakeRunState(overrides: Partial<RunState> = {}): RunState {
  return {
    runId: "run_test_1",
    contractId: "ctr_test_1",
    status: "running",
    currentStepId: null,
    steps: [],
    error: null,
    updatedAt: "2026-07-11T10:00:00.000Z",
    ...overrides,
  } as RunState
}

describe("recover command", () => {
  test("formats an empty stranded-run list for operators", () => {
    expect(formatStrandedRunTable([])).toBe("No stranded runs.")
  })

  test("maps a run state into an operator-facing row", () => {
    const row = toStrandedRunRow(fakeRunState({ runId: "run_abc", status: "waiting_approval" }))

    expect(row.runId).toBe("run_abc")
    expect(row.status).toBe("waiting_approval")
    expect(row.updatedAt).toBe(Date.parse("2026-07-11T10:00:00.000Z"))
  })

  test("renders mapped rows into a readable table", () => {
    const row = toStrandedRunRow(fakeRunState({ runId: "run_visible", status: "queued" }))
    const rendered = formatStrandedRunTable([row])

    expect(rendered).toContain("run_visible")
    expect(rendered).toContain("queued")
  })

  test(
    "lists and closes out a run whose process died mid-flight",
    async () => {
      const testHome = path.join(os.tmpdir(), `dax-test-home-${Date.now().toString(36)}-recover`)
      const previousHome = process.env.DAX_TEST_HOME
      process.env.DAX_TEST_HOME = testHome

      try {
        const { bootstrap } = await import("@/cli/bootstrap")
        const { RunStore } = await import("@/state/run-store")
        const { listInterruptedRuns, markRunInterrupted, INTERRUPTED_RUN_THRESHOLD_MS } = await import(
          "@/state/recovery"
        )
        const repoRoot = path.resolve(import.meta.dir, "../../../..")

        await bootstrap(repoRoot, async () => {
          const runId = `run_recover_cli_${Date.now().toString(36)}`
          const created = await RunStore.create(runId, `ctr_${runId}`)
          await RunStore.save(runId, {
            ...created,
            status: "running",
            updatedAt: new Date(Date.now() - INTERRUPTED_RUN_THRESHOLD_MS * 2).toISOString(),
          })

          const stranded = await listInterruptedRuns()
          const row = stranded.map(toStrandedRunRow).find((r) => r.runId === runId)
          expect(row).toBeDefined()
          expect(formatStrandedRunTable(stranded.map(toStrandedRunRow))).toContain(runId)

          const closed = await markRunInterrupted(runId)
          expect(closed?.status).toBe("failed")

          const stillStranded = await listInterruptedRuns()
          expect(stillStranded.map((r) => r.runId)).not.toContain(runId)
        })
      } finally {
        if (previousHome === undefined) delete process.env.DAX_TEST_HOME
        else process.env.DAX_TEST_HOME = previousHome
        rmSync(testHome, { recursive: true, force: true })
      }
    },
    40000,
  )
})
