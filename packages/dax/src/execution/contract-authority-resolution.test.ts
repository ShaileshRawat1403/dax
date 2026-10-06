import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Storage } from "@/storage/storage"
import { compileWithRunId } from "./compiler"
import { ContractGuardian, resolveExecutionAuthority } from "./contract-guardian"
import { createRunFromContract } from "./run-factory"

let testHome = ""
let previousTestHome: string | undefined
let testProject = ""

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  testHome = path.join(
    os.tmpdir(),
    `dax-contract-authority-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  )
  testProject = path.join(testHome, "project")
  process.env.DAX_TEST_HOME = testHome
  await fs.mkdir(testProject, { recursive: true })
  await fs.mkdir(path.join(testHome, ".config", "dax"), { recursive: true })
  await Instance.disposeAll()
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousTestHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousTestHome
  await fs.rm(testHome, { recursive: true, force: true })
})

async function createContract(session: Session.Info) {
  const { contract } = compileWithRunId(
    { request: { intent: { input: "Exercise governed execution authority." } } },
    session.id,
  )
  await ContractGuardian.create(session.id, contract)
  return contract
}

describe("execution contract authority resolution", () => {
  test("RunFactory binds a new governed root to its own run identity before execution", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const run = await createRunFromContract({ request: { intent: { input: "" } } })
        expect((await Session.get(run.runId)).governingRunId).toBe(run.runId)
      },
    })
  })

  test("RunFactory marks its generic production prompt as single-shot completion", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const prompt = spyOn(SessionPrompt, "prompt").mockResolvedValue(undefined as never)
        try {
          const run = await createRunFromContract({
            request: { intent: { input: "Return a governed summary." }, workflowHint: "generic" },
          })
          expect(prompt).toHaveBeenCalledTimes(1)
          expect(prompt.mock.calls[0]?.[0]).toMatchObject({
            sessionID: run.runId,
            completionPolicy: "on_provider_stop",
          })
        } finally {
          prompt.mockRestore()
        }
      },
    })
  })

  test("binds governing run identity once and rejects rebinding", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Governed root" })
        expect(await Session.bindGoverningRun(session.id, session.id)).toMatchObject({ governingRunId: session.id })
        expect(await Session.bindGoverningRun(session.id, session.id)).toMatchObject({ governingRunId: session.id })
        await assert.rejects(Session.bindGoverningRun(session.id, "ses_other_authority"), /cannot rebind/i)
      },
    })
  })

  test("resolves a legacy root contract under its own session ID", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Legacy governed root" })
        const contract = await createContract(session)

        expect(await resolveExecutionAuthority(session.id)).toMatchObject({
          governingRunId: session.id,
          contract: { contractId: contract.contractId },
        })
      },
    })
  })

  test("keeps an unbound session genuinely ungoverned", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Ungoverned session" })
        expect(await resolveExecutionAuthority(session.id)).toEqual({ contract: null })
      },
    })
  })

  test("fails closed when an explicit governing contract is absent or corrupt", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const child = await Session.create({ title: "Governed child" })
        await Session.bindGoverningRun(child.id, "ses_missing_authority")
        await assert.rejects(
          resolveExecutionAuthority(child.id, "ses_missing_authority"),
          /Governing ExecutionContract not found/i,
        )

        const root = await Session.create({ title: "Corrupt authority" })
        await Session.bindGoverningRun(root.id, root.id)
        await Storage.write(["execution_contract", Instance.project.id, root.id], { malformed: true })
        await assert.rejects(resolveExecutionAuthority(root.id, root.governingRunId), /Invalid ExecutionContract/i)
      },
    })
  })

  test("rejects malformed explicit authority references instead of treating them as ungoverned", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const child = await Session.create({ title: "Malformed governed child" })

        await assert.rejects(Session.bindGoverningRun(child.id, ""))

        await Storage.update<Session.Info>(["session", Instance.project.id, child.id], (draft) => {
          draft.governingRunId = ""
        })
        await assert.rejects(Session.get(child.id), Session.AuthorityReferenceError)
        const persisted = await Storage.read<Session.Info>(["session", Instance.project.id, child.id])

        await assert.rejects(resolveExecutionAuthority(persisted.id, persisted.governingRunId))
      },
    })
  })

  test("forks persist the same governing run identity, including legacy roots", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const root = await Session.create({ title: "Legacy root" })
        await createContract(root)

        const child = await Session.fork({ sessionID: root.id })
        const grandchild = await Session.fork({ sessionID: child.id })

        expect((await Session.get(child.id)).governingRunId).toBe(root.id)
        expect((await Session.get(grandchild.id)).governingRunId).toBe(root.id)
      },
    })
  })
})
