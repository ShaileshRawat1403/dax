import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "@/project/instance"
import { Storage } from "@/storage/storage"
import {
  appendRunEventAtTail,
  initializeRunEventAuthority,
  readRunEvents,
  repairRunInitialization,
} from "./run-event-store"
import { createEvent, parseRunEventLog } from "./run-event-types"
import { reduceRunState } from "./run-reducer"

const repoRoot = path.resolve(import.meta.dir, "../../../../..")
let testHome: string
let previousHome: string | undefined

beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  testHome = await mkdtemp(path.join(os.tmpdir(), "dax-run-envelope-cutover-"))
  process.env.DAX_TEST_HOME = testHome
  await Instance.disposeAll()
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await rm(testHome, { recursive: true, force: true })
})

describe("run envelope cutover", () => {
  test("a newly initialized run writes a complete v2 owner sequence", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const runId = `run_${crypto.randomUUID().replaceAll("-", "")}`
        await initializeRunEventAuthority(runId, {
          contractId: `ctr_${runId}`,
          verificationRequired: false,
          guardEnforcementMode: "warn",
        })
        await appendRunEventAtTail(runId, { type: "execution_queued", payload: {} })
        const events = await readRunEvents(runId)
        expect(events.map((event) => event.schemaVersion)).toEqual(["v2", "v2"])
        expect(events.map((event) => [event.scopeType, event.scopeId])).toEqual([
          ["run", runId],
          ["run", runId],
        ])
      },
    })
  })

  test("a historical v1 run remains v1 when appended and independently replayable", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const runId = `run_${crypto.randomUUID().replaceAll("-", "")}`
        const genesis = createEvent(runId, 0, "contract_compiled", { contractId: `ctr_${runId}` })
        await Storage.write(["run_events", Instance.project.id, runId, "events.json"], [genesis])
        await appendRunEventAtTail(runId, { type: "execution_queued", payload: {} })
        const events = await readRunEvents(runId)
        expect(events.map((event) => event.schemaVersion)).toEqual(["v1", "v1"])
        expect(events.every((event) => event.scopeType === undefined && event.scopeId === undefined)).toBe(true)
        expect(reduceRunState(events)?.runId).toBe(runId)
        const before = [...events]
        const rejected = await appendRunEventAtTail(runId, {
          type: "execution_queued",
          payload: {},
          sourceRefs: [{ scopeType: "project", scopeId: "project_source", eventId: "evt_source" }],
        }).then(
          () => null,
          (error: unknown) => error,
        )
        expect(String(rejected)).toContain("v1 run envelopes")
        expect(await readRunEvents(runId)).toEqual(before)
      },
    })
  })

  test("mixed v1 and v2 envelopes cannot make one run appear partly migrated", () => {
    const runId = "run_mixed_envelope"
    const genesis = createEvent(runId, 0, "contract_compiled", { contractId: "ctr_mixed" })
    const queued = {
      ...createEvent(runId, 1, "execution_queued", {}),
      schemaVersion: "v2" as const,
      scopeType: "run" as const,
      scopeId: runId,
    }
    expect(() => parseRunEventLog(runId, [genesis, queued])).toThrow(/mixed|schemaVersion|version/i)
  })

  test("repair of a historical initialization recipe retains the v1 format", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const runId = "run_historical_recipe"
        await Storage.write(["run_authority", Instance.project.id, runId, "authority.json"], {
          authority: "event-log",
          initialization: { contractId: "ctr_historical", verificationRequired: false, guardEnforcementMode: "warn" },
        })
        await repairRunInitialization(runId)
        expect((await readRunEvents(runId)).map((event) => event.schemaVersion)).toEqual(["v1"])
      },
    })
  })

  test("new initialization persists its envelope version before an interrupted genesis append", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const runId = "run_new_recipe"
        const rename = Storage.rename
        const interrupted = spyOn(Storage, "rename").mockImplementation(async (from, to) => {
          if (to.at(-1) === "events.json") throw new Error("forced_genesis_interruption")
          return rename(from, to)
        })
        let failure: unknown
        try {
          failure = await initializeRunEventAuthority(runId, {
            contractId: "ctr_new",
            verificationRequired: false,
            guardEnforcementMode: "warn",
          }).then(
            () => null,
            (error: unknown) => error,
          )
        } finally {
          interrupted.mockRestore()
        }
        expect(String(failure)).toContain("forced_genesis_interruption")
        expect(await Storage.read(["run_authority", Instance.project.id, runId, "authority.json"])).toMatchObject({
          envelopeVersion: "v2",
        })
        expect(await readRunEvents(runId)).toEqual([])
        await repairRunInitialization(runId)
        expect((await readRunEvents(runId)).map((event) => event.schemaVersion)).toEqual(["v2"])
      },
    })
  })

  test("concurrent initialization and tail appends retain one v2 birth format", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const runId = "run_concurrent_v2"
        const input = {
          contractId: "ctr_concurrent",
          verificationRequired: false,
          guardEnforcementMode: "warn" as const,
        }
        await Promise.all(Array.from({ length: 4 }, () => initializeRunEventAuthority(runId, input)))
        await Promise.all(
          Array.from({ length: 4 }, () => appendRunEventAtTail(runId, { type: "execution_queued", payload: {} })),
        )
        const events = await readRunEvents(runId)
        expect(events.map((event) => event.seq)).toEqual([0, 1, 2, 3, 4])
        expect(events.every((event) => event.schemaVersion === "v2" && event.scopeId === runId)).toBe(true)
      },
    })
  })

  test("a direct append cannot supersede a historical interrupted recipe", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const runId = "run_old_recipe_race"
        const payload = { contractId: "ctr_old", verificationRequired: false, guardEnforcementMode: "warn" as const }
        await Storage.write(["run_authority", Instance.project.id, runId, "authority.json"], {
          authority: "event-log",
          initialization: payload,
        })
        const rejected = await appendRunEventAtTail(runId, { type: "contract_compiled", payload }).then(
          () => null,
          (error: unknown) => error,
        )
        expect(String(rejected)).toContain("Conflicting initialization envelope version")
        expect(await readRunEvents(runId)).toEqual([])
        await repairRunInitialization(runId)
        expect((await readRunEvents(runId))[0].schemaVersion).toBe("v1")
      },
    })
  })

  test("v2 preserves validated source references without accepting caller-selected owners", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const runId = "run_v2_refs"
        await initializeRunEventAuthority(runId, { contractId: "ctr_refs" })
        const sourceRefs = [{ scopeType: "project" as const, scopeId: "project_source", eventId: "evt_source" }]
        await appendRunEventAtTail(runId, { type: "execution_queued", payload: {}, sourceRefs })
        const before = await readRunEvents(runId)
        expect(before[1].sourceRefs).toEqual(sourceRefs)
        for (const extra of [{ scopeType: "project", scopeId: "other" }, { schemaVersion: "v1" }, { runId: "other" }]) {
          const rejected = await appendRunEventAtTail(runId, {
            type: "execution_queued",
            payload: {},
            ...extra,
          } as never).then(
            () => null,
            (error: unknown) => error,
          )
          expect(String(rejected)).toContain("store-owned")
          expect(await readRunEvents(runId)).toEqual(before)
        }
        const rejected = await appendRunEventAtTail(runId, {
          type: "execution_queued",
          payload: {},
          sourceRefs: [{ ...sourceRefs[0], scopeId: "" }],
        }).then(
          () => null,
          (error: unknown) => error,
        )
        expect(rejected).toBeInstanceOf(Error)
        expect(await readRunEvents(runId)).toEqual(before)
      },
    })
  })

  test("mixed logs and recipe-version conflicts reject read, repair and append without rewriting storage", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const payload = {
          contractId: "ctr_conflict",
          verificationRequired: false,
          guardEnforcementMode: "warn" as const,
        }
        for (const corruption of ["mixed", "recipe", "invalid_marker"]) {
          const runId = `run_corrupt_${corruption}`
          const genesis = createEvent(runId, 0, "contract_compiled", payload)
          const raw =
            corruption === "mixed"
              ? [
                  genesis,
                  {
                    ...createEvent(runId, 1, "execution_queued", {}),
                    schemaVersion: "v2",
                    scopeType: "run",
                    scopeId: runId,
                  },
                ]
              : [genesis]
          const eventPath = ["run_events", Instance.project.id, runId, "events.json"]
          await Storage.write(eventPath, raw)
          await Storage.write(["run_authority", Instance.project.id, runId, "authority.json"], {
            authority: "event-log",
            initialization: payload,
            envelopeVersion: corruption === "invalid_marker" ? "v3" : "v2",
          })
          for (const operation of [
            () => readRunEvents(runId),
            () => repairRunInitialization(runId),
            () => appendRunEventAtTail(runId, { type: "execution_queued", payload: {} }),
          ]) {
            const rejected = await operation().then(
              () => null,
              (error: unknown) => error,
            )
            expect(rejected).toBeInstanceOf(Error)
            expect(await Storage.read<unknown[]>(eventPath)).toEqual(raw)
          }
        }
      },
    })
  })
})
