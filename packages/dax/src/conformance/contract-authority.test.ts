import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian, ContractImmutabilityError } from "@/execution/contract-guardian"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { RunStore } from "@/state/run-store"
import { createEventAuthorityRun } from "@/state/events/event-transitions"
import { Storage } from "@/storage/storage"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
let testHome = ""
let previousTestHome: string | undefined

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  testHome = path.join(
    os.tmpdir(),
    `dax-contract-authority-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  )
  process.env.DAX_TEST_HOME = testHome
  mkdirSync(testHome, { recursive: true })
  await Instance.disposeAll()
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousTestHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousTestHome
  rmSync(testHome, { recursive: true, force: true })
})

async function createContract(title: string) {
  const session = await Session.create({ title })
  const { contract } = compileWithRunId(
    { request: { intent: { input: "Read one file and report the result." } } },
    session.id,
  )
  return { session, contract }
}

async function expectUnchanged(runId: string, contract: { intent: string }) {
  await expect(ContractGuardian.get(runId)).resolves.toMatchObject({ intent: contract.intent })
}

describe("ExecutionContract authority", () => {
  test("creates an initial contract and permits a pre-run refinement", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session, contract } = await createContract("Pre-run contract initialization")
        const refined = { ...contract, intent: "Read README.md and report the result." }

        await expect(ContractGuardian.create(session.id, contract)).resolves.toBeUndefined()
        await expect(ContractGuardian.create(session.id, refined)).resolves.toBeUndefined()
        await expectUnchanged(session.id, refined)
      },
    })
  })

  test("locks immediately when canonical authority is established, even with a legacy created row", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session, contract } = await createContract("Canonical authority wins")
        const changed = { ...contract, intent: "Changed after canonical authority started." }
        await ContractGuardian.create(session.id, contract)
        await createEventAuthorityRun(session.id, contract.contractId)
        await RunStore.create(session.id, contract.contractId)

        await expect(ContractGuardian.create(session.id, contract)).resolves.toBeUndefined()
        await expect(ContractGuardian.create(session.id, changed)).rejects.toBeInstanceOf(ContractImmutabilityError)
        await expectUnchanged(session.id, contract)
      },
    })
  })

  test("does not overwrite an existing contract when its read fails", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session, contract } = await createContract("Contract read failure")
        const changed = { ...contract, intent: "Changed while contract storage is unavailable." }
        await ContractGuardian.create(session.id, contract)

        const originalRead = Storage.read
        const read = spyOn(Storage, "read").mockImplementation(async (key: string[]) => {
          if (key[0] === "execution_contract") throw new Error("contract storage unavailable")
          return originalRead(key)
        })

        try {
          await expect(ContractGuardian.create(session.id, changed)).rejects.toThrow("contract storage unavailable")
        } finally {
          read.mockRestore()
        }

        await expectUnchanged(session.id, contract)
      },
    })
  })

  test("does not overwrite a readable but invalid stored contract", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session, contract } = await createContract("Invalid stored contract")
        const changed = { ...contract, intent: "Changed while the stored contract is invalid." }
        const key = ["execution_contract", Instance.project.id, session.id]
        await ContractGuardian.create(session.id, contract)
        await Storage.write(key, null)

        await expect(ContractGuardian.create(session.id, changed)).rejects.toThrow("Invalid ExecutionContract stored")
        await expect(Storage.read<unknown>(key)).resolves.toBeNull()
      },
    })
  })

  test("does not overwrite when authority storage is unreadable", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session, contract } = await createContract("Authority read failure")
        const changed = { ...contract, intent: "Changed while authority storage is unavailable." }
        await ContractGuardian.create(session.id, contract)

        const originalRead = Storage.read
        const read = spyOn(Storage, "read").mockImplementation(async (key: string[]) => {
          if (key[0] === "run_authority") throw new Error("authority storage unavailable")
          return originalRead(key)
        })

        try {
          await expect(ContractGuardian.create(session.id, changed)).rejects.toBeInstanceOf(ContractImmutabilityError)
        } finally {
          read.mockRestore()
        }

        await expectUnchanged(session.id, contract)
      },
    })
  })

  test("does not overwrite when an authority record is malformed", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session, contract } = await createContract("Malformed authority")
        const changed = { ...contract, intent: "Changed while authority data is malformed." }
        await ContractGuardian.create(session.id, contract)
        await Storage.write(["run_authority", Instance.project.id, session.id, "authority.json"], {})

        await expect(ContractGuardian.create(session.id, changed)).rejects.toBeInstanceOf(ContractImmutabilityError)
        await expectUnchanged(session.id, contract)
      },
    })
  })

  test("does not overwrite when canonical events remain after an authority marker is missing", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session, contract } = await createContract("Missing canonical authority")
        const changed = { ...contract, intent: "Changed after missing authority marker." }
        await ContractGuardian.create(session.id, contract)
        await createEventAuthorityRun(session.id, contract.contractId)
        await Storage.remove(["run_authority", Instance.project.id, session.id, "authority.json"])

        await expect(ContractGuardian.create(session.id, changed)).rejects.toBeInstanceOf(ContractImmutabilityError)
        await expectUnchanged(session.id, contract)
      },
    })
  })

  test("preserves legacy created initialization but locks legacy running contracts", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session, contract } = await createContract("Legacy contract lifecycle")
        const refined = { ...contract, intent: "Read README.md and report the result." }
        const changed = { ...refined, intent: "Changed after legacy execution started." }
        await ContractGuardian.create(session.id, contract)
        await RunStore.create(session.id, contract.contractId)

        await expect(ContractGuardian.create(session.id, refined)).resolves.toBeUndefined()
        await RunStore.update(session.id, (state) => ({ ...state, status: "running" }))
        await expect(ContractGuardian.create(session.id, changed)).rejects.toBeInstanceOf(ContractImmutabilityError)
        await expectUnchanged(session.id, refined)
      },
    })
  })
})
