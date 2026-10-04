import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Config } from "@/config/config"
import { createGrantReviewedRun } from "@/execution/run-factory"
import { GrantReview } from "@/capability/grant-review"
import { recordActionResolution } from "@/capability/record-resolution"
import { ContractGuardian } from "@/execution/contract-guardian"
import { grantReviewPath } from "@/execution/grant-review-barrier"
import { beginNativeInvocation } from "@/execution/native-settlement"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Storage } from "@/storage/storage"
import { mcpReadDescriptor } from "@/mcp/resource-identity"
import {
  appendRunEventAtTail,
  hasJournaledGrantReview,
  initializeRunEventAuthority,
  readRunEvents,
  repairRunInitialization,
} from "@/state/events/run-event-store"
import { createEvent, parseRunEventLog } from "@/state/events/run-event-types"
import { reduceRunState } from "@/state/events/run-reducer"
let home: string
let directory: string
let previousHome: string | undefined
beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "dax-grant-reservation-")))
  process.env.DAX_TEST_HOME = home
  directory = path.join(home, "project")
  await fs.mkdir(directory)
  await fs.mkdir(path.join(home, ".config", "dax"), { recursive: true })
  expect(Bun.spawnSync(["git", "init", "--quiet", directory]).exitCode).toBe(0)
  await Instance.disposeAll()
  Config.global.reset()
})
afterEach(async () => {
  await Instance.disposeAll()
  Config.global.reset()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await fs.rm(home, { recursive: true, force: true })
})
const within = (fn: () => Promise<void>) => Instance.provide({ directory, fn })
const input = { request: { intent: { input: "Inspect the repository, read only." } }, availableTools: ["read"] }
const refusal = (work: Promise<unknown>) =>
  work.then(
    () => undefined,
    (error: unknown) => error,
  )
// Spies inject faults only; no image, authority, provider or dispatch gate is replaced.
test("lost reservation before first request refuses effect entries and raw starts", async () =>
  within(async () => {
    let runId = ""
    const begin = spyOn(GrantReview, "begin").mockImplementation(async (id) => {
      runId = id
      throw new Error("interrupted before first request")
    })
    try {
      expect(await refusal(createGrantReviewedRun(input))).toBeDefined()
    } finally {
      begin.mockRestore()
    }
    const events = await readRunEvents(runId)
    expect(events.map((e) => e.type)).toEqual(["contract_compiled", "execution_queued"])
    expect(events[0].payload).toMatchObject({ grantReviewIntent: "reviewed_grants" })
    expect((await Session.get(runId)).governingRunId).toBe(runId)
    await Storage.remove(grantReviewPath(runId))
    expect(await hasJournaledGrantReview(runId)).toBe(true)
    let effects = 0
    const guard = async (work: Promise<unknown>) => {
      expect(
        await refusal(
          work.then(() => {
            effects++
          }),
        ),
      ).toBeDefined()
      expect(effects).toBe(0)
      expect(await readRunEvents(runId)).toEqual(events)
    }
    await guard(
      recordActionResolution({
        governedBy: { runId },
        subject: "lost-reservation",
        path: "mcp_resource",
        initiator: "operator",
        executor: { kind: "mcp", descriptor: mcpReadDescriptor("resource", "gamma", "file:///notes") },
        source: { server: "gamma", name: "file:///notes" },
      }),
    )
    await guard(ContractGuardian.get(runId))
    await guard(GrantReview.dispatchAuthority(runId))
    await guard(
      beginNativeInvocation({
        sessionID: runId,
        invocationId: "reservation-read",
        toolId: "read",
        executor: { kind: "builtin", id: "read" },
        capability: undefined,
        args: { filePath: "README.md" },
      }),
    )
    await guard(SessionPrompt.prompt({ sessionID: runId, parts: [{ type: "text", text: "Inspect." }] }))
    await guard(SessionPrompt.loop({ sessionID: runId }))
    await guard(SessionPrompt.command({ sessionID: runId, command: "pm", arguments: "list" }))
    const sentinel = path.join(home, "effect")
    await guard(SessionPrompt.shell({ sessionID: runId, agent: "build", command: `touch '${sentinel}'` }))
    expect(
      await fs.stat(sentinel).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
    expect(await Session.messages({ sessionID: runId })).toEqual([])
    for (const type of ["execution_started", "workflow_started"] as const) {
      expect(await refusal(appendRunEventAtTail(runId, { type, payload: {} }))).toBeDefined()
      expect(await readRunEvents(runId)).toEqual(events)
    }
  }))
test("session publication already has canonical birth and reservation", async () =>
  within(async () => {
    const createNext = Session.createNext
    let observed = false
    const create = spyOn(Session, "createNext").mockImplementation(async (params) => {
      expect(params.id).toBe(params.governingRunId)
      expect(reduceRunState(await readRunEvents(params.id!))?.grantReview.intent).toBe("reviewed_grants")
      expect((await GrantReview.get(params.id!))?.revisions).toEqual([])
      observed = true
      return createNext(params)
    })
    try {
      await createGrantReviewedRun(input)
    } finally {
      create.mockRestore()
    }
    expect(observed).toBe(true)
  }))
test("failed genesis leaves reviewed recipe and no publicly usable session", async () =>
  within(async () => {
    const rename = Storage.rename
    let runId = ""
    const fault = spyOn(Storage, "rename").mockImplementation(async (from, to) => {
      if (to[0] === "run_events" && to.at(-1) === "events.json") {
        runId = to[2]
        throw new Error("interrupted genesis")
      }
      return rename(from, to)
    })
    try {
      expect(await refusal(createGrantReviewedRun(input))).toBeDefined()
    } finally {
      fault.mockRestore()
    }
    expect(runId).not.toBe("")
    expect(await refusal(Session.get(runId))).toBeDefined()
    expect(await readRunEvents(runId)).toEqual([])
    expect(await hasJournaledGrantReview(runId)).toBe(true)
    expect(await refusal(ContractGuardian.get(runId))).toBeDefined()
    await repairRunInitialization(runId)
    expect(reduceRunState(await readRunEvents(runId))?.grantReview.intent).toBe("reviewed_grants")
  }))
test("review intent is exact on retries, recipe disagreement and malformed schema", async () =>
  within(async () => {
    const runId = "run_intent_retry"
    const ordinary = { contractId: "ctr_intent", verificationRequired: false, guardEnforcementMode: "warn" as const }
    const payload = { ...ordinary, grantReviewIntent: "reviewed_grants" as const }
    await initializeRunEventAuthority(runId, payload)
    await initializeRunEventAuthority(runId, payload)
    expect((await readRunEvents(runId)).length).toBe(1)
    expect(await refusal(initializeRunEventAuthority(runId, ordinary))).toBeDefined()
    const key = ["run_authority", Instance.project.id, runId, "authority.json"]
    const marker = await Storage.read<{ initialization: unknown }>(key)
    await Storage.write(key, { ...marker, initialization: ordinary })
    expect(await refusal(readRunEvents(runId))).toBeDefined()
    const malformed = {
      ...createEvent("run_bad_intent", 0, "contract_compiled", ordinary),
      payload: { ...ordinary, grantReviewIntent: "other" },
    }
    expect(() => parseRunEventLog("run_bad_intent", [malformed])).toThrow()
  }))
test("ordinary and historical births preserve absence and start semantics", async () =>
  within(async () => {
    const runId = "run_ordinary_intent"
    await initializeRunEventAuthority(runId, { contractId: "ctr_ordinary" })
    expect(await hasJournaledGrantReview(runId)).toBe(false)
    await appendRunEventAtTail(runId, { type: "execution_queued", payload: {} })
    await appendRunEventAtTail(runId, { type: "execution_started", payload: {} })
    expect(reduceRunState(await readRunEvents(runId))?.status).toBe("running")
    const historical = [
      createEvent("run_historical", 0, "contract_compiled", { contractId: "ctr_historical" }),
      createEvent("run_historical", 1, "execution_queued", {}),
      createEvent("run_historical", 2, "execution_started", {}),
    ]
    expect(reduceRunState(historical)?.status).toBe("running")
    expect(reduceRunState(historical)?.grantReview.intent).toBeUndefined()
    expect(await hasJournaledGrantReview("run_never_created")).toBe(false)
  }))

test("empty marker uncertainty refuses; readable ordinary history keeps legacy isolation", async () =>
  within(async () => {
    const runId = "run_empty_uncertainty"
    const key = ["run_authority", Instance.project.id, runId, "authority.json"]
    await Storage.write(key, { authority: "legacy" })
    expect(await hasJournaledGrantReview(runId)).toBe(false)
    await Storage.write(key, {})
    expect(await refusal(hasJournaledGrantReview(runId))).toBeDefined()
    const ordinary = createEvent(runId, 0, "contract_compiled", { contractId: "ctr_ordinary" })
    await Storage.write(["run_events", Instance.project.id, runId, "events.json"], [ordinary])
    expect(await hasJournaledGrantReview(runId)).toBe(false)
    const read = Storage.read
    const unavailable = spyOn(Storage, "read").mockImplementation(async (segments) => {
      if (segments[0] === "run_authority") throw new Error("authority unavailable")
      return read(segments)
    })
    try {
      expect(await hasJournaledGrantReview(runId)).toBe(false)
      expect(await refusal(hasJournaledGrantReview("run_empty_unreadable"))).toBeDefined()
    } finally {
      unavailable.mockRestore()
    }
  }))

test("erased birth intent and lost reservation cannot erase a readable reviewed recipe", async () =>
  within(async () => {
    const runId = "run_erased_birth_intent"
    const ordinary = {
      contractId: "ctr_erased_intent",
      verificationRequired: false,
      guardEnforcementMode: "warn" as const,
    }
    await initializeRunEventAuthority(runId, { ...ordinary, grantReviewIntent: "reviewed_grants" })
    const events = await readRunEvents(runId)
    const altered = [{ ...events[0], payload: ordinary }]
    const journalKey = ["run_events", Instance.project.id, runId, "events.json"]
    await Storage.write(journalKey, altered)
    expect(await hasJournaledGrantReview(runId)).toBe(true)
    expect(await refusal(ContractGuardian.get(runId))).toBeDefined()
    expect(await Storage.read<unknown>(journalKey)).toEqual(altered)
    const markerKey = ["run_authority", Instance.project.id, runId, "authority.json"]
    const marker = await Storage.read<Record<string, unknown>>(markerKey)
    await Storage.write(markerKey, { ...marker, initialization: { ...ordinary, grantReviewIntent: "malformed" } })
    expect(await hasJournaledGrantReview(runId)).toBe(true)
    expect(await refusal(ContractGuardian.get(runId))).toBeDefined()
    expect(await Storage.read<unknown>(journalKey)).toEqual(altered)
  }))
