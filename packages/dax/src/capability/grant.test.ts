import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian, resolveExecutionAuthority } from "@/execution/contract-guardian"
import { ContractImmutabilityError } from "@/execution/contract-guardian"
import { ExecutionContract } from "@/execution/execution-contract"
import { createEventAuthorityRun } from "@/state/events/event-transitions"
import { CapabilityGrants } from "./grant"

let home: string
let directory: string
let previousHome: string | undefined

beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-capability-grants-"))
  directory = path.join(home, "project")
  process.env.DAX_TEST_HOME = home
  await fs.mkdir(directory, { recursive: true })
  await Instance.disposeAll()
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await fs.rm(home, { recursive: true, force: true })
})

const grants = [
  {
    capabilityId: "native.tool.read",
    decision: "allow" as const,
    scope: { kind: "filesystem" as const, roots: ["src/"] },
  },
  {
    capabilityId: "native.tool.task",
    decision: "ask" as const,
    scope: { kind: "delegation" as const, agents: ["explore"] },
  },
]

describe("versioned capability grant contracts", () => {
  test("historical v1 contracts remain valid without invented grants", () => {
    const { contract } = compileWithRunId({ request: { intent: { input: "Inspect source." } } }, "ses_legacy")
    const parsed = ExecutionContract.parse(JSON.parse(JSON.stringify(contract)))
    expect(parsed.schemaVersion).toBe("v1")
    expect(parsed.capabilityGrants).toBeUndefined()
    expect(ExecutionContract.safeParse({ ...parsed, capabilityGrants: [] }).success).toBe(false)
  })

  test("v2 grants survive durable contract storage and cannot change after run birth", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const session = await Session.create({ title: "Grant storage" })
        const { contract } = compileWithRunId({ request: { intent: { input: "Inspect source." } } }, session.id)
        contract.schemaVersion = "v2"
        contract.capabilityGrants = grants
        const parsed = ExecutionContract.parse(contract)
        await ContractGuardian.create(session.id, parsed)
        const reloaded = await resolveExecutionAuthority(session.id)
        expect(reloaded.contract?.schemaVersion).toBe("v2")
        expect(reloaded.contract?.capabilityGrants).toEqual(grants)
        await createEventAuthorityRun(session.id, contract.contractId)
        const changed = await ContractGuardian.create(session.id, {
          ...parsed,
          capabilityGrants: [{ ...grants[0], decision: "ask" }],
        }).then(
          () => "unexpected success",
          (error: unknown) => error,
        )
        expect(changed).toBeInstanceOf(ContractImmutabilityError)
        expect((await resolveExecutionAuthority(session.id)).contract?.capabilityGrants).toEqual(grants)
      },
    })
  })

  test("v2 requires a unique strict grant set; v1 cannot claim it", () => {
    const { contract } = compileWithRunId({ request: { intent: { input: "Inspect source." } } }, "ses_invalid")
    expect(ExecutionContract.safeParse({ ...contract, schemaVersion: "v2" }).success).toBe(false)
    expect(ExecutionContract.safeParse({ ...contract, capabilityGrants: grants }).success).toBe(false)
    expect(CapabilityGrants.safeParse([grants[0], grants[0]]).success).toBe(false)
    expect(
      CapabilityGrants.safeParse([{ ...grants[0], scope: { kind: "filesystem", roots: ["src/", "src/"] } }]).success,
    ).toBe(false)
    expect(
      CapabilityGrants.safeParse([{ ...grants[0], scope: { kind: "delegation", agents: ["explore", "explore"] } }])
        .success,
    ).toBe(false)
    for (const invalid of [
      { ...grants[0], capabilityId: "not-a-capability" },
      { ...grants[0], decision: "grant" },
      { ...grants[0], scope: { kind: "filesystem", roots: [] } },
      { ...grants[0], scope: { kind: "opaque", roots: ["src/"] } },
      { ...grants[0], budgets: { maxFiles: 999 } },
    ]) {
      expect(CapabilityGrants.safeParse([invalid]).success).toBe(false)
    }
  })
})
