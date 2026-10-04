import { reviewedDecisionFixture } from "./reviewed-decision-fixture"
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { GrantReview } from "@/capability/grant-review"
import * as ImplementationBinding from "@/capability/implementation-binding"
import { nativeCapabilities } from "@/capability/registry"
import { Config } from "@/config/config"
import { computeCanonicalCommitment } from "@/execution/canonical-commitment"
import { beginNativeInvocation, NativeAuthorizationDeniedError } from "@/execution/native-settlement"
import { createGrantReviewedRun } from "@/execution/run-factory"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import {
  appendEventOnly,
  recordAuthorization,
  recordDelegation,
  recordToolInvocation,
  resolveApprovalEvent,
} from "@/state/events/event-transitions"
import { projectRunStateFromEvents, readRunEvents } from "@/state/events/run-event-store"

/**
 * Grant stage 4c, delegation: the task tool's grant names the agents a child
 * may be started as, chosen by the operator; nothing proposes one. The agents
 * are committed in the journal, an enforced resolution records the agent it
 * allowed, and the delegation record must start exactly that agent. A child
 * session dispatches under its parent's activated contract and can never hold
 * more than it.
 *
 * A source run binds no native capability. These tests substitute a compiled
 * identity to exercise the production paths; they are not compiled acceptance,
 * which the stage 4b and 4c compiled probes cover.
 */

let restoreDecisionFixture: (() => void) | undefined
let home: string
let directory: string
let previousHome: string | undefined
let compiled: ReturnType<typeof spyOn>

beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "dax-grant-stage4c-delegation-")))
  process.env.DAX_TEST_HOME = home
  directory = path.join(home, "project")
  await fs.mkdir(directory, { recursive: true })
  await fs.mkdir(path.join(home, ".config", "dax"), { recursive: true })
  expect(Bun.spawnSync(["git", "init", "--quiet", directory]).exitCode).toBe(0)
  compiled = spyOn(ImplementationBinding, "daxExecutable").mockReturnValue({
    form: "compiled",
    commit: "probe",
    runtime: Bun.revision,
    bundle: `sha256:${"b".repeat(64)}`,
  })
  await Instance.disposeAll()
  Config.global.reset()
})
afterEach(async () => {
  restoreDecisionFixture?.()
  restoreDecisionFixture = undefined
  compiled.mockRestore()
  await Instance.disposeAll()
  Config.global.reset()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
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

const delegations = [{ capabilityId: "native.tool.task", agents: ["explore"] }]

async function reviewed(options: NonNullable<Parameters<typeof createGrantReviewedRun>[1]> = { delegations }) {
  const created = await createGrantReviewedRun(
    { request: { intent: { input: "Inspect the repository, read only." } }, availableTools: ["read", "task"] },
    options,
  )
  return created
}

async function activated(options?: NonNullable<Parameters<typeof createGrantReviewedRun>[1]>) {
  const { runId, revision } = await reviewed(options)
  await resolveApprovalEvent(runId, revision.approvalId, "approved", "operator")
  await GrantReview.publish(runId, {
    approvalId: revision.approvalId,
    subject: await subjectOf(runId, revision.approvalId),
  })
  await GrantReview.activate(runId)
  restoreDecisionFixture = await reviewedDecisionFixture(runId)
  return runId
}

let calls = 0
function task(sessionID: string, subagent?: string) {
  const invocationId = `inv_task_${++calls}`
  return {
    invocationId,
    done: beginNativeInvocation({
      sessionID,
      invocationId,
      toolId: "task",
      executor: { kind: "builtin", id: "task" },
      capability: nativeCapabilities.require("native.tool.task"),
      args: subagent === undefined ? { prompt: "look" } : { prompt: "look", subagent_type: subagent },
    }),
  }
}

const reason = async (work: Promise<unknown>) => {
  const error = await rejection(work)
  expect(error).toBeInstanceOf(NativeAuthorizationDeniedError)
  return (error as NativeAuthorizationDeniedError).reasonCode
}

const allowed = {
  finalDisposition: "allowed" as const,
  contractDisposition: "allowed" as const,
  runtimeGuardDisposition: "allowed" as const,
  permissionDisposition: "allowed" as const,
  approvalIds: [],
  reasonCodes: [],
}

describe("delegation grants name their agents, chosen by the operator", () => {
  test("no agent is proposed; the operator's agents are granted and committed in the journal", async () => {
    await within(async () => {
      const bare = await reviewed({})
      expect(bare.revision.proposal.needsScope).toContainEqual({
        capabilityId: "native.tool.task",
        alias: "task",
        scopeSupport: "delegation",
      })
      expect(
        bare.revision.proposal.candidate.capabilityGrants.some(
          (grant) => grant.subject.kind === "capability" && grant.subject.capabilityId === "native.tool.task",
        ),
      ).toBe(false)

      const runId = await activated({
        delegations: [{ capabilityId: "native.tool.task", agents: ["explore", "explore"] }],
      })
      const activation = (await projectRunStateFromEvents(runId))!.grantReview.activated!
      expect(activation.bindings.find((item) => item.subject === "native.tool.task")).toMatchObject({
        decision: "allow",
        agents: ["explore"],
      })
    })
  })
})

describe("a task is allowed only for an approved agent, and the child is exactly that agent", () => {
  test("an approved agent is allowed and recorded; another agent or none is denied before anything starts", async () => {
    await within(async () => {
      const runId = await activated()
      const ok = task(runId, "explore")
      expect(await ok.done).toEqual({ status: "recorded" })
      const resolution = (await projectRunStateFromEvents(runId))!.capabilityResolutions.find(
        (item) => item.subjectId === ok.invocationId,
      )
      expect(resolution).toMatchObject({
        enforcement: "enforced",
        decision: "allow",
        grantSubject: "native.tool.task",
        grantScope: "delegation",
        delegatedAgent: "explore",
      })
      expect(await reason(task(runId, "general").done)).toBe("scope_outside")
      expect(await reason(task(runId).done)).toBe("scope_unproven")
    })
  })

  test("the delegation record must start the agent the decision allowed", async () => {
    await within(async () => {
      const runId = await activated()
      const ok = task(runId, "explore")
      await ok.done
      const state = await recordAuthorization(runId, ok.invocationId, allowed)
      const authorizationEventId = (state as { invocations?: Record<string, { authorizationEventId: string | null }> })
        .invocations![ok.invocationId]!.authorizationEventId!
      const parent = runId
      const before = (await readRunEvents(runId)).length
      const fallback = await rejection(
        recordDelegation(runId, ok.invocationId, authorizationEventId, {
          parentSessionId: parent,
          childSessionId: "ses_child_fallback",
          agent: "general",
          mode: "created",
        }),
      )
      expect(fallback).toBeInstanceOf(Error)
      expect((await readRunEvents(runId)).length).toBe(before)
      await recordDelegation(runId, ok.invocationId, authorizationEventId, {
        parentSessionId: parent,
        childSessionId: "ses_child_explore",
        agent: "explore",
        mode: "created",
      })
      expect((await projectRunStateFromEvents(runId))!.delegationHistory.records.map((item) => item.agent)).toEqual([
        "explore",
      ])
    })
  })

  test("a child session dispatches under its parent's activation and can never hold more", async () => {
    await within(async () => {
      const runId = await activated()
      const child = await Session.create({ parentID: runId, title: "child" })
      await Session.bindGoverningRun(child.id, runId)
      const activation = (await projectRunStateFromEvents(runId))!.grantReview.activated!
      expect(await reason(task(child.id, "general").done)).toBe("scope_outside")
      const fromChild = task(child.id, "explore")
      expect(await fromChild.done).toEqual({ status: "recorded" })
      const resolution = (await projectRunStateFromEvents(runId))!.capabilityResolutions.find(
        (item) => item.subjectId === fromChild.invocationId,
      )
      expect(resolution?.activation).toEqual({
        revision: activation.revision,
        contractDigest: activation.contractDigest,
      })
    })
  })
})

describe("replay refuses any delegation the journal does not prove", () => {
  test("an agent outside the grant, a missing agent, or altered agents are refused and the journal is unchanged", async () => {
    await within(async () => {
      const runId = await activated()
      const state = (await projectRunStateFromEvents(runId))!
      const activation = state.grantReview.activated!
      await recordToolInvocation(runId, "inv_forged_task", {
        toolId: "task",
        executor: { kind: "builtin", id: "task" },
        contractId: state.contractId,
        input: { basis: "validated_tool_input", ...(await computeCanonicalCommitment({})) },
      })
      const resolution = (delegatedAgent?: string) => ({
        subjectId: "inv_forged_task",
        enforcement: "enforced",
        activation: { revision: activation.revision, contractDigest: activation.contractDigest },
        path: "native_tool",
        initiator: "model",
        capabilityId: "native.tool.task",
        enrolled: true,
        basis: "v2_grant",
        contractId: state.contractId,
        decision: "allow",
        grantScope: "delegation",
        grantSubject: "native.tool.task",
        ...(delegatedAgent ? { delegatedAgent } : {}),
      })
      const before = (await readRunEvents(runId)).length
      for (const payload of [resolution("general"), resolution(undefined)]) {
        expect(
          await rejection(
            appendEventOnly(runId, "capability_resolution_recorded", payload as never, `cmd_${Math.random()}`, {
              correlationId: "inv_forged_task",
            }),
          ),
        ).toBeInstanceOf(Error)
      }
      expect((await readRunEvents(runId)).length).toBe(before)

      // A publication whose agents differ from what the operator approved.
      const pendingRun = await reviewed()
      const { runId: pendingId, revision } = pendingRun
      await resolveApprovalEvent(pendingId, revision.approvalId, "approved", "operator")
      const candidate = revision.proposal.candidate
      const bindings = revision.proposal.bindings.map(({ subject, attestation, digest }, index) => {
        const grant = candidate.capabilityGrants[index]!
        return {
          subject,
          attestation,
          digest,
          decision: grant.decision,
          ...(grant.scope.kind === "delegation" ? { agents: ["explore", "general"] } : {}),
        }
      })
      const pendingBefore = (await readRunEvents(pendingId)).length
      expect(
        await rejection(
          appendEventOnly(pendingId, "grant_review_published", {
            revision: revision.revision,
            approvalId: revision.approvalId,
            approvedBy: "operator",
            proposalDigest: revision.digest,
            contractId: candidate.contractId,
            contractDigest: (await computeCanonicalCommitment(candidate)).digest,
            bindings,
          }),
        ),
      ).toBeInstanceOf(Error)
      expect((await readRunEvents(pendingId)).length).toBe(pendingBefore)
    })
  })
})
