import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian, ContractImmutabilityError } from "@/execution/contract-guardian"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { createEventAuthorityRun } from "@/state/events/event-transitions"
import { getRunAuthority, readRunEvents } from "@/state/events/run-event-store"
import { recoverRun } from "@/state/events/runtime-recovery"
import { Storage } from "@/storage/storage"
import { expectGap } from "./known-gaps"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
let testHome: string
let previousTestHome: string | undefined

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  testHome = await mkdtemp(path.join(os.tmpdir(), "dax-integrity-gaps-"))
  process.env.DAX_TEST_HOME = testHome
  await Instance.disposeAll()
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousTestHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousTestHome
  await rm(testHome, { recursive: true, force: true })
})

async function createContract(title: string) {
  const session = await Session.create({ title })
  const { contract } = compileWithRunId(
    { request: { intent: { input: "Read one file and report the result." } } },
    session.id,
  )
  await ContractGuardian.create(session.id, contract)
  return { session, contract }
}

async function completesWithin(promise: Promise<unknown>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

describe("integrity gap enforcement", () => {
  test("authority establishment and a concurrent contract rewrite preserve the governing contract", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session, contract } = await createContract("Cross-store contract race")
        const changed = { ...contract, intent: "Replace the governing intent during initialization." }
        const reachedWrite = Promise.withResolvers<void>()
        const releaseWrite = Promise.withResolvers<void>()
        const originalWrite = Storage.write
        const write = spyOn(Storage, "write").mockImplementation(async (key, content) => {
          if (key[0] === "execution_contract" && key[2] === session.id) {
            reachedWrite.resolve()
            await releaseWrite.promise
          }
          return originalWrite(key, content)
        })
        // Pause at the real storage boundary after the mutability decision.
        // A future cross-store lock may serialize authority behind this write;
        // release after a bounded wait so that implementation can finish too.
        const rewrite = ContractGuardian.create(session.id, changed).then(
          () => undefined,
          (error: unknown) => error,
        )
        let authority: Promise<void> | undefined
        let governingContract: Awaited<ReturnType<typeof ContractGuardian.get>> = null
        try {
          expect(await completesWithin(reachedWrite.promise, 2000)).toBe(true)
          authority = (async () => {
            await createEventAuthorityRun(session.id, contract.contractId)
            governingContract = await ContractGuardian.get(session.id)
          })()
          await completesWithin(authority, 1000)
        } finally {
          releaseWrite.resolve()
          await Promise.allSettled([rewrite, ...(authority ? [authority] : [])])
          write.mockRestore()
        }
        // Unexpected storage/setup failures must fail normally, not count as
        // evidence that the architectural gap is still open.
        await authority
        const rewriteError = await rewrite
        if (rewriteError !== undefined) expect(rewriteError).toBeInstanceOf(ContractImmutabilityError)
        expect(governingContract).not.toBeNull()
        expect(await getRunAuthority(session.id)).toBe("event-log")
        expect((await readRunEvents(session.id))[0]?.type).toBe("contract_compiled")
        const stored = await ContractGuardian.get(session.id)
        expect(stored).not.toBeNull()

        expectGap("integrity.contract-immutability-cross-store-race", () => {
          expect(stored).toEqual(governingContract)
        })
      },
    })
  })

  test("recovery can resume initialization after the authority marker survives a failed first append", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session, contract } = await createContract("Partial event-authority initialization")
        const originalRename = Storage.rename
        const failure = new Error("injected first event publication failure")
        const rename = spyOn(Storage, "rename").mockImplementation(async (from, to) => {
          if (to[0] === "run_events" && to[2] === session.id) throw failure
          return originalRename(from, to)
        })
        try {
          await expect(createEventAuthorityRun(session.id, contract.contractId)).rejects.toBe(failure)
        } finally {
          rename.mockRestore()
        }

        expect(await getRunAuthority(session.id)).toBe("event-log")
        expect(await readRunEvents(session.id)).toEqual([])
        await expect(
          ContractGuardian.create(session.id, {
            ...contract,
            intent: "Must remain locked after partial initialization.",
          }),
        ).rejects.toBeInstanceOf(ContractImmutabilityError)
        expect(await ContractGuardian.get(session.id)).toEqual(contract)

        // The injected outage is over. Exercise the real recovery entry point;
        // an unexpected exception is deliberately outside expectGap.
        const result = await recoverRun(session.id)
        expect(await ContractGuardian.get(session.id)).toEqual(contract)
        expectGap("integrity.event-authority-partial-initialization-recovery", () => {
          expect(result.success).toBe(true)
          expect(result.action).toBe("retry")
          expect(result.continuation?.nextStep).toBe("start_execution")
        })
      },
    })
  })
})
