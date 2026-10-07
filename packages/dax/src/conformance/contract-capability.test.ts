import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { nativeCapabilities, createCapabilityRegistry } from "@/capability/registry"
import { CapabilityDescriptor } from "@/capability/capability-types"
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import { Instance } from "@/project/instance"
import { tmpdir } from "node:os"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import z from "zod"
import { resolveCapabilityAuthority } from "@/capability/authority"
import { CapabilityCatalog } from "@/capability/catalog"
import { compileWithRunId } from "@/execution/compiler"
import { ExecutionContract, ExecutionContractV2 } from "@/execution/execution-contract"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"
import type { Operator } from "@/operators/base"
import { OperatorRouter, defaultRouter } from "@/operators/router"
import type { PlannedTask } from "@/planner/task-graph"
import {
  ExternalWorkerId,
  requireBuiltinWorkerInvocationCapability,
  requireBuiltinWorkerProfileCapability,
  type WorkerInvocation,
} from "@/worker/worker-adapter"
import { requireFixedWorkflowCapability } from "@/workflows/capability-identity"
import { WorkflowRegistry } from "@/workflows/registry"

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
 * The initial v1.3.0 specification was structural. Every DAX-dispatched family
 * now resolves through one composed vocabulary, checked below against the
 * production resolvers. Caller registrations now carry conservative logical descriptors. The ledger
 * remains a candidate until comprehensive validation and integration; these
 * descriptors establish neither implementation attestation nor authority.
 */

function plannedTask(type: string, action?: string): PlannedTask {
  return {
    id: "first",
    name: "First",
    description: "Controlled graph dispatch",
    operator_type: type,
    status: "pending",
    dependencies: [],
    context: action === undefined ? {} : { action },
  }
}

async function withInstance(fn: () => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "dax-capability-gap-"))
  const previousHome = process.env.DAX_TEST_HOME
  process.env.DAX_TEST_HOME = directory
  await mkdir(join(directory, ".config", "dax"), { recursive: true })
  try {
    await Instance.provide({ directory, fn })
  } finally {
    await Instance.disposeAll()
    if (previousHome === undefined) delete process.env.DAX_TEST_HOME
    else process.env.DAX_TEST_HOME = previousHome
    await rm(directory, { recursive: true, force: true })
  }
}

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

  test("every DAX-dispatched family resolves its production executor inside one composed vocabulary", async () => {
    await withInstance(async () => {
      const tools = await ToolRegistry.tools({ providerID: "", modelID: "" })
      const vocabulary = await CapabilityCatalog.snapshot()

      // Native model tools, through the registry production dispatch uses.
      const native = tools.map((item) => ToolRegistry.executionIdentity(item)).filter((item) => item.kind === "builtin")
      expect(native.length).toBeGreaterThan(10)
      for (const identity of native) {
        expect(vocabulary.require(identity.capability!.id)).toEqual(identity.capability!)
        expect(vocabulary.familyOf(identity.capability!.id)).toBe("native_tool")
      }

      // Built-in graph operators, through the router runGraph dispatches with.
      for (const [type, action] of [
        ["explore", undefined],
        ["git", "status"],
        ["git", "commit"],
        ["verify", undefined],
        ["release", undefined],
        ["artifact", undefined],
      ] as const) {
        const task = plannedTask(type, action)
        const execution = defaultRouter.execution(task, await defaultRouter.route(task))
        expect(vocabulary.require(execution.capability!.id)).toEqual(execution.capability!)
        expect(vocabulary.familyOf(execution.capability!.id)).toBe("operator")
      }

      // Fixed workflows the run factory can construct, and built-in worker profiles.
      for (const workflowClass of WorkflowRegistry.list()) {
        expect(vocabulary.require(`workflow.${workflowClass}.execute`).scopeSupport).toBe("opaque")
      }
      for (const workerId of ExternalWorkerId.options) {
        const descriptor = requireBuiltinWorkerProfileCapability(workerId)
        expect(vocabulary.require(descriptor.id)).toEqual(descriptor)
      }

      // Command, operator-shell, context and verification dispatch. Their real
      // dispatch controls live beside each executor; here they must be one vocabulary.
      for (const id of [
        "session.command.shell",
        "session.shell.operator",
        "session.context.attachment.read",
        "session.context.template.stat",
        "verification.command.direct",
        "verification.command.sandboxed",
      ]) {
        expect(CapabilityDescriptor.safeParse(vocabulary.require(id)).success).toBe(true)
      }
    })
  })

  test("unmapped identities are rejected at the enrolled dispatch boundaries", async () => {
    await withInstance(async () => {
      const vocabulary = await CapabilityCatalog.snapshot()
      expect(() => vocabulary.require("native.tool.not_real")).toThrow("Unknown capability")
      expect(vocabulary.covers("operator.git.rebase")).toBe(false)

      // A forged or copied tool object has no binding at native dispatch.
      const [read] = (await ToolRegistry.tools({ providerID: "", modelID: "" })).filter((item) => item.id === "read")
      expect(() => ToolRegistry.executionIdentity({ ...read })).toThrow(CapabilityIdentityError)

      // An unknown graph operator type has no executor; an unknown Git action has no identity.
      const unknown = plannedTask("deploy")
      let unrouted: unknown
      await defaultRouter.route(unknown).catch((error) => {
        unrouted = error
      })
      expect(unrouted).toHaveProperty("message", "No operator found for type: deploy")
      const rebase = plannedTask("git", "rebase")
      expect(() => defaultRouter.execution(rebase, defaultRouter.getOperator("git")!)).toThrow(CapabilityIdentityError)

      // A worker invocation the default adapter did not build has no identity.
      expect(() =>
        requireBuiltinWorkerInvocationCapability({ providerId: "claude" } as unknown as WorkerInvocation),
      ).toThrow(CapabilityIdentityError)

      // A fixed workflow cannot claim another class's contract.
      expect(() =>
        requireFixedWorkflowCapability({
          workflowClass: "repo_analyze",
          phase: "execute",
          contract: { workflowClass: "worker_run", runId: "run_a" } as unknown as ExecutionContract,
          runId: "run_a",
        }),
      ).toThrow(CapabilityIdentityError)
    })
  })

  test("legacy executors have conservative validated descriptors in the composed vocabulary", async () => {
    await withInstance(async () => {
      // Descriptive registration identity preserves the API and adds no grant.
      // This is not origin or implementation attestation.
      await ToolRegistry.register(
        Tool.define("capability-gap-probe", {
          description: "Unenrolled legacy executor",
          parameters: z.object({}),
          result: Tool.result(z.object({})),
          async execute() {
            return { title: "probe", output: "probe", metadata: {} }
          },
        }),
      )
      const tools = await ToolRegistry.tools({ providerID: "", modelID: "" })
      const legacyTool = ToolRegistry.executionIdentity(tools.find((item) => item.id === "capability-gap-probe")!)
      expect(legacyTool.kind).toBe("plugin")
      expect(typeof legacyTool.execute).toBe("function")

      const router = new OperatorRouter()
      const operator: Operator = { type: "custom", execute: async () => ({ success: true }) as never }
      router.register(operator)
      const legacyOperator = router.execution(plannedTask("custom"), operator)
      expect(typeof legacyOperator.execute).toBe("function")

      const vocabulary = await CapabilityCatalog.snapshot()
      for (const identity of [legacyTool, legacyOperator]) {
        expect(identity.capability?.id).toBeDefined()
        expect(vocabulary.covers(identity.capability!.id)).toBe(true)
      }
      for (const identity of [legacyTool, legacyOperator]) {
        expect(CapabilityDescriptor.safeParse(identity.capability).success).toBe(true)
        expect(identity.capability).toMatchObject({
          riskClass: "high",
          scopeSupport: "opaque",
          requiresVerification: true,
        })
        expect(Object.isFrozen(identity.capability)).toBe(true)
      }
    })
  })

  test("legacy compilation stays v1 rather than inventing reviewed grants", () => {
    // V1 remains an explicit compatibility path. Reviewed creation/approval,
    // published V2 grants and actual enforced dispatch are checked against the
    // compiled production producer in grant-stage4d.test.ts.
    const { contract } = compileWithRunId({ request: { intent: { input: "Edit one file." } } }, "ses_gap_probe")
    expect(ExecutionContract.safeParse(contract).success).toBe(true)
    expect(ExecutionContractV2.safeParse(contract).success).toBe(false)
    expect((contract as { capabilityGrants?: unknown[] }).capabilityGrants).toBeUndefined()
  })

  test("legacy shared lookup explicitly reports record-only compatibility", () => {
    // Intentionally retained compatibility is not evidence that reviewed
    // production dispatch lacks grant enforcement. The producer matrix covers
    // actual allows, durable denials, barriers and source-build refusals.
    const { contract } = compileWithRunId({ request: { intent: { input: "Edit one file." } } }, "ses_gap_probe")
    const resolution = resolveCapabilityAuthority({
      path: "native_tool",
      initiator: "model",
      contract,
      authorityRunId: "ses_gap_probe",
      executor: { kind: "builtin", alias: "read", descriptor: nativeCapabilities.require("native.tool.read") },
      directory: "/repo",
      worktree: "/repo",
    })
    expect(resolution).toMatchObject({ capabilityId: "native.tool.read", decision: "allow" })
    expect(resolution.basis).toBe("v1_contract")
    expect(resolution.enforcement).toBe("record_only")
  })
})
