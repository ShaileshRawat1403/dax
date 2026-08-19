import { afterAll, describe, expect, test } from "bun:test"
import { createEventAuthorityRun } from "@/state/events/event-transitions"
import { getProjectedRunState } from "@/state/events/run-event-store"
import os from "os"
import path from "path"
import { mkdtempSync, rmSync } from "fs"

const testHome = mkdtempSync(path.join(os.tmpdir(), "dax-recovery-"))
const previousHome = process.env.DAX_TEST_HOME
process.env.DAX_TEST_HOME = testHome

const mod = async () => await import("./recovery")
const store = async () => (await import("./run-store")).RunStore
const repoRoot = path.resolve(import.meta.dir, "../../..")

/** RunStore needs an Instance context, same as the sibling state tests. */
async function inRepo<T>(body: () => Promise<T>): Promise<T> {
  // Re-asserted per test, not once at module load. Every test file that sets
  // DAX_TEST_HOME does so at import time, so in a full run the last module
  // loaded wins and this file's runs land in a home it does not read back.
  process.env.DAX_TEST_HOME = testHome
  const { bootstrap } = await import("@/cli/bootstrap")
  let out: T
  await bootstrap(repoRoot, async () => {
    out = await body()
  })
  return out!
}

/** Fixed ids collided across runs sharing a home; the ordering they encode (aaa before zzz) is what the paging case tests, so keep that and make the rest unique. */
const uniq = Date.now().toString(36)
let counter = 0
const runId = () => `run_recovery_${Date.now().toString(36)}_${++counter}`

/** Backdate a run so staleness checks see it as abandoned. */
async function ageRun(id: string, agoMs: number) {
  const RunStore = await store()
  const state = (await getProjectedRunState(id))!
  await RunStore.save(id, { ...state, updatedAt: new Date(Date.now() - agoMs).toISOString() })
}

/** A run parked in a non-terminal status, last touched `agoMs` ago. */
async function strandedRun(status: "running" | "queued" | "waiting_approval", agoMs: number) {
  const id = runId()
  await createEventAuthorityRun(id, `ctr_${id}`)

  // Drive the run to the target status through its own lifecycle rather than
  // writing state directly: the log is the state, so a hand-written status would
  // describe a run whose events never happened.
  const { RunLifecycle } = await import("./run-lifecycle")
  await RunLifecycle.transition(id, "queued", "execution_queued")
  if (status === "running") await RunLifecycle.transition(id, "running", "execution_started")
  if (status === "waiting_approval") {
    await RunLifecycle.transition(id, "running", "execution_started")
    await RunLifecycle.transition(id, "waiting_approval", "approval_required")
  }

  await ageRun(id, agoMs)
  return id
}

afterAll(() => {
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  rmSync(testHome, { recursive: true, force: true })
})

describe("stranded runs", () => {
  test("a run whose process is gone is found, not left claiming to be live", async () => {
    return inRepo(async () => {
    // Measured on a real run: kill the process mid-flight and the persisted
    // state stays status "running", error null, completedAt null, forever.
    // recoverRun replays the log and reports the same thing back; nothing in
    // DAX could move it on.
    const { listInterruptedRuns, INTERRUPTED_RUN_THRESHOLD_MS } = await mod()
    const stranded = await strandedRun("running", INTERRUPTED_RUN_THRESHOLD_MS * 2)

    const found = await listInterruptedRuns()

    expect(found.map((run) => run.runId)).toContain(stranded)
    })
  })

  test("a run that is merely slow is left alone", async () => {
    return inRepo(async () => {
    const { listInterruptedRuns, INTERRUPTED_RUN_THRESHOLD_MS } = await mod()
    const busy = await strandedRun("running", INTERRUPTED_RUN_THRESHOLD_MS / 4)

    const found = await listInterruptedRuns()

    expect(found.map((run) => run.runId)).not.toContain(busy)
    })
  })

  test("a stranded run is found even behind more than a page of older runs", async () => {
    return inRepo(async () => {
      // Regression, measured: RunStore.list defaults to the first 100 keys and
      // Storage.list sorts lexicographically, so with ULID-prefixed ids that is
      // the oldest 100. Inheriting that default meant a project with more than
      // a hundred runs reported nothing stranded no matter what was stranded.
      // The feature worked in testing and quietly stopped working in use, which
      // on a governance signal reads as a clean bill of health.
      const { listInterruptedRuns, INTERRUPTED_RUN_THRESHOLD_MS } = await mod()
      const RunStore = await store()

      for (let i = 0; i < 120; i++) {
        const id = `run_aaa_${uniq}_${String(i).padStart(4, "0")}`
        await createEventAuthorityRun(id, "ctr_filler")
        const { RunLifecycle } = await import("./run-lifecycle")
        await RunLifecycle.transition(id, "queued", "execution_queued")
        await RunLifecycle.transition(id, "running", "execution_started")
        await RunLifecycle.transition(id, "completed", "run_completed")
        const state = (await getProjectedRunState(id))!
        await RunStore.save(id, { ...state, updatedAt: new Date().toISOString() })
      }

      const buriedId = `run_zzz_${uniq}_buried`
      await createEventAuthorityRun(buriedId, "ctr_buried")
      const { RunLifecycle: Lifecycle } = await import("./run-lifecycle")
      await Lifecycle.transition(buriedId, "queued", "execution_queued")
      await Lifecycle.transition(buriedId, "running", "execution_started")
      const buried = (await getProjectedRunState(buriedId))!
      await RunStore.save(buriedId, {
        ...buried,
        updatedAt: new Date(Date.now() - INTERRUPTED_RUN_THRESHOLD_MS * 2).toISOString(),
      })

      expect((await listInterruptedRuns()).map((run) => run.runId)).toContain(buriedId)
    })
  })

  test("every non-terminal status can strand, not just running", async () => {
    return inRepo(async () => {
    // A run can die waiting for an approval that will never be answered, or
    // sitting in the queue. Those lie in the ledger exactly as loudly.
    const { listInterruptedRuns, INTERRUPTED_RUN_THRESHOLD_MS } = await mod()
    const queued = await strandedRun("queued", INTERRUPTED_RUN_THRESHOLD_MS * 2)
    const waiting = await strandedRun("waiting_approval", INTERRUPTED_RUN_THRESHOLD_MS * 2)

    const ids = (await listInterruptedRuns()).map((run) => run.runId)

    expect(ids).toContain(queued)
    expect(ids).toContain(waiting)
    })
  })
})

describe("closing out a stranded run", () => {
  test("it is marked failed with a reason, not silently completed", async () => {
    return inRepo(async () => {
    const { markRunInterrupted, INTERRUPTED_RUN_THRESHOLD_MS } = await mod()
    const id = await strandedRun("running", INTERRUPTED_RUN_THRESHOLD_MS * 2)

    const result = await markRunInterrupted(id)

    expect(result?.status).toBe("failed")
    expect(result?.error?.code).toBe("run_interrupted")
    expect(result?.error?.message).toContain("running")
    expect(result?.completedAt).toBeDefined()
    })
  })

  test("the failure is retryable, because the work was interrupted and not rejected", async () => {
    return inRepo(async () => {
    const { markRunInterrupted, INTERRUPTED_RUN_THRESHOLD_MS } = await mod()
    const id = await strandedRun("running", INTERRUPTED_RUN_THRESHOLD_MS * 2)

    expect((await markRunInterrupted(id))?.error?.retryable).toBe(true)
    })
  })

  test("a run that already finished is never rewritten", async () => {
    return inRepo(async () => {
    // Marking a completed run as interrupted would be the ledger lying in the
    // other direction.
    const { markRunInterrupted } = await mod()
    const id = runId()
    await createEventAuthorityRun(id, `ctr_${id}`)

    const { RunLifecycle } = await import("./run-lifecycle")
    await RunLifecycle.transition(id, "queued", "execution_queued")
    await RunLifecycle.transition(id, "running", "execution_started")
    await RunLifecycle.transition(id, "completed", "run_completed")

    expect(await markRunInterrupted(id)).toBeUndefined()
    expect((await getProjectedRunState(id))?.status).toBe("completed")
    })
  })

  test("once closed out, it stops being reported as stranded", async () => {
    return inRepo(async () => {
    const { listInterruptedRuns, markRunInterrupted, INTERRUPTED_RUN_THRESHOLD_MS } = await mod()
    const id = await strandedRun("running", INTERRUPTED_RUN_THRESHOLD_MS * 2)

    await markRunInterrupted(id)

    expect((await listInterruptedRuns()).map((run) => run.runId)).not.toContain(id)
    })
  })
})
