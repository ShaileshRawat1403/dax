import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Storage } from "@/storage/storage"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian, resolveExecutionAuthority } from "@/execution/contract-guardian"
import { ExecutionContract, ExecutionContractV2 } from "@/execution/execution-contract"
import { CapabilityGrants } from "./grant"
import { nativeCapabilities } from "./registry"
import { resolveCapabilityGrant } from "./resolve-grant"
import { decideNativeGrant } from "./native-grant-decision"

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

function v2(runId = "ses_grant_resolver", items = grants) {
  const { contract } = compileWithRunId({ request: { intent: { input: "Inspect source." } } }, runId)
  return ExecutionContractV2.parse({ ...contract, schemaVersion: "v2", capabilityGrants: items })
}

describe("versioned capability grant contracts", () => {
  test("historical v1 contracts remain valid without invented grants", () => {
    const { contract } = compileWithRunId({ request: { intent: { input: "Inspect source." } } }, "ses_legacy")
    const parsed = ExecutionContract.parse(JSON.parse(JSON.stringify(contract)))
    expect(parsed.schemaVersion).toBe("v1")
    expect(parsed.capabilityGrants).toBeUndefined()
    expect(ExecutionContract.safeParse({ ...parsed, capabilityGrants: [] }).success).toBe(false)
  })

  test("v2 wire format round-trips, but the current runtime refuses to execute it", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const session = await Session.create({ title: "Grant storage" })
        const { contract } = compileWithRunId({ request: { intent: { input: "Inspect source." } } }, session.id)
        const candidate = ExecutionContractV2.parse({ ...contract, schemaVersion: "v2", capabilityGrants: grants })
        expect(ExecutionContractV2.parse(JSON.parse(JSON.stringify(candidate))).capabilityGrants).toEqual(grants)
        const normalWrite = await ContractGuardian.create(session.id, candidate as unknown as ExecutionContract).then(
          () => "unexpected success",
          (error: unknown) => error,
        )
        expect(String(normalWrite)).toContain("Invalid ExecutionContract proposed")
        expect(await resolveExecutionAuthority(session.id)).toEqual({ contract: null })
        await Storage.write(["execution_contract", Instance.project.id, session.id], candidate)
        const rejected = await resolveExecutionAuthority(session.id).then(
          () => "unexpected success",
          (error: unknown) => error,
        )
        expect(String(rejected)).toContain("Invalid ExecutionContract")
        const guarded = await ContractGuardian.get(session.id).then(
          () => "unexpected success",
          (error: unknown) => error,
        )
        expect(String(guarded)).toContain("Invalid ExecutionContract")
      },
    })
  })

  test("v2 requires a unique strict grant set; v1 cannot claim it", () => {
    const { contract } = compileWithRunId({ request: { intent: { input: "Inspect source." } } }, "ses_invalid")
    expect(ExecutionContractV2.safeParse({ ...contract, schemaVersion: "v2" }).success).toBe(false)
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

describe("v2 grant decision semantics before production wiring", () => {
  test("native decision intersects tool policy, executor identity and exact target scope", () => {
    const contract = v2()
    const read = nativeCapabilities.require("native.tool.read")
    const base = {
      contract,
      authorityRunId: contract.runId,
      toolId: "read",
      executor: { kind: "builtin" as const, id: "read" },
      capability: read,
      directory,
      worktree: directory,
    }
    expect(decideNativeGrant({ ...base, args: { filePath: "src/a.ts" } })).toEqual({
      decision: "allow", capabilityId: "native.tool.read",
    })
    expect(decideNativeGrant({ ...base, args: { filePath: "docs/a.ts" } })).toMatchObject({
      decision: "deny", reasonCode: "scope_outside",
    })
    expect(decideNativeGrant({ ...base, args: {} })).toMatchObject({ decision: "deny", reasonCode: "scope_unproven" })
    expect(decideNativeGrant({ ...base, capability: nativeCapabilities.require("native.tool.write"), args: { filePath: "src/a.ts" } }))
      .toMatchObject({ decision: "deny", reasonCode: "capability_identity_mismatch" })
    expect(decideNativeGrant({ ...base, capability: undefined, args: { filePath: "src/a.ts" } }))
      .toMatchObject({ decision: "deny", reasonCode: "capability_unenrolled" })
    expect(decideNativeGrant({ ...base, executor: { kind: "plugin", id: "read" }, args: { filePath: "src/a.ts" } }))
      .toMatchObject({ decision: "deny", reasonCode: "capability_identity_mismatch" })
    expect(decideNativeGrant({ ...base, contract: { ...contract, toolBlocklist: ["read"] }, args: { filePath: "src/a.ts" } }))
      .toMatchObject({ decision: "deny", reasonCode: "contract_tool_denied" })
    expect(decideNativeGrant({ ...base, contract: { ...contract, capabilityGrants: [] }, args: { filePath: "src/a.ts" } }))
      .toMatchObject({ decision: "deny", reasonCode: "grant_absent" })
    expect(decideNativeGrant({ ...base, contract: { ...contract, capabilityGrants: [grants[0], grants[0]] }, args: { filePath: "src/a.ts" } }))
      .toMatchObject({ decision: "deny", reasonCode: "contract_invalid" })
    const { contract: v1 } = compileWithRunId({ request: { intent: { input: "Inspect source." } } }, contract.runId)
    expect(decideNativeGrant({ ...base, contract: v1, capability: undefined, args: {} })).toEqual({
      decision: "allow", capabilityId: null,
    })
  })

  test("missing, out-of-scope and mixed-path requests deny; an in-scope request allows", () => {
    const contract = v2()
    const base = {
      contract,
      authorityRunId: contract.runId,
      descriptor: nativeCapabilities.require("native.tool.read"),
      directory,
      worktree: directory,
    }
    expect(resolveCapabilityGrant({ ...base, target: { paths: ["src/a.ts"] } }).decision).toBe("allow")
    expect(resolveCapabilityGrant(base)).toMatchObject({ decision: "deny", reasonCode: "scope_unproven" })
    expect(resolveCapabilityGrant({ ...base, target: { paths: ["src/a.ts", "docs/b.ts"] } })).toMatchObject({
      decision: "deny",
      reasonCode: "scope_outside",
    })
    expect(resolveCapabilityGrant({ ...base, target: { paths: ["../outside.txt"] } }).decision).toBe("deny")
    expect(
      resolveCapabilityGrant({ ...base, descriptor: nativeCapabilities.require("native.tool.write") }),
    ).toMatchObject({
      decision: "deny",
      reasonCode: "grant_absent",
    })
  })

  test("delegation asks only for the named agent; unsupported scope never grants", () => {
    const contract = v2()
    const base = {
      contract,
      authorityRunId: contract.runId,
      descriptor: nativeCapabilities.require("native.tool.task"),
      directory,
      worktree: directory,
    }
    expect(resolveCapabilityGrant({ ...base, target: { agent: "explore" } }).decision).toBe("ask")
    expect(resolveCapabilityGrant({ ...base, target: { agent: "build" } }).decision).toBe("deny")
    expect(resolveCapabilityGrant({ ...base, target: { paths: ["src/a.ts"] } })).toMatchObject({
      decision: "deny",
      reasonCode: "scope_unproven",
    })
    const shell = v2(contract.runId, [
      { capabilityId: "native.tool.shell", decision: "allow", scope: { kind: "filesystem", roots: ["src/"] } },
    ])
    expect(
      resolveCapabilityGrant({
        ...base,
        contract: shell,
        descriptor: nativeCapabilities.require("native.tool.shell"),
        target: { paths: ["src/a.ts"] },
      }),
    ).toMatchObject({ decision: "deny", reasonCode: "scope_unsupported" })
  })

  test("run mismatch, malformed contract and malformed descriptor fail closed", () => {
    const contract = v2()
    const base = {
      contract,
      authorityRunId: contract.runId,
      descriptor: nativeCapabilities.require("native.tool.read"),
      directory,
      worktree: directory,
      target: { paths: ["src/a.ts"] },
    }
    expect(resolveCapabilityGrant({ ...base, authorityRunId: "ses_other" })).toMatchObject({
      decision: "deny",
      reasonCode: "contract_run_mismatch",
    })
    expect(resolveCapabilityGrant({ ...base, descriptor: { ...base.descriptor, riskClass: "safe" } })).toMatchObject({
      decision: "deny",
      reasonCode: "descriptor_invalid",
    })
    expect(
      resolveCapabilityGrant({
        ...base,
        contract: { ...contract, capabilityGrants: [grants[0], grants[0]] },
      }),
    ).toMatchObject({ decision: "deny", reasonCode: "contract_invalid" })
  })
})
