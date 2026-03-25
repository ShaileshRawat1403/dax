import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import os from "os"
import path from "path"
import { rmSync, mkdirSync } from "fs"
import {
  appendRunEvent,
  readRunEvents,
  projectRunStateFromEvents,
  setRunAuthority,
  getRunAuthority,
  hasRunEvents,
  clearRunEvents,
  StaleAppendError,
} from "../../src/state/events/run-event-store"
import { reduceRunState } from "../../src/state/events/run-reducer"

describe("run-event-store", () => {
  const testHome = path.join(os.tmpdir(), `dax-event-store-${Date.now().toString(36)}`)
  const previousHome = process.env.DAX_TEST_HOME

  beforeEach(async () => {
    process.env.DAX_TEST_HOME = testHome
    mkdirSync(testHome, { recursive: true })
  })

  afterEach(() => {
    if (previousHome) {
      process.env.DAX_TEST_HOME = previousHome
    } else {
      delete process.env.DAX_TEST_HOME
    }
    try {
      rmSync(testHome, { recursive: true, force: true })
    } catch (e) {}
  })

  describe("appendRunEvent", () => {
    test("appends first event at seq 0", async () => {
      const runId = `test-run-${Date.now()}-1`
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        const event = await appendRunEvent(runId, 0, {
          type: "contract_compiled",
          payload: { contractId: "contract-1" },
        })

        expect(event.seq).toBe(0)
        expect(event.runId).toBe(runId)
        expect(event.type).toBe("contract_compiled")
        expect(event.eventId).toMatch(/^evt_/)
        expect(event.occurredAt).toBeDefined()
      })
    })

    test("appends events with incrementing seq", async () => {
      const runId = `test-run-${Date.now()}-2`
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await appendRunEvent(runId, 0, { type: "contract_compiled", payload: { contractId: "contract-2" } })
        await appendRunEvent(runId, 1, { type: "execution_queued", payload: {} })
        await appendRunEvent(runId, 2, { type: "workflow_started", payload: {} })

        const events = await readRunEvents(runId)

        expect(events).toHaveLength(3)
        expect(events[0].seq).toBe(0)
        expect(events[1].seq).toBe(1)
        expect(events[2].seq).toBe(2)
      })
    })

    test("stale append throws StaleAppendError", async () => {
      const runId = `test-run-${Date.now()}-3`
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await appendRunEvent(runId, 0, { type: "contract_compiled", payload: { contractId: "contract-3" } })

        await expect(appendRunEvent(runId, 0, { type: "execution_queued", payload: {} })).rejects.toThrow(
          StaleAppendError,
        )
      })
    })

    test("skipped seq throws StaleAppendError", async () => {
      const runId = `test-run-${Date.now()}-4`
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await appendRunEvent(runId, 0, { type: "contract_compiled", payload: { contractId: "contract-4" } })

        await expect(appendRunEvent(runId, 2, { type: "execution_queued", payload: {} })).rejects.toThrow(
          StaleAppendError,
        )
      })
    })

    test("preserves event order", async () => {
      const runId = `test-run-${Date.now()}-5`
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        const eventsToAppend = [
          { type: "contract_compiled" as const, payload: { contractId: "contract-5" } },
          { type: "execution_queued" as const, payload: {} },
          { type: "workflow_started" as const, payload: {} },
          {
            type: "approval_requested" as const,
            payload: { approvalId: "apr_001", approvalType: "tool", risk: "medium" },
          },
          { type: "approval_resolved" as const, payload: { approvalId: "apr_001", decision: "approved" as const } },
        ]

        for (let i = 0; i < eventsToAppend.length; i++) {
          await appendRunEvent(runId, i, eventsToAppend[i])
        }

        const events = await readRunEvents(runId)

        expect(events.map((e) => e.type)).toEqual([
          "contract_compiled",
          "execution_queued",
          "workflow_started",
          "approval_requested",
          "approval_resolved",
        ])
      })
    })
  })

  describe("readRunEvents", () => {
    test("returns empty array for non-existent run", async () => {
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        const events = await readRunEvents("non-existent-run-xyz")
        expect(events).toEqual([])
      })
    })

    test("reads appended events in order", async () => {
      const runId = `test-run-${Date.now()}-6`
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await appendRunEvent(runId, 0, { type: "contract_compiled", payload: { contractId: "contract-6" } })
        await appendRunEvent(runId, 1, { type: "execution_queued", payload: {} })

        const events = await readRunEvents(runId)

        expect(events).toHaveLength(2)
        expect(events[0].type).toBe("contract_compiled")
        expect(events[1].type).toBe("execution_queued")
      })
    })
  })

  describe("projectRunStateFromEvents", () => {
    test("returns null for non-existent run", async () => {
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        const state = await projectRunStateFromEvents("never-existed-run-xyz")
        expect(state).toBeNull()
      })
    })

    test("projects state from stored events", async () => {
      const runId = `test-run-${Date.now()}-7`
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await appendRunEvent(runId, 0, { type: "contract_compiled", payload: { contractId: "contract-7" } })
        await appendRunEvent(runId, 1, { type: "execution_queued", payload: {} })
        await appendRunEvent(runId, 2, { type: "workflow_started", payload: {} })

        const state = await projectRunStateFromEvents(runId)

        expect(state?.status).toBe("running")
        expect(state?.contractId).toBe("contract-7")
        expect(state?.runId).toBe(runId)
      })
    })

    test("projected state matches reducer-only test", async () => {
      const runId = `test-run-${Date.now()}-8`
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        const eventsToAppend = [
          { type: "contract_compiled" as const, payload: { contractId: "contract-8" } },
          { type: "execution_queued" as const, payload: {} },
          { type: "workflow_started" as const, payload: {} },
          {
            type: "approval_requested" as const,
            payload: { approvalId: "apr_proj_001", approvalType: "tool", risk: "medium" },
          },
        ]

        for (let i = 0; i < eventsToAppend.length; i++) {
          await appendRunEvent(runId, i, eventsToAppend[i])
        }

        const storedEvents = await readRunEvents(runId)
        const projectedState = await projectRunStateFromEvents(runId)
        const reducerState = reduceRunState(storedEvents)

        expect(projectedState).toEqual(reducerState)
        expect(projectedState?.status).toBe("waiting_approval")
        expect(projectedState?.pendingApprovalIds).toContain("apr_proj_001")
      })
    })

    test("approval resume through storage", async () => {
      const runId = `test-run-${Date.now()}-9`
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await appendRunEvent(runId, 0, { type: "contract_compiled", payload: { contractId: "contract-9" } })
        await appendRunEvent(runId, 1, { type: "execution_queued", payload: {} })
        await appendRunEvent(runId, 2, { type: "workflow_started", payload: {} })
        await appendRunEvent(runId, 3, {
          type: "approval_requested",
          payload: { approvalId: "apr_resume", approvalType: "tool", risk: "medium" },
        })
        await appendRunEvent(runId, 4, {
          type: "approval_resolved",
          payload: { approvalId: "apr_resume", decision: "approved" },
        })

        const state = await projectRunStateFromEvents(runId)

        expect(state?.status).toBe("running")
        expect(state?.pendingApprovalIds).toEqual([])
      })
    })
  })

  describe("authority management", () => {
    test("set and get run authority", async () => {
      const runId = `test-run-${Date.now()}-10`
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await setRunAuthority(runId, "event-log")

        const authority = await getRunAuthority(runId)
        expect(authority).toBe("event-log")
      })
    })

    test("getRunAuthority returns null for non-existent run", async () => {
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        const authority = await getRunAuthority("never-existed-authority-xyz")
        expect(authority).toBeNull()
      })
    })

    test("can set authority to legacy", async () => {
      const runId = `test-run-${Date.now()}-11`
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await setRunAuthority(runId, "legacy")

        const authority = await getRunAuthority(runId)
        expect(authority).toBe("legacy")
      })
    })
  })

  describe("hasRunEvents", () => {
    test("returns false for non-existent run", async () => {
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        const has = await hasRunEvents("never-existed-events-xyz")
        expect(has).toBe(false)
      })
    })

    test("returns true after appending events", async () => {
      const runId = `test-run-${Date.now()}-12`
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await appendRunEvent(runId, 0, { type: "contract_compiled", payload: { contractId: "contract-12" } })

        const has = await hasRunEvents(runId)
        expect(has).toBe(true)
      })
    })
  })

  describe("clearRunEvents", () => {
    test("clears all events for a run", async () => {
      const runId = `test-run-${Date.now()}-13`
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await appendRunEvent(runId, 0, { type: "contract_compiled", payload: { contractId: "contract-13" } })
        await appendRunEvent(runId, 1, { type: "execution_queued", payload: {} })

        await clearRunEvents(runId)

        const events = await readRunEvents(runId)
        expect(events).toEqual([])
      })
    })

    test("clearing non-existent run is idempotent", async () => {
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await clearRunEvents("non-existent-clear-xyz")
      })
    })
  })

  describe("end-to-end draft_and_approve flow", () => {
    test("full approval halt and resume through event store", async () => {
      const runId = `test-run-${Date.now()}-14`
      const { bootstrap } = await import("../../src/cli/bootstrap")
      await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {
        await appendRunEvent(runId, 0, { type: "contract_compiled", payload: { contractId: "contract-14" } })
        await appendRunEvent(runId, 1, { type: "execution_queued", payload: {} })
        await appendRunEvent(runId, 2, { type: "workflow_started", payload: {} })

        const preApprovalState = await projectRunStateFromEvents(runId)
        expect(preApprovalState?.status).toBe("running")

        await appendRunEvent(runId, 3, {
          type: "approval_requested",
          payload: { approvalId: "apr_draft_001", approvalType: "tool", risk: "medium" },
        })

        const haltedState = await projectRunStateFromEvents(runId)
        expect(haltedState?.status).toBe("waiting_approval")
        expect(haltedState?.pendingApprovalIds).toContain("apr_draft_001")

        await appendRunEvent(runId, 4, {
          type: "approval_resolved",
          payload: { approvalId: "apr_draft_001", decision: "approved" },
        })

        const resumedState = await projectRunStateFromEvents(runId)
        expect(resumedState?.status).toBe("running")
        expect(resumedState?.pendingApprovalIds).toEqual([])
      })
    })
  })
})
