import { describe, expect, test } from "bun:test"
import { expectGap } from "./known-gaps"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { nativeCapabilities, createCapabilityRegistry } from "@/capability/registry"
import { CapabilityDescriptor } from "@/capability/capability-types"
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import { Instance } from "@/project/instance"
import { tmpdir } from "node:os"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
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

const SRC = join(import.meta.dir, "..")

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

  test("the contract expresses authority as capability grants", () => {
    // The execution contract already carries writeScope, forbiddenPaths,
    // verification, egress and provenance. Under this invariant those become the
    // fields of a grant against a named capability, rather than a flat policy blob
    // whose relationship to any particular action is implicit.
    expectGap("inv5.contract-grants", () => {
      expect(existsSync(join(SRC, "capability/grant.ts"))).toBe(true)
    })
  })

  test("every execution path resolves authority through the same grant lookup", () => {
    // The point of the vocabulary. A native edit, a worker patch and a delegated
    // subagent action should all answer "am I permitted?" by resolving a grant,
    // not by consulting three different mechanisms.
    expectGap("inv5.grant-resolution", () => {
      expect(existsSync(join(SRC, "capability/resolve-grant.ts"))).toBe(true)
    })
  })
})
