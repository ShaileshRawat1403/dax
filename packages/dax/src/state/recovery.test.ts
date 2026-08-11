import { afterAll, describe, expect, test } from "bun:test"
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
  const { bootstrap } = await import("@/cli/bootstrap")
  let out: T
  await bootstrap(repoRoot, async () => {
    out = await body()
  })
  return out!
}

let counter = 0
const runId = () => `run_recovery_${Date.now().toString(36)}_${++counter}`

/** A run parked in a non-terminal status, last touched `agoMs` ago. */
async function strandedRun(status: "running" | "queued" | "waiting_approval", agoMs: number) {
  const RunStore = await store()
  const id = runId()
  const state = await RunStore.create(id, `ctr_${id}`)
  await RunStore.save(id, {
    ...state,
    status,
    updatedAt: new Date(Date.now() - agoMs).toISOString(),
  })
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
    const RunStore = await store()
    const id = runId()
    const state = await RunStore.create(id, `ctr_${id}`)
    await RunStore.save(id, { ...state, status: "completed", completedAt: new Date().toISOString() })

    expect(await markRunInterrupted(id)).toBeUndefined()
    expect((await RunStore.get(id))?.status).toBe("completed")
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
