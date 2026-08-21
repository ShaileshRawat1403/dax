import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Storage } from "@/storage/storage"
import { compileWithRunId } from "./compiler"
import { ContractGuardian, resolveExecutionAuthority } from "./contract-guardian"
import { createRunFromContract } from "./run-factory"

let testHome = ""
let previousTestHome: string | undefined
let testProject = ""

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  testHome = path.join(os.tmpdir(), `dax-contract-authority-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
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

  test("binds governing run identity once and rejects rebinding", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Governed root" })
        await expect(Session.bindGoverningRun(session.id, session.id)).resolves.toMatchObject({ governingRunId: session.id })
        await expect(Session.bindGoverningRun(session.id, session.id)).resolves.toMatchObject({ governingRunId: session.id })
        await expect(Session.bindGoverningRun(session.id, "ses_other_authority")).rejects.toThrow(/cannot rebind/i)
      },
    })
  })

  test("resolves a legacy root contract under its own session ID", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Legacy governed root" })
        const contract = await createContract(session)

        await expect(resolveExecutionAuthority(session.id)).resolves.toMatchObject({
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
        await expect(resolveExecutionAuthority(session.id)).resolves.toEqual({ contract: null })
      },
    })
  })

  test("fails closed when an explicit governing contract is absent or corrupt", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const child = await Session.create({ title: "Governed child" })
        await Session.bindGoverningRun(child.id, "ses_missing_authority")
        await expect(resolveExecutionAuthority(child.id, "ses_missing_authority")).rejects.toThrow(
          /Governing ExecutionContract not found/i,
        )

        const root = await Session.create({ title: "Corrupt authority" })
        await Session.bindGoverningRun(root.id, root.id)
        await Storage.write(["execution_contract", Instance.project.id, root.id], { malformed: true })
        await expect(resolveExecutionAuthority(root.id, root.governingRunId)).rejects.toThrow(/Invalid ExecutionContract/i)
      },
    })
  })

  test("rejects malformed explicit authority references instead of treating them as ungoverned", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const child = await Session.create({ title: "Malformed governed child" })

        await expect(Session.bindGoverningRun(child.id, "")).rejects.toThrow()

        await Storage.update<any>(["session", Instance.project.id, child.id], (draft) => {
          draft.governingRunId = ""
        })
        const persisted = await Session.get(child.id)

        await expect(resolveExecutionAuthority(persisted.id, persisted.governingRunId)).rejects.toThrow()
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
