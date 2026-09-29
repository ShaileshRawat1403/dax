import { describe, expect, test } from "bun:test"
import { expectAsyncGap, expectGap } from "./known-gaps"
import { join } from "node:path"
import { nativeCapabilities, createCapabilityRegistry } from "@/capability/registry"
import { CapabilityDescriptor } from "@/capability/capability-types"
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import { Instance } from "@/project/instance"
import { tmpdir } from "node:os"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { Storage } from "@/storage/storage"
import { Session } from "@/session"
import { ContractGuardian, resolveExecutionAuthority } from "@/execution/contract-guardian"
import { compileWithRunId } from "@/execution/compiler"
import { ExecutionContractV2 } from "@/execution/execution-contract"
import z from "zod"

/**
 * Invariant 5 — Contract-Defined Authority.
 *
 * Capabilities describe what can exist. Contracts determine what this run may
 * exercise.
 *
 *     Contract   = operator-approved execution authority
 *     Capability = vocabulary used to express that authority
 *     Grant      = contract-specific permission to exercise a capability
 *
 * Decision procedure: is authority expressed once, in the contract, or does the
 * capability carry a second policy?
 *
 * This invariant exists to prevent a specific failure: two overlapping policy
 * systems under cleaner names. A capability may declare intrinsic properties
 * (risk class, whether it supports scoping, whether it requires verification). It
 * may not declare authority. Authority belongs to the contract, because the
 * contract is the artifact an operator reviews.
 *
 * The initial v1.3.0 specification was structural. Native enrollment now has
 * ordinary behavioral checks; the aggregate vocabulary/property gaps remain
 * open because other executor families still lack enrollment.
 */

describe("invariant 5 — contract-defined authority", () => {
  test("enrolled native vocabulary rejects unknown and duplicate capabilities", () => {
    expect(nativeCapabilities.require("native.tool.write").scopeSupport).toBe("filesystem")
    expect(() => nativeCapabilities.require("native.tool.not_real")).toThrow("Unknown capability")
    const descriptor = nativeCapabilities.require("native.tool.write")
    expect(() => createCapabilityRegistry([descriptor, descriptor])).toThrow("Duplicate capability")
  })

  test("native intrinsic descriptors reject malformed values and authority fields", () => {
    const descriptor = nativeCapabilities.require("native.tool.shell")
    expect(descriptor.scopeSupport).toBe("opaque")
    for (const field of ["writeScope", "forbiddenPaths", "allowHosts", "budgets", "grants", "approvalPolicy"]) {
      expect(CapabilityDescriptor.safeParse({ ...descriptor, [field]: [] }).success).toBe(false)
    }
    expect(CapabilityDescriptor.safeParse({ ...descriptor, riskClass: "safe" }).success).toBe(false)
    expect(CapabilityDescriptor.safeParse({ ...descriptor, requiresVerification: "false" }).success).toBe(false)
    expect(CapabilityDescriptor.safeParse({ id: descriptor.id }).success).toBe(false)
    expect(Object.isFrozen(descriptor)).toBe(true)
  })

  test("aggregate vocabulary/properties remain open: real registered plugin lacks enrollment", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dax-capability-gap-"))
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = directory
    await mkdir(join(directory, ".config", "dax"), { recursive: true })
    try {
      await Instance.provide({
        directory,
        async fn() {
          await ToolRegistry.register(
            Tool.define("capability-gap-probe", {
              description: "Unenrolled plugin-shaped executor",
              parameters: z.object({}),
              result: Tool.result(z.object({})),
              async execute() {
                return { title: "probe", output: "probe", metadata: {} }
              },
            }),
          )
          const tools = await ToolRegistry.tools({ providerID: "", modelID: "" })
          const plugin = tools.find((item) => item.id === "capability-gap-probe")!
          const identity = ToolRegistry.executionIdentity(plugin)
          expect(identity.kind).toBe("plugin")
          expectGap("inv5.capability-vocabulary", () => {
            expect(identity.capability?.id).toBeDefined()
          })
          expectGap("inv5.capability-properties", () => {
            expect(CapabilityDescriptor.safeParse(identity.capability).success).toBe(true)
          })
        },
      })
    } finally {
      await Instance.disposeAll()
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("contract grant gap tracks the normal durable write boundary, not a filename", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dax-contract-grant-gap-"))
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = directory
    try {
      await Instance.provide({
        directory,
        async fn() {
          const session = await Session.create({ title: "Grant gap" })
          const { contract } = compileWithRunId({ request: { intent: { input: "Inspect." } } }, session.id)
          const candidate = ExecutionContractV2.parse({
            ...contract,
            schemaVersion: "v2",
            capabilityGrants: [{ capabilityId: "native.tool.read", decision: "allow", scope: { kind: "run" } }],
          })
          await expectAsyncGap("inv5.contract-grants", async () => {
            // Deliberately cross the TypeScript boundary to test runtime rejection.
            await ContractGuardian.create(session.id, candidate as never)
            expect((await ContractGuardian.get(session.id))?.capabilityGrants).toEqual(candidate.capabilityGrants)
          })
        },
      })
    } finally {
      await Instance.disposeAll()
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("grant resolution gap tracks the governing authority reader", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dax-grant-resolution-gap-"))
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = directory
    try {
      await Instance.provide({
        directory,
        async fn() {
          const session = await Session.create({ title: "Grant resolution gap" })
          const { contract } = compileWithRunId({ request: { intent: { input: "Inspect." } } }, session.id)
          const candidate = ExecutionContractV2.parse({
            ...contract,
            schemaVersion: "v2",
            capabilityGrants: [{ capabilityId: "native.tool.read", decision: "allow", scope: { kind: "run" } }],
          })
          await Storage.write(["execution_contract", Instance.project.id, session.id], candidate)
          await expectAsyncGap("inv5.grant-resolution", async () => {
            const authority = await resolveExecutionAuthority(session.id)
            expect(authority.contract?.capabilityGrants).toEqual(candidate.capabilityGrants)
          })
        },
      })
    } finally {
      await Instance.disposeAll()
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      await rm(directory, { recursive: true, force: true })
    }
  })
})
