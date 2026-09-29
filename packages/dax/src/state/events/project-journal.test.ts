import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "@/project/instance"
import { Storage } from "@/storage/storage"
import { acquireProjectLock, acquireRunLock } from "@/util/fs-lock"
import { appendRunEventAtTail, clearRunEvents, initializeRunEventAuthority, readRunEvents } from "./run-event-store"
import { appendProjectEvent, initializeProjectJournal, projectStateFromEvents, readProjectEvents } from "./project-journal"
import type { ProjectEventPayload, ProjectFact } from "./project-event-types"
import type { JournalEventReference } from "./scope-envelope"
import { projectFactApprovalSubject } from "./project-fact-approval"

const repoRoot = path.resolve(import.meta.dir, "../../../../..")
let testHome: string
let previousHome: string | undefined

beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  testHome = await mkdtemp(path.join(os.tmpdir(), "dax-project-journal-"))
  process.env.DAX_TEST_HOME = testHome
  await Instance.disposeAll()
})
afterEach(async () => {
  await Instance.disposeAll()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await rm(testHome, { recursive: true, force: true })
})

async function rejection(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation
  } catch (error) {
    if (error instanceof Error) return error
    throw error
  }
  throw new Error("Expected the operation to reject")
}

async function runSource(runId = `run_${crypto.randomUUID().replaceAll("-", "")}`): Promise<JournalEventReference> {
  await initializeRunEventAuthority(runId, {
    contractId: `ctr_${runId}`,
    verificationRequired: false,
    guardEnforcementMode: "warn",
  })
  const [genesis] = await readRunEvents(runId)
  return { scopeType: "run", scopeId: runId, eventId: genesis.eventId }
}

async function approvedSource(
  change: Exclude<ProjectEventPayload, { type: "project_initialized" }>,
  commandId: string,
  options: { decision?: "approved" | "rejected" } = {},
): Promise<JournalEventReference> {
  const genesis = await runSource()
  await appendRunEventAtTail(genesis.scopeId, { type: "execution_queued", payload: {} })
  await appendRunEventAtTail(genesis.scopeId, { type: "workflow_started", payload: {} })
  const approvalId = `apr_${crypto.randomUUID().replaceAll("-", "")}`
  await appendRunEventAtTail(genesis.scopeId, {
    type: "approval_requested",
    payload: {
      approvalId,
      approvalType: "workflow_gate",
      risk: "high",
      title: `Review ${change.type}`,
      reason: "Explicit project fact change",
      source: "manual",
      projectFactSubject: await projectFactApprovalSubject({
        projectId: Instance.project.id,
        commandId,
        change,
      }),
    },
  })
  const event = await appendRunEventAtTail(genesis.scopeId, {
    type: "approval_resolved",
    payload: { approvalId, decision: options.decision ?? "approved", actor: "test-operator", resolvedAt: new Date().toISOString() },
  })
  return { scopeType: "run", scopeId: genesis.scopeId, eventId: event.eventId }
}

function fact(factId: string, content = "A reviewed project decision"): ProjectFact {
  return { factId, kind: "memory", category: "decision", title: `Decision ${factId}`, content, tags: ["governed"] }
}

describe("project-owned journal", () => {
  test("promote, supersede, and retire replay from the project journal after source-run removal", async () => {
    let before: Awaited<ReturnType<typeof projectStateFromEvents>> = null
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const promotedChange = { type: "project_fact_promoted", payload: { fact: fact("fact_1") } } as const
        const promotedSource = await approvedSource(promotedChange, "promote_1")
        const promoted = await appendProjectEvent({
          ...promotedChange,
          sourceRefs: [promotedSource],
          commandId: "promote_1",
        })
        const replacedChange = { type: "project_fact_superseded", payload: { priorFactId: "fact_1", replacement: fact("fact_2", "Updated decision") } } as const
        const replacedSource = await approvedSource(replacedChange, "supersede_1")
        const replaced = await appendProjectEvent({
          ...replacedChange,
          sourceRefs: [replacedSource, { scopeType: "project", scopeId: Instance.project.id, eventId: promoted.eventId }],
          commandId: "supersede_1",
        })
        const retiredChange = { type: "project_fact_retired", payload: { factId: "fact_2", reason: "No longer applies" } } as const
        const retiredSource = await approvedSource(retiredChange, "retire_1")
        await appendProjectEvent({
          ...retiredChange,
          sourceRefs: [retiredSource, { scopeType: "project", scopeId: Instance.project.id, eventId: replaced.eventId }],
          commandId: "retire_1",
        })
        before = await projectStateFromEvents()
        expect(before?.facts.fact_1.status).toBe("superseded")
        expect(before?.facts.fact_1.supersededBy).toBe("fact_2")
        expect(before?.facts.fact_2.status).toBe("retired")
        expect((await readProjectEvents()).map((event) => event.seq)).toEqual([0, 1, 2, 3])
        for (const source of [promotedSource, replacedSource, retiredSource]) await clearRunEvents(source.scopeId)
        expect(await projectStateFromEvents()).toEqual(before)
      },
    })
    await Instance.disposeAll()
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        expect(await projectStateFromEvents()).toEqual(before)
      },
    })
  })

  test("invalid source, duplicate command, and conflicting transitions leave the journal unchanged", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const promotedChange = { type: "project_fact_promoted", payload: { fact: fact("fact_1") } } as const
        const source = await approvedSource(promotedChange, "promote_1")
        await initializeProjectJournal()
        const initial = await readProjectEvents()
        expect((await rejection(appendProjectEvent({
          type: "project_fact_promoted", payload: { fact: fact("fact_1") },
          sourceRefs: [{ ...source, eventId: "missing" }], commandId: "bad_source",
        }))).message).toContain("absent")
        expect(await readProjectEvents()).toEqual(initial)

        await appendProjectEvent({ ...promotedChange, sourceRefs: [source], commandId: "promote_1" })
        const before = await readProjectEvents()
        expect((await rejection(appendProjectEvent({
          type: "project_fact_promoted", payload: { fact: fact("fact_2") },
          sourceRefs: [source], commandId: "promote_1",
        }))).message).toContain("Duplicate project journal command")
        const promoteAgain = { type: "project_fact_promoted", payload: { fact: fact("fact_1") } } as const
        const promoteAgainSource = await approvedSource(promoteAgain, "promote_again")
        expect((await rejection(appendProjectEvent({
          ...promoteAgain, sourceRefs: [promoteAgainSource], commandId: "promote_again",
        }))).message).toContain("already recorded")
        const retireMissing = { type: "project_fact_retired", payload: { factId: "missing", reason: "Invalid" } } as const
        const retireMissingSource = await approvedSource(retireMissing, "retire_missing")
        expect((await rejection(appendProjectEvent({
          ...retireMissing, sourceRefs: [retireMissingSource], commandId: "retire_missing",
        }))).message).toContain("Only an active")
        expect(await readProjectEvents()).toEqual(before)
      },
    })
  })

  test("concurrent commands serialize and project locks do not block independent run locks", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const first = { type: "project_fact_promoted", payload: { fact: fact("fact_1") } } as const
        const second = { type: "project_fact_promoted", payload: { fact: fact("fact_2") } } as const
        const source1 = await approvedSource(first, "cmd_1")
        const source2 = await approvedSource(second, "cmd_2")
        const projectLock = await acquireProjectLock(Instance.project.id)
        const runLock = await acquireRunLock(Instance.project.id, { timeoutMs: 100 })
        await runLock.dispose()
        await projectLock.dispose()

        const results = await Promise.allSettled([
          appendProjectEvent({ ...first, sourceRefs: [source1], commandId: "cmd_1" }),
          appendProjectEvent({ ...second, sourceRefs: [source2], commandId: "cmd_2" }),
        ])
        expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"])
        expect((await readProjectEvents()).map((event) => event.seq)).toEqual([0, 1, 2])
      },
    })
  })

  test("denial and changed approved content cannot authorize a project transition", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const change = { type: "project_fact_promoted", payload: { fact: fact("fact_rejected") } } as const
        const rejected = await approvedSource(change, "rejected_1", { decision: "rejected" })
        await initializeProjectJournal()
        const before = await readProjectEvents()
        expect((await rejection(appendProjectEvent({ ...change, sourceRefs: [rejected], commandId: "rejected_1" }))).message)
          .toBe("project_fact_authorization_required")
        expect(await readProjectEvents()).toEqual(before)

        const approved = await approvedSource(change, "edited_1")
        const edited = { type: "project_fact_promoted", payload: { fact: fact("fact_rejected", "Edited after approval") } } as const
        expect((await rejection(appendProjectEvent({ ...edited, sourceRefs: [approved], commandId: "edited_1" }))).message)
          .toBe("project_fact_authorization_required")
        expect(await readProjectEvents()).toEqual(before)
      },
    })
  })

  test("a denied first promotion does not initialize or partially publish the journal", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const change = { type: "project_fact_promoted", payload: { fact: fact("fact_denied") } } as const
        const denied = await approvedSource(change, "first_denied", { decision: "rejected" })
        expect(await readProjectEvents()).toEqual([])
        expect((await rejection(appendProjectEvent({ ...change, sourceRefs: [denied], commandId: "first_denied" }))).message)
          .toBe("project_fact_authorization_required")
        expect(await readProjectEvents()).toEqual([])

        const approved = await approvedSource(change, "first_approved")
        const published = await appendProjectEvent({ ...change, sourceRefs: [approved], commandId: "first_approved" })
        expect(published.seq).toBe(1)
        expect((await readProjectEvents()).map((event) => event.type)).toEqual(["project_initialized", "project_fact_promoted"])
      },
    })
  })

  test("malformed owner and sequence corruption refuse read and append", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        await initializeProjectJournal()
        const [genesis] = await readProjectEvents()
        const key = ["project_events", Instance.project.id, "events.json"]
        for (const corrupt of [[{ ...genesis, scopeId: "other" }], [{ ...genesis, seq: 2 }]]) {
          await Storage.write(key, corrupt)
          expect(await rejection(readProjectEvents())).toBeInstanceOf(Error)
          expect(await rejection(initializeProjectJournal())).toBeInstanceOf(Error)
          expect(await Storage.read<unknown[]>(key)).toEqual(corrupt)
        }
      },
    })
  })

  test("failed genesis publication leaves no partial authority and exact retry succeeds", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const rename = spyOn(Storage, "rename").mockRejectedValueOnce(new Error("interrupted publication"))
        try {
          expect((await rejection(initializeProjectJournal())).message).toContain("interrupted publication")
        } finally {
          rename.mockRestore()
        }
        expect(await readProjectEvents()).toEqual([])
        await initializeProjectJournal()
        await initializeProjectJournal()
        expect((await readProjectEvents()).map((event) => event.type)).toEqual(["project_initialized"])
      },
    })
  })
})
