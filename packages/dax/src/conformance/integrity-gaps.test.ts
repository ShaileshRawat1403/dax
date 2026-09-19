import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian, ContractImmutabilityError } from "@/execution/contract-guardian"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { createEventAuthorityRun } from "@/state/events/event-transitions"
import { getRunAuthority, readRunEvents, setRunAuthority, appendRunEvent } from "@/state/events/run-event-store"
import { recoverRun as recoverCanonicalRun } from "@/state/recovery"
import { recoverRun } from "@/state/events/runtime-recovery"
import { acquireRunLock } from "@/util/fs-lock"
import { Storage } from "@/storage/storage"

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

describe("initialization integrity", () => {
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

        expect(stored).toEqual(governingContract)
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
        expect(result.success).toBe(true)
        expect(result.action).toBe("retry")
        expect(result.continuation?.nextStep).toBe("start_execution")
        expect(await readRunEvents(session.id)).toHaveLength(1)
      },
    })
  })

  test("concurrent initialization retries keep one genesis event and reject changed settings", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session, contract } = await createContract("Idempotent initialization")
        await Promise.all(
          Array.from({ length: 4 }, () => createEventAuthorityRun(session.id, contract.contractId, true, "enforce")),
        )
        const before = await readRunEvents(session.id)
        expect(before).toHaveLength(1)
        expect(before[0].payload).toEqual({
          contractId: contract.contractId,
          verificationRequired: true,
          guardEnforcementMode: "enforce",
        })
        await expect(createEventAuthorityRun(session.id, contract.contractId, false, "enforce")).rejects.toThrow(
          /Conflicting initialization/,
        )
        await expect(createEventAuthorityRun(session.id, contract.contractId, true, "warn")).rejects.toThrow(
          /Conflicting initialization/,
        )
        await expect(createEventAuthorityRun(session.id, "different-contract", true, "enforce")).rejects.toThrow(
          /Conflicting initialization/,
        )
        await expect(setRunAuthority(session.id, "legacy")).rejects.toThrow(/Cannot replace canonical/)
        expect(await readRunEvents(session.id)).toEqual(before)
      },
    })
  })

  test("recovery replays the durable settings after a first-event write failure, once only", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session, contract } = await createContract("Recover exact initialization intent")
        const originalWrite = Storage.write
        const failure = new Error("injected event write failure")
        const write = spyOn(Storage, "write").mockImplementation(async (key, value) => {
          if (key[0] === "run_events" && key[2] === session.id) throw failure
          return originalWrite(key, value)
        })
        try {
          await expect(createEventAuthorityRun(session.id, contract.contractId, true, "enforce")).rejects.toBe(failure)
        } finally {
          write.mockRestore()
        }
        expect(await readRunEvents(session.id)).toEqual([])
        // Even before the first event exists, a retry cannot weaken the intent.
        await expect(createEventAuthorityRun(session.id, contract.contractId, false, "warn")).rejects.toThrow(
          /Conflicting initialization/,
        )
        // Both user-facing state recovery and runtime continuation repair the
        // same record, sharing the lock rather than appending duplicate genesis.
        const [canonical, runtime] = await Promise.all([recoverCanonicalRun(session.id), recoverRun(session.id)])
        expect(canonical.success).toBe(true)
        expect(canonical.recoveredRunState?.status).toBe("compiled")
        expect(runtime.success).toBe(true)
        const events = await readRunEvents(session.id)
        expect(events).toHaveLength(1)
        expect(events[0].payload).toEqual({
          contractId: contract.contractId,
          verificationRequired: true,
          guardEnforcementMode: "enforce",
        })
        await appendRunEvent(session.id, 1, { type: "execution_queued", payload: {} })
        const queued = await readRunEvents(session.id)
        await createEventAuthorityRun(session.id, contract.contractId, true, "enforce")
        await recoverRun(session.id)
        expect(await readRunEvents(session.id)).toEqual(queued)
      },
    })
  })

  test("marker-only legacy partial state stays closed instead of inventing initialization settings", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session, contract } = await createContract("Missing initialization evidence")
        await setRunAuthority(session.id, "event-log")
        expect((await recoverRun(session.id)).success).toBe(false)
        await expect(recoverCanonicalRun(session.id)).rejects.toThrow(/no canonical state/i)
        await expect(createEventAuthorityRun(session.id, contract.contractId)).rejects.toThrow(
          /No initialization intent/,
        )
        expect(await readRunEvents(session.id)).toEqual([])
      },
    })
  })

  test("malformed intent and corrupt logs cannot be repaired into weaker authority", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session, contract } = await createContract("Corrupted initialization evidence")
        const marker = ["run_authority", Instance.project.id, session.id, "authority.json"]
        await Storage.write(marker, { authority: "event-log", initialization: { contractId: contract.contractId } })
        await expect(recoverRun(session.id)).rejects.toThrow(/Incomplete persisted/)
        expect(await readRunEvents(session.id)).toEqual([])
        await Storage.write(marker, {
          authority: "event-log",
          initialization: {
            contractId: contract.contractId,
            verificationRequired: true,
            guardEnforcementMode: "enforce",
          },
        })
        const eventsKey = ["run_events", Instance.project.id, session.id, "events.json"]
        await Storage.write(eventsKey, [{ broken: true }])
        await expect(recoverRun(session.id)).rejects.toThrow()
        expect(await Storage.read(eventsKey)).toEqual([{ broken: true }])
        await Storage.write(eventsKey, null)
        await expect(recoverRun(session.id)).rejects.toThrow(/expected an array/)
        expect(await Storage.read(eventsKey)).toBeNull()
      },
    })
  })

  test("a separate process cannot replace a contract while authority is being established", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session, contract } = await createContract("Cross-process lock")
        const readyPath = path.join(testHome, "child-ready")
        const changed = { ...contract, intent: "Must not cross the authority lock" }
        const lock = await acquireRunLock(session.id)
        let released = false
        const script = `
          import { Instance } from ${JSON.stringify(path.join(repoRoot, "packages/dax/src/project/instance.ts"))};
          import { ContractGuardian, ContractImmutabilityError } from ${JSON.stringify(path.join(repoRoot, "packages/dax/src/execution/contract-guardian.ts"))};
          await Instance.provide({ directory: ${JSON.stringify(repoRoot)}, async fn() {
            await Bun.write(${JSON.stringify(readyPath)}, "ready");
            try {
              await ContractGuardian.create(${JSON.stringify(session.id)}, ${JSON.stringify(changed)});
              process.exitCode = 2;
            } catch (error) {
              if (!(error instanceof ContractImmutabilityError)) throw error;
            }
          }});
          await Instance.disposeAll();
        `
        const child = Bun.spawn([process.execPath, "--eval", script], {
          cwd: repoRoot,
          env: { ...process.env },
          stdout: "ignore",
          stderr: "pipe",
        })
        const stderr = new Response(child.stderr).text()
        try {
          const ready = (async () => {
            while (!(await Bun.file(readyPath).exists())) {
              if (child.exitCode !== null) throw new Error(await stderr)
              await Bun.sleep(10)
            }
          })()
          expect(await completesWithin(ready, 3000)).toBe(true)
          expect(await completesWithin(child.exited, 250)).toBe(false)
          // Simulate the marker publication while its run lock is held. The
          // child must re-evaluate mutability only after the lock is released.
          await Storage.write(["run_authority", Instance.project.id, session.id, "authority.json"], {
            authority: "event-log",
          })
          await lock.dispose()
          released = true
          expect(await completesWithin(child.exited, 3000)).toBe(true)
          expect(await child.exited).toBe(0)
          expect(await ContractGuardian.get(session.id)).toEqual(contract)
        } finally {
          if (child.exitCode === null) child.kill()
          await child.exited
          await stderr
          if (!released) await lock.dispose()
        }
      },
    })
  })
})
