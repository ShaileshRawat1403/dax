import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { mcpCapability } from "@/capability/dynamic-identity"
import { answerGrantAsk } from "@/capability/grant-ask"
import { GrantReview } from "@/capability/grant-review"
import * as ImplementationBinding from "@/capability/implementation-binding"
import { CapabilityActionDeniedError, recordActionResolution } from "@/capability/record-resolution"
import { Config } from "@/config/config"
import { computeCanonicalCommitment } from "@/execution/canonical-commitment"
import { ApprovalTransitions } from "@/approval/approval-transitions"
import { beginNativeInvocation, NativeAuthorizationDeniedError } from "@/execution/native-settlement"
import { createGrantReviewedRun } from "@/execution/run-factory"
import { Instance } from "@/project/instance"
import {
  appendEventOnly,
  recordAuthorization,
  recordToolInvocation,
  resolveApprovalEvent,
} from "@/state/events/event-transitions"
import { projectRunStateFromEvents, readRunEvents } from "@/state/events/run-event-store"

/**
 * Grant stage 4c: `ask` grants and the remembered "always".
 *
 * An ask names exactly what the operator approves: this grant, for this
 * capability, under this contract and binding. Nothing runs until the operator
 * answers; no answer in time denies. "Always" remembers that exact tuple and
 * nothing broader. Replay accepts an allowed authorization of an ask only with
 * that approval in the same log.
 */

let home: string
let directory: string
let previousHome: string | undefined
let previousTimeout: string | undefined

beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  previousTimeout = process.env.DAX_GRANT_ASK_TIMEOUT_MS
  process.env.DAX_GRANT_ASK_TIMEOUT_MS = "20000"
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "dax-grant-stage4c-ask-")))
  process.env.DAX_TEST_HOME = home
  directory = path.join(home, "project")
  await fs.mkdir(directory, { recursive: true })
  await fs.mkdir(path.join(home, ".config", "dax"), { recursive: true })
  expect(Bun.spawnSync(["git", "init", "--quiet", directory]).exitCode).toBe(0)
  await fs.writeFile(
    path.join(home, ".config", "dax", "dax.json"),
    JSON.stringify({ mcp: { gamma: { type: "remote", url: "http://127.0.0.1:9/reviewed", enabled: false } } }),
  )
  await Instance.disposeAll()
  Config.global.reset()
})
afterEach(async () => {
  await Instance.disposeAll()
  Config.global.reset()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  if (previousTimeout === undefined) delete process.env.DAX_GRANT_ASK_TIMEOUT_MS
  else process.env.DAX_GRANT_ASK_TIMEOUT_MS = previousTimeout
  await fs.rm(home, { recursive: true, force: true })
})

const within = <T>(fn: () => Promise<T>) => Instance.provide({ directory, fn })

function rejection(work: Promise<unknown>) {
  return work.then(
    () => undefined,
    (error: unknown) => error,
  )
}

async function subjectOf(runId: string, approvalId: string) {
  return (await readRunEvents(runId))
    .filter((event) => event.type === "approval_requested")
    .map((event) => event.payload as { approvalId: string; contractGrantSubject?: unknown })
    .find((payload) => payload.approvalId === approvalId)!.contractGrantSubject
}

type Options = NonNullable<Parameters<typeof createGrantReviewedRun>[1]>

/** Reviewed with the given operator choices, approved by name, published and activated. */
async function activated(options: Options, availableTools = ["read", "gamma_probe", "gamma_other"]) {
  const { runId, revision } = await createGrantReviewedRun(
    { request: { intent: { input: "Inspect the repository, read only." } }, availableTools },
    options,
  )
  await resolveApprovalEvent(runId, revision.approvalId, "approved", "operator")
  await GrantReview.publish(runId, {
    approvalId: revision.approvalId,
    subject: await subjectOf(runId, revision.approvalId),
  })
  await GrantReview.activate(runId)
  return runId
}

const askedRemote: Options = {
  acknowledgedExternal: ["mcp_source:tool:gamma"],
  sourceSelections: [{ server: "gamma", family: "tool" }],
  askSubjects: ["mcp_source:tool:gamma"],
}

let calls = 0
function invoke(runId: string, name = "probe") {
  const invocationId = `inv_ask_${++calls}`
  return {
    invocationId,
    done: beginNativeInvocation({
      sessionID: runId,
      invocationId,
      toolId: `gamma_${name}`,
      executor: { kind: "mcp", id: `gamma_${name}` },
      capability: mcpCapability(["mcp", "gamma", name]).descriptor,
      source: { server: "gamma", name },
      args: {},
    }),
  }
}

/** The grant ask raised for one correlated action, once it is in the log. */
async function askFor(runId: string, correlationId: string) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const found = (await projectRunStateFromEvents(runId))?.approvals.find(
      (item) => item.correlationId === correlationId && item.approvalType === "capability_grant_ask",
    )
    if (found) return found
    await Bun.sleep(10)
  }
  throw new Error(`no grant ask for ${correlationId}`)
}

const askApprovals = async (runId: string) =>
  ((await projectRunStateFromEvents(runId))?.approvals ?? []).filter(
    (item) => item.approvalType === "capability_grant_ask",
  )

const allowed = {
  finalDisposition: "allowed" as const,
  contractDisposition: "allowed" as const,
  runtimeGuardDisposition: "allowed" as const,
  permissionDisposition: "allowed" as const,
  approvalIds: [],
  reasonCodes: [],
}

describe("an ask grant waits for the operator and grants exactly what was asked", () => {
  test("approved: the invocation proceeds, and replay allows its authorization only with that approval", async () => {
    await within(async () => {
      const runId = await activated(askedRemote)
      const { invocationId, done } = invoke(runId)
      const ask = await askFor(runId, invocationId)
      expect((await projectRunStateFromEvents(runId))!.grantReview.asks[ask.approvalId]).toMatchObject({
        grantSubject: "mcp_source:tool:gamma",
        capabilityId: mcpCapability(["mcp", "gamma", "probe"]).descriptor.id,
      })
      await answerGrantAsk(runId, ask.approvalId, { approve: true, actor: "operator" })
      expect(await done).toEqual({ status: "recorded" })
      const resolution = (await projectRunStateFromEvents(runId))!.capabilityResolutions.find(
        (item) => item.subjectId === invocationId,
      )
      expect(resolution).toMatchObject({
        enforcement: "enforced",
        decision: "ask",
        grantSubject: "mcp_source:tool:gamma",
      })
      await recordAuthorization(runId, invocationId, allowed)
      expect((await projectRunStateFromEvents(runId))!.invocations[invocationId]!.status).not.toBe("denied")
    })
  })

  test("denied or unanswered: nothing is authorized, and the ask is closed", async () => {
    await within(async () => {
      const runId = await activated(askedRemote)
      const first = invoke(runId)
      const ask = await askFor(runId, first.invocationId)
      await answerGrantAsk(runId, ask.approvalId, { approve: false, actor: "operator" })
      const denied = await rejection(first.done)
      expect(denied).toBeInstanceOf(NativeAuthorizationDeniedError)
      expect((denied as NativeAuthorizationDeniedError).reasonCode).toBe("grant_ask_denied")
      expect((await projectRunStateFromEvents(runId))!.invocations[first.invocationId]!.status).toBe("denied")

      process.env.DAX_GRANT_ASK_TIMEOUT_MS = "0"
      const second = invoke(runId)
      const expired = await rejection(second.done)
      expect((expired as NativeAuthorizationDeniedError).reasonCode).toBe("grant_ask_expired")
      expect((await askFor(runId, second.invocationId)).status).toBe("expired")
    })
  })

  test("always remembers exactly the asked tuple: the same capability proceeds, another still asks", async () => {
    await within(async () => {
      const runId = await activated(askedRemote)
      const first = invoke(runId)
      const ask = await askFor(runId, first.invocationId)
      await answerGrantAsk(runId, ask.approvalId, { approve: true, actor: "operator", always: true })
      await first.done
      expect(Object.keys((await projectRunStateFromEvents(runId))!.grantReview.remembered)).toEqual([ask.approvalId])

      const again = invoke(runId)
      expect(await again.done).toEqual({ status: "recorded" })
      const resolution = (await projectRunStateFromEvents(runId))!.capabilityResolutions.find(
        (item) => item.subjectId === again.invocationId,
      )
      expect(resolution?.askSatisfiedBy).toEqual({ approvalId: ask.approvalId, remembered: true })
      expect(await askApprovals(runId)).toHaveLength(1)
      await recordAuthorization(runId, again.invocationId, allowed)

      // Another capability under the same source grant is a different tuple.
      const other = invoke(runId, "other")
      const second = await askFor(runId, other.invocationId)
      expect(second.approvalId).not.toBe(ask.approvalId)
      await answerGrantAsk(runId, second.approvalId, { approve: false, actor: "operator" })
      expect(await rejection(other.done)).toBeInstanceOf(NativeAuthorizationDeniedError)
    })
  })
})

describe("replay accepts no ask, approval or memory that does not follow from this log", () => {
  test("forged asks, memories and authorizations are refused and the journal is unchanged", async () => {
    await within(async () => {
      const runId = await activated(askedRemote)
      const pendingAsk = invoke(runId)
      // Observed from the start, so its denial is never an unhandled rejection.
      const outcome = rejection(pendingAsk.done)
      const ask = await askFor(runId, pendingAsk.invocationId)
      const subject = (await projectRunStateFromEvents(runId))!.grantReview.asks[ask.approvalId]!
      const refused = async (work: () => Promise<unknown>) => {
        const before = (await readRunEvents(runId)).length
        const error = await rejection(work())
        expect((await readRunEvents(runId)).length).toBe(before)
        return error instanceof Error
      }
      // Nothing may be remembered before the operator approved it.
      expect(
        await refused(() => appendEventOnly(runId, "grant_ask_remembered", { approvalId: ask.approvalId, subject })),
      ).toBe(true)
      // An authorization cannot allow an ask nobody approved.
      expect(await refused(() => recordAuthorization(runId, pendingAsk.invocationId, allowed))).toBe(true)
      // An ask for a binding the activation did not verify.
      expect(
        await refused(() =>
          appendEventOnly(
            runId,
            "approval_requested",
            {
              approvalId: "apr_forged_ask",
              approvalType: "capability_grant_ask",
              risk: "high",
              grantAskSubject: { ...subject, bindingDigest: `sha256:${"0".repeat(64)}` },
            },
            "cmd_forged_ask",
            { correlationId: pendingAsk.invocationId },
          ),
        ),
      ).toBe(true)
      // Anonymous approval cannot be remembered, nor a different tuple.
      await ApprovalTransitions.approve(runId, ask.approvalId, undefined)
      // An approval nobody put their name to does not let the invocation run.
      const unnamed = await outcome
      expect(unnamed).toBeInstanceOf(NativeAuthorizationDeniedError)
      expect((unnamed as NativeAuthorizationDeniedError).reasonCode).toBe("grant_ask_denied")
      expect(
        await refused(() => appendEventOnly(runId, "grant_ask_remembered", { approvalId: ask.approvalId, subject })),
      ).toBe(true)
    })
  })

  test("a resolution cannot claim an approval or memory it does not have", async () => {
    await within(async () => {
      const runId = await activated(askedRemote)
      const first = invoke(runId)
      const ask = await askFor(runId, first.invocationId)
      await answerGrantAsk(runId, ask.approvalId, { approve: true, actor: "operator", always: true })
      await first.done
      const state = (await projectRunStateFromEvents(runId))!
      const activation = state.grantReview.activated!
      const forged = (capabilityId: string, askSatisfiedBy?: { approvalId: string; remembered: boolean }) => ({
        subjectId: "op_forged",
        enforcement: "enforced",
        activation: { revision: activation.revision, contractDigest: activation.contractDigest },
        path: "mcp_resource",
        initiator: "operator",
        capabilityId,
        enrolled: true,
        basis: "v2_grant",
        contractId: state.contractId,
        decision: "ask",
        grantScope: "run",
        grantSubject: "mcp_source:tool:gamma",
        source: {
          server: "gamma",
          name: capabilityId === mcpCapability(["mcp", "gamma", "other"]).descriptor.id ? "other" : "probe",
        },
        ...(askSatisfiedBy ? { askSatisfiedBy } : {}),
      })
      const before = (await readRunEvents(runId)).length
      for (const payload of [
        // Remembered for probe, claimed for other.
        forged(mcpCapability(["mcp", "gamma", "other"]).descriptor.id, {
          approvalId: ask.approvalId,
          remembered: true,
        }),
        // An approval that is not remembered, claimed as memory.
        forged(mcpCapability(["mcp", "gamma", "probe"]).descriptor.id, { approvalId: "apr_none", remembered: true }),
        // An action's ask recorded without anything that satisfied it.
        forged(mcpCapability(["mcp", "gamma", "probe"]).descriptor.id),
        // The approval of another action, claimed for this one.
        forged(mcpCapability(["mcp", "gamma", "probe"]).descriptor.id, {
          approvalId: ask.approvalId,
          remembered: false,
        }),
      ]) {
        expect(
          await rejection(
            appendEventOnly(runId, "capability_resolution_recorded", payload as never, `cmd_${Math.random()}`, {
              correlationId: "op_forged",
            }),
          ),
        ).toBeInstanceOf(Error)
      }
      expect((await readRunEvents(runId)).length).toBe(before)
    })
  })
})

describe("an ask cannot be bypassed, outlived or answered too late", () => {
  test("an ask grant can never be recorded as an allow", async () => {
    await within(async () => {
      const runId = await activated(askedRemote)
      const state = (await projectRunStateFromEvents(runId))!
      expect(state.grantReview.activated!.bindings.map((item) => item.decision)).toEqual(["ask"])
      const invocationId = "inv_ask_as_allow"
      await recordToolInvocation(runId, invocationId, {
        toolId: "gamma_probe",
        executor: { kind: "mcp", id: "gamma_probe" },
        contractId: state.contractId,
        input: { basis: "validated_tool_input", ...(await computeCanonicalCommitment({})) },
      })
      const before = (await readRunEvents(runId)).length
      const error = await rejection(
        appendEventOnly(
          runId,
          "capability_resolution_recorded",
          {
            subjectId: invocationId,
            enforcement: "enforced",
            activation: {
              revision: state.grantReview.activated!.revision,
              contractDigest: state.grantReview.activated!.contractDigest,
            },
            path: "mcp_tool",
            initiator: "model",
            capabilityId: mcpCapability(["mcp", "gamma", "probe"]).descriptor.id,
            enrolled: true,
            basis: "v2_grant",
            contractId: state.contractId,
            decision: "allow",
            grantScope: "run",
            grantSubject: "mcp_source:tool:gamma",
            source: { server: "gamma", name: "probe" },
          },
          "cmd_ask_as_allow",
          { correlationId: invocationId },
        ),
      )
      expect(error).toBeInstanceOf(Error)
      expect(await rejection(recordAuthorization(runId, invocationId, allowed))).toBeInstanceOf(Error)
      expect((await readRunEvents(runId)).length).toBe(before)
    })
  })

  test("a binding that changes while the operator decides denies the approved invocation", async () => {
    await within(async () => {
      const runId = await activated(askedRemote)
      const originalGet = Config.get
      let changed = false
      const get = spyOn(Config, "get").mockImplementation(async () => {
        const current = await originalGet()
        return changed
          ? {
              ...current,
              mcp: {
                ...current.mcp,
                gamma: { type: "remote" as const, url: "http://127.0.0.1:9/replacement", enabled: false },
              },
            }
          : current
      })
      try {
        const first = invoke(runId)
        const outcome = rejection(first.done)
        const ask = await askFor(runId, first.invocationId)
        changed = true
        await answerGrantAsk(runId, ask.approvalId, { approve: true, actor: "operator" })
        const error = await outcome
        expect(error).toBeInstanceOf(NativeAuthorizationDeniedError)
        expect((error as NativeAuthorizationDeniedError).reasonCode).toBe("binding_changed")
        expect((await projectRunStateFromEvents(runId))!.invocations[first.invocationId]!.status).toBe("denied")
      } finally {
        get.mockRestore()
      }
    })
  })

  test("a timed-out ask is denied durably, and no late approval can authorize it", async () => {
    await within(async () => {
      const runId = await activated(askedRemote)
      process.env.DAX_GRANT_ASK_TIMEOUT_MS = "0"
      // A named answer races in while closing the ask fails.
      const expire = spyOn(ApprovalTransitions, "expire").mockImplementation(async (id: string, approvalId: string) => {
        await rejection(ApprovalTransitions.approve(id, approvalId, "operator"))
        throw new Error("injected expiry failure")
      })
      try {
        const first = invoke(runId)
        const error = await rejection(first.done)
        expect((error as NativeAuthorizationDeniedError).reasonCode).toBe("grant_ask_expired")
        const state = (await projectRunStateFromEvents(runId))!
        expect(state.invocations[first.invocationId]!.status).toBe("denied")
        // The late approval was refused on its own: it came after the deadline.
        const ask = state.approvals.find((item) => item.correlationId === first.invocationId)!
        expect(ask.status).toBe("pending")
        const before = (await readRunEvents(runId)).length
        expect(await rejection(recordAuthorization(runId, first.invocationId, allowed))).toBeInstanceOf(Error)
        expect(await rejection(resolveApprovalEvent(runId, ask.approvalId, "approved", "operator"))).toBeInstanceOf(
          Error,
        )
        expect((await readRunEvents(runId)).length).toBe(before)
      } finally {
        expire.mockRestore()
      }
    })
  })
})

describe("an action's ask is settled before the action, and recorded with what settled it", () => {
  // A source run binds no session capability. These tests substitute a compiled
  // identity to isolate the ask flow on an action path; they are not compiled
  // acceptance, which the compiled probes in stage 4b and 4c cover.
  test("approved, denied and remembered asks on a template reference", async () => {
    const compiled = spyOn(ImplementationBinding, "daxExecutable").mockReturnValue({
      form: "compiled",
      commit: "probe",
      runtime: Bun.revision,
      bundle: `sha256:${"b".repeat(64)}`,
    })
    try {
      await within(async () => {
        const runId = await activated(
          { writeScope: { roots: ["."], reviewed: true }, askSubjects: ["session.context.template.stat"] },
          ["read"],
        )
        const action = {
          governedBy: { sessionID: runId },
          subject: "template_reference",
          path: "template_reference" as const,
          initiator: "operator" as const,
          executor: {
            kind: "builtin" as const,
            descriptor: {
              id: "session.context.template.stat",
              riskClass: "low",
              scopeSupport: "filesystem",
              requiresVerification: false,
            },
          },
          target: { paths: [path.join(directory, "README.md")] },
        }
        const answerNext = (answer: { approve: boolean; always?: boolean }) =>
          (async () => {
            for (let attempt = 0; attempt < 400; attempt++) {
              const pendingAsk = (await askApprovals(runId)).find((item) => item.status === "pending")
              if (pendingAsk) return answerGrantAsk(runId, pendingAsk.approvalId, { ...answer, actor: "operator" })
              await Bun.sleep(10)
            }
          })()

        const [approvedResult] = await Promise.all([recordActionResolution(action), answerNext({ approve: true })])
        expect(approvedResult).toMatchObject({ decision: "ask", askSatisfiedBy: { remembered: false } })

        const [deniedResult] = await Promise.all([
          rejection(recordActionResolution(action)),
          answerNext({ approve: false }),
        ])
        expect(deniedResult).toBeInstanceOf(CapabilityActionDeniedError)
        expect((deniedResult as CapabilityActionDeniedError).reasonCode).toBe("grant_ask_denied")

        // A running image that changes while the operator decides denies the action.
        const [staleResult] = await Promise.all([
          rejection(recordActionResolution(action)),
          (async () => {
            for (let attempt = 0; attempt < 400; attempt++) {
              const pendingAsk = (await askApprovals(runId)).find((item) => item.status === "pending")
              if (pendingAsk) {
                compiled.mockReturnValue({
                  form: "compiled",
                  commit: "probe",
                  runtime: Bun.revision,
                  bundle: `sha256:${"9".repeat(64)}`,
                })
                await answerGrantAsk(runId, pendingAsk.approvalId, { approve: true, actor: "operator" })
                return
              }
              await Bun.sleep(10)
            }
          })(),
        ])
        expect(staleResult).toBeInstanceOf(CapabilityActionDeniedError)
        expect((staleResult as CapabilityActionDeniedError).reasonCode).toBe("binding_changed")
        compiled.mockReturnValue({
          form: "compiled",
          commit: "probe",
          runtime: Bun.revision,
          bundle: `sha256:${"b".repeat(64)}`,
        })

        await Promise.all([recordActionResolution(action), answerNext({ approve: true, always: true })])
        const asksBefore = (await askApprovals(runId)).length
        const remembered = await recordActionResolution(action)
        expect(remembered).toMatchObject({ decision: "ask", askSatisfiedBy: { remembered: true } })
        expect((await askApprovals(runId)).length).toBe(asksBefore)
      })
    } finally {
      compiled.mockRestore()
    }
  })
})
