import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian, resolveExecutionAuthority } from "@/execution/contract-guardian"
import { ExecutionContract, ExecutionContractV2 } from "@/execution/execution-contract"
import { mcpReadDescriptor } from "@/mcp/resource-identity"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Storage } from "@/storage/storage"
import { resolveCapabilityAuthority, type ResolveAuthorityInput } from "./authority"
import { mcpCapability, pluginCapability } from "./dynamic-identity"
import { CapabilityGrants, type CapabilityGrant } from "./grant"
import { nativeCapabilities } from "./registry"

const RUN = "ses_authority_resolver"
const native = (tool: string) => nativeCapabilities.require(`native.tool.${tool}`)
const capability = (capabilityId: string) => ({ kind: "capability" as const, capabilityId })
const run = { kind: "run" as const }

function v1(configure?: (contract: ExecutionContract) => void) {
  const { contract } = compileWithRunId({ request: { intent: { input: "Inspect source." } } }, RUN)
  contract.toolAllowlist = []
  contract.toolBlocklist = []
  configure?.(contract)
  return ExecutionContract.parse(contract)
}

function v2(grants: CapabilityGrant[], runId = RUN) {
  const { contract } = compileWithRunId({ request: { intent: { input: "Inspect source." } } }, runId)
  return ExecutionContractV2.parse({ ...contract, schemaVersion: "v2", capabilityGrants: grants })
}

function resolve(input: Partial<ResolveAuthorityInput> & Pick<ResolveAuthorityInput, "contract" | "executor">) {
  return resolveCapabilityAuthority({
    path: "native_tool",
    initiator: "model",
    authorityRunId: RUN,
    directory: repo,
    worktree: repo,
    ...input,
  })
}

const read = { kind: "builtin" as const, alias: "read", descriptor: native("read") }

// Path scope is decided on canonical paths, so the targets are real files.
let repo = ""
const inRepo = (...parts: string[]) => path.join(repo, ...parts)
beforeAll(async () => {
  repo = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "dax-authority-repo-")))
  await fs.mkdir(inRepo("src", "nested"), { recursive: true })
  await fs.mkdir(inRepo("srcfoo"), { recursive: true })
  await fs.mkdir(inRepo("docs"), { recursive: true })
})
afterAll(async () => {
  await fs.rm(repo, { recursive: true, force: true })
})

describe("shared capability authority resolution", () => {
  test("every result is record only, whatever it concludes", () => {
    const results = [
      resolve({ contract: null, executor: read }),
      resolve({ contract: v1(), executor: read }),
      resolve({ contract: v1((c) => (c.toolBlocklist = ["read"])), executor: read }),
      resolve({ contract: v2([]), executor: read }),
      resolve({ contract: v2([{ subject: capability("native.tool.read"), decision: "allow", scope: run }]), executor: read }),
    ]
    expect(results.map((item) => item.decision)).toEqual(["allow", "allow", "deny", "deny", "allow"])
    for (const result of results) expect(result.enforcement).toBe("record_only")
  })

  test("no contract and a v1 contract restate the existing rules and name the basis", () => {
    expect(resolve({ contract: null, executor: read })).toEqual({
      enforcement: "record_only",
      path: "native_tool",
      initiator: "model",
      enrolled: true,
      capabilityId: "native.tool.read",
      basis: "no_contract",
      decision: "allow",
      reasonCode: "no_governing_contract",
    })
    const contract = v1((c) => (c.toolAllowlist = ["read"]))
    expect(resolve({ contract, executor: read })).toEqual({
      enforcement: "record_only",
      path: "native_tool",
      initiator: "model",
      enrolled: true,
      capabilityId: "native.tool.read",
      basis: "v1_contract",
      contractId: contract.contractId,
      decision: "allow",
    })
    // The executor's own identity is recorded, and the alias rule is the v1 decision.
    const plugin = pluginCapability(["directory", "/tools/read.js", "default"]).descriptor
    expect(resolve({ contract, executor: { kind: "plugin", alias: "read", descriptor: plugin } })).toMatchObject({
      capabilityId: plugin.id,
      basis: "v1_contract",
      decision: "deny",
      reasonCode: "contract_alias_executor_mismatch",
    })
    expect(resolve({ contract: v1((c) => (c.toolBlocklist = ["read"])), executor: read })).toMatchObject({
      decision: "deny",
      reasonCode: "contract_tool_denied",
    })
  })

  test("a legacy executor with no descriptor is identified as unenrolled, and a v2 contract cannot name it", () => {
    const legacy = { kind: "plugin" as const, alias: "legacy_tool" }
    const underV1 = resolve({ contract: v1(), executor: legacy })
    expect(underV1).toMatchObject({ enrolled: false, basis: "v1_contract", decision: "allow" })
    expect("capabilityId" in underV1).toBe(false)
    expect(resolve({ contract: v2([]), executor: legacy })).toMatchObject({
      enrolled: false,
      basis: "v2_grant",
      decision: "deny",
      reasonCode: "capability_unenrolled",
    })
    // A malformed descriptor is not an identity either.
    expect(
      resolve({ contract: v2([]), executor: { ...legacy, descriptor: { id: "native.tool.read", grants: ["*"] } } }),
    ).toMatchObject({ enrolled: false, decision: "deny", reasonCode: "descriptor_invalid" })
  })

  test("under v2 a missing grant denies and only an explicit ask grant asks", () => {
    expect(resolve({ contract: v2([]), executor: read })).toMatchObject({
      basis: "v2_grant",
      decision: "deny",
      reasonCode: "grant_absent",
    })
    // A grant for another capability is not a grant for this one.
    const other = v2([{ subject: capability("native.tool.write"), decision: "allow", scope: run }])
    expect(resolve({ contract: other, executor: read })).toMatchObject({ decision: "deny", reasonCode: "grant_absent" })
    const asking = v2([{ subject: capability("native.tool.read"), decision: "ask", scope: run }])
    expect(resolve({ contract: asking, executor: read })).toMatchObject({ decision: "ask", grantScope: "run" })
    // There is no deny grant to write: absence is the denial.
    expect(
      CapabilityGrants.safeParse([{ subject: capability("native.tool.read"), decision: "deny", scope: run }]).success,
    ).toBe(false)
  })

  test("a v2 grant is matched by capability identity, never by alias", () => {
    const contract = v2([{ subject: capability("native.tool.read"), decision: "allow", scope: run }])
    const plugin = pluginCapability(["directory", "/tools/read.js", "default"]).descriptor
    expect(resolve({ contract, executor: read })).toMatchObject({ decision: "allow" })
    expect(resolve({ contract, executor: { kind: "plugin", alias: "read", descriptor: plugin } })).toMatchObject({
      capabilityId: plugin.id,
      decision: "deny",
      reasonCode: "grant_absent",
    })
  })

  test("filesystem and delegation grants need proven targets", () => {
    const contract = v2([
      { subject: capability("native.tool.read"), decision: "allow", scope: { kind: "filesystem", roots: ["src"] } },
      { subject: capability("native.tool.task"), decision: "ask", scope: { kind: "delegation", agents: ["explore"] } },
      { subject: capability("native.tool.shell"), decision: "allow", scope: { kind: "filesystem", roots: ["src"] } },
    ])
    const at = (paths: string[]) => resolve({ contract, executor: read, target: { paths } })
    expect(at([inRepo("src", "a.ts")])).toMatchObject({ decision: "allow", grantScope: "filesystem" })
    expect(at([inRepo("src", "a.ts"), inRepo("src", "nested", "b.ts")])).toMatchObject({ decision: "allow" })
    // A sibling whose name only starts with the root is outside it.
    expect(at([inRepo("srcfoo", "a.ts")])).toMatchObject({ decision: "deny", reasonCode: "scope_outside" })
    // Every target must be inside; one outside denies the whole action.
    expect(at([inRepo("src", "a.ts"), inRepo("docs", "b.md")])).toMatchObject({
      decision: "deny",
      reasonCode: "scope_outside",
    })
    expect(at([path.join(repo, "src", "..", "..", "outside.txt")]).decision).toBe("deny")
    expect(resolve({ contract, executor: read })).toMatchObject({ decision: "deny", reasonCode: "scope_unproven" })
    expect(at([])).toMatchObject({ decision: "deny", reasonCode: "scope_unproven" })

    const task = { kind: "builtin" as const, alias: "task", descriptor: native("task") }
    expect(resolve({ contract, executor: task, target: { agent: "explore" } })).toMatchObject({
      decision: "ask",
      grantScope: "delegation",
    })
    expect(resolve({ contract, executor: task, target: { agent: "build" } })).toMatchObject({
      decision: "deny",
      reasonCode: "scope_outside",
    })
    expect(resolve({ contract, executor: task })).toMatchObject({ decision: "deny", reasonCode: "scope_unproven" })

    // An opaque executor cannot be scoped to paths by a grant that says so.
    const shell = { kind: "builtin" as const, alias: "shell", descriptor: native("shell") }
    expect(resolve({ contract, executor: shell, target: { paths: [inRepo("src", "a.ts")] } })).toMatchObject({
      decision: "deny",
      reasonCode: "scope_unsupported",
    })
  })

  test("an MCP source selector names the server and family, and only a proven source matches", () => {
    const tool = mcpCapability(["mcp", "alpha", "probe"]).descriptor
    const resource = mcpReadDescriptor("resource", "alpha", "control://resource/probe")
    const prompt = mcpReadDescriptor("prompt", "alpha", "probe")
    const source = (server: string, family: "tool" | "resource" | "prompt") => ({
      subject: { kind: "mcp_source" as const, server, family },
      decision: "allow" as const,
      scope: run,
    })
    const contract = v2([source("alpha", "tool"), source("alpha", "resource")])
    const mcp = (descriptor: unknown, alias = "alpha_probe") => ({ kind: "mcp" as const, alias, descriptor })

    expect(
      resolve({ contract, executor: mcp(tool), source: { server: "alpha", name: "probe" } }),
    ).toMatchObject({ capabilityId: tool.id, decision: "allow", grantScope: "run" })
    expect(
      resolve({ contract, executor: mcp(resource), source: { server: "alpha", name: "control://resource/probe" } }),
    ).toMatchObject({ decision: "allow" })

    // No source, a source that does not mint this identity, and a display alias all fail.
    expect(resolve({ contract, executor: mcp(tool) })).toMatchObject({ decision: "deny", reasonCode: "source_unproven" })
    expect(
      resolve({ contract, executor: mcp(tool), source: { server: "alpha", name: "other" } }),
    ).toMatchObject({ decision: "deny", reasonCode: "source_unproven" })
    expect(
      resolve({ contract, executor: mcp(tool), source: { server: "alpha", name: "alpha_probe" } }),
    ).toMatchObject({ decision: "deny", reasonCode: "source_unproven" })

    // A proven source on a server the contract did not name has no grant.
    const beta = mcpCapability(["mcp", "beta", "probe"]).descriptor
    expect(
      resolve({ contract, executor: mcp(beta, "beta_probe"), source: { server: "beta", name: "probe" } }),
    ).toMatchObject({ decision: "deny", reasonCode: "grant_absent" })
    // A family the contract did not name has no grant, even on a named server.
    expect(
      resolve({ contract, executor: mcp(prompt), source: { server: "alpha", name: "probe" } }),
    ).toMatchObject({ decision: "deny", reasonCode: "grant_absent" })

    // A source selector only ever has run scope, and is unique per server and family.
    expect(
      CapabilityGrants.safeParse([{ ...source("alpha", "tool"), scope: { kind: "filesystem", roots: ["src"] } }]).success,
    ).toBe(false)
    expect(CapabilityGrants.safeParse([source("alpha", "tool"), source("alpha", "tool")]).success).toBe(false)
  })

  test("a v2 contract for another run, or a malformed one, denies", () => {
    const grants: CapabilityGrant[] = [{ subject: capability("native.tool.read"), decision: "allow", scope: run }]
    expect(resolve({ contract: v2(grants, "ses_other_run"), executor: read })).toMatchObject({
      decision: "deny",
      reasonCode: "contract_run_mismatch",
    })
    const malformed = { ...v2(grants), capabilityGrants: [{ capabilityId: "native.tool.read" }] } as never
    expect(resolve({ contract: malformed, executor: read })).toMatchObject({
      decision: "deny",
      reasonCode: "contract_invalid",
    })
  })
})

describe("the v2 contract format is inactive", () => {
  let home = ""
  let previousHome: string | undefined
  beforeEach(async () => {
    previousHome = process.env.DAX_TEST_HOME
    home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-authority-"))
    process.env.DAX_TEST_HOME = home
    await fs.mkdir(path.join(home, "project"), { recursive: true })
    await Instance.disposeAll()
  })
  afterEach(async () => {
    await Instance.disposeAll()
    if (previousHome === undefined) delete process.env.DAX_TEST_HOME
    else process.env.DAX_TEST_HOME = previousHome
    await fs.rm(home, { recursive: true, force: true })
  })

  test("a v1 contract cannot carry grants, and a stored v1 contract is unchanged by the new field", () => {
    const { contract } = compileWithRunId({ request: { intent: { input: "Inspect source." } } }, "ses_legacy")
    const parsed = ExecutionContract.parse(JSON.parse(JSON.stringify(contract)))
    expect(parsed.schemaVersion).toBe("v1")
    expect("capabilityGrants" in parsed).toBe(false)
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(JSON.parse(JSON.stringify(contract)))
    expect(ExecutionContract.safeParse({ ...parsed, capabilityGrants: [] }).success).toBe(false)
  })

  test("the v2 format round-trips, and the runtime refuses to write or execute it", async () => {
    await Instance.provide({
      directory: path.join(home, "project"),
      async fn() {
        const session = await Session.create({ title: "Inactive v2" })
        const { contract } = compileWithRunId({ request: { intent: { input: "Inspect source." } } }, session.id)
        const grants: CapabilityGrant[] = [
          { subject: capability("native.tool.read"), decision: "allow", scope: { kind: "filesystem", roots: ["src"] } },
          { subject: { kind: "mcp_source", server: "alpha", family: "resource" }, decision: "ask", scope: run },
        ]
        const candidate = ExecutionContractV2.parse({ ...contract, schemaVersion: "v2", capabilityGrants: grants })
        expect(ExecutionContractV2.parse(JSON.parse(JSON.stringify(candidate))).capabilityGrants).toEqual(grants)

        let refusal: unknown
        await ContractGuardian.create(session.id, candidate as unknown as ExecutionContract).catch((error) => {
          refusal = error
        })
        expect(String(refusal)).toContain("Invalid ExecutionContract proposed")
        expect(await resolveExecutionAuthority(session.id)).toEqual({ contract: null })

        // Even written straight to storage, it is not read as authority.
        await Storage.write(["execution_contract", Instance.project.id, session.id], candidate)
        let rejected: unknown
        await resolveExecutionAuthority(session.id).catch((error) => {
          rejected = error
        })
        expect(String(rejected)).toContain("Invalid ExecutionContract stored")
      },
    })
  })
})
