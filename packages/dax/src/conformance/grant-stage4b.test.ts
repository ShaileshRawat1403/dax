import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { mcpCapability } from "@/capability/dynamic-identity"
import { resolveCapabilityAuthority } from "@/capability/authority"
import { GrantReview, GrantReviewError } from "@/capability/grant-review"
import { nativeCapabilities } from "@/capability/registry"
import { Config } from "@/config/config"
import { compileWithRunId } from "@/execution/compiler"
import { readContract } from "@/execution/contract-guardian"
import { GrantReviewBarrierError } from "@/execution/grant-review-barrier"
import { beginNativeInvocation, NativeAuthorizationDeniedError } from "@/execution/native-settlement"
import { createGrantReviewedRun } from "@/execution/run-factory"
import { enforceRuntimeGuard } from "@/execution/runtime-guard"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import {
  appendEventOnly,
  recordAuthorization,
  recordToolInvocation,
  resolveApprovalEvent,
} from "@/state/events/event-transitions"
import { MCP_FAMILY_NAMESPACE } from "@/state/events/run-reducer"
import { MCP_TOOL_NAMESPACE } from "@/capability/dynamic-identity"
import { MCP_PROMPT_NAMESPACE, MCP_RESOURCE_NAMESPACE, mcpReadDescriptor } from "@/mcp/resource-identity"
import { computeCanonicalCommitment } from "@/execution/canonical-commitment"
import { bindingFacts } from "@/capability/grant-proposal"
import { captureReviewSnapshot } from "@/capability/grant-review-snapshot"
import { projectRunStateFromEvents, readRunEvents } from "@/state/events/run-event-store"
import { Storage } from "@/storage/storage"

/**
 * Grant stage 4b: the journal's publication and activation proof, and
 * enforcement on tool paths for an activated reviewed run.
 *
 * Within the boundary accepted for 4b, the only bindable families are the
 * compiled DAX running image and acknowledged remote MCP. A source run binds
 * no native capability, so native acceptance is proven by a compiled probe;
 * everything else here runs the production paths from source. The stage 3
 * barrier still stops every session entry point and the guardian.
 */

let home: string
let directory: string
let previousHome: string | undefined

async function configure(url = "http://127.0.0.1:9/reviewed") {
  await fs.writeFile(
    path.join(home, ".config", "dax", "dax.json"),
    JSON.stringify({ mcp: { gamma: { type: "remote", url, enabled: false } } }),
  )
}

beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "dax-grant-stage4b-")))
  process.env.DAX_TEST_HOME = home
  directory = path.join(home, "project")
  await fs.mkdir(directory, { recursive: true })
  await fs.mkdir(path.join(home, ".config", "dax"), { recursive: true })
  expect(Bun.spawnSync(["git", "init", "--quiet", directory]).exitCode).toBe(0)
  await configure()
  await Instance.disposeAll()
  Config.global.reset()
})
afterEach(async () => {
  await Instance.disposeAll()
  Config.global.reset()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await fs.rm(home, { recursive: true, force: true })
})

const within = <T>(fn: () => Promise<T>) => Instance.provide({ directory, fn })
async function restart() {
  await Instance.disposeAll()
  Config.global.reset()
}

const PROBE = "gamma_probe"
const probeDescriptor = () => mcpCapability(["mcp", "gamma", "probe"]).descriptor

/** A reviewed run whose operator selected and acknowledged the remote server's tools. */
async function reviewedRun(intent = "Inspect the repository, read only.") {
  return createGrantReviewedRun(
    { request: { intent: { input: intent } }, availableTools: ["read", PROBE] },
    {
      acknowledgedExternal: ["mcp_source:tool:gamma"],
      sourceSelections: [{ server: "gamma", family: "tool" }],
    },
  )
}

async function subjectOf(runId: string, approvalId: string) {
  const request = (await readRunEvents(runId))
    .filter((event) => event.type === "approval_requested")
    .map((event) => event.payload as { approvalId: string; contractGrantSubject?: unknown })
    .find((payload) => payload.approvalId === approvalId)
  return request!.contractGrantSubject
}

/** Reviewed, approved by a named operator, and published. */
async function published(intent?: string) {
  const { runId, revision } = await reviewedRun(intent)
  await resolveApprovalEvent(runId, revision.approvalId, "approved", "operator")
  await GrantReview.publish(runId, {
    approvalId: revision.approvalId,
    subject: await subjectOf(runId, revision.approvalId),
  })
  return { runId, revision }
}

function rejection(work: Promise<unknown>) {
  return work.then(
    () => undefined,
    (error: unknown) => error,
  )
}

async function refusal(work: Promise<unknown>) {
  const error = await rejection(work)
  expect(error).toBeInstanceOf(GrantReviewError)
  return (error as GrantReviewError).code
}

let calls = 0
function invoke(runId: string, toolId: string, capability: unknown, kind: "builtin" | "mcp" = "mcp") {
  return beginNativeInvocation({
    sessionID: runId,
    invocationId: `inv_stage4b_${++calls}`,
    toolId,
    executor: { kind, id: toolId },
    capability,
    ...(kind === "mcp" ? { source: { server: "gamma", name: "probe" } } : {}),
    args: {},
  })
}

const enforcedResolutions = async (runId: string) =>
  ((await projectRunStateFromEvents(runId))?.capabilityResolutions ?? []).filter(
    (item) => item.enforcement === "enforced",
  )

describe("the journal proves publication and activation by itself", () => {
  test("publication appends its proof, and replay reads it without the review store", async () => {
    let runId = ""
    await within(async () => {
      const created = await published()
      runId = created.runId
      const proof = (await projectRunStateFromEvents(runId))?.grantReview.published
      expect(proof).toMatchObject({
        revision: 1,
        approvalId: created.revision.approvalId,
        approvedBy: "operator",
        proposalDigest: created.revision.digest,
        contractId: created.revision.proposal.candidate.contractId,
        bindings: [
          {
            subject: "mcp_source:tool:gamma",
            attestation: "external",
            digest: created.revision.proposal.bindings[0]!.digest,
          },
        ],
      })
      expect((await GrantReview.readPublished(runId))?.contractDigest).toBe(proof!.contractDigest)
      await GrantReview.activate(runId)
    })
    await restart()
    await within(async () => {
      // Remove every stored artifact: the chain is still there, from the log alone.
      await Storage.remove(["grant_review", Instance.project.id, runId])
      await Storage.remove(["grant_review_published", Instance.project.id, runId])
      const state = await projectRunStateFromEvents(runId)
      expect(state?.grantReview.published?.revision).toBe(1)
      expect(state?.grantReview.activated?.contractDigest).toBe(state?.grantReview.published?.contractDigest)
      // Without the published artifact nothing can dispatch under it.
      expect(await GrantReview.dispatchAuthority(runId)).toBeUndefined()
    })
  })

  test("a stored artifact that differs from the journal's proof is never the published contract", async () => {
    await within(async () => {
      const { runId } = await published()
      await GrantReview.activate(runId)
      const key = ["grant_review_published", Instance.project.id, runId]
      const artifact = await Storage.read<{ contract: { intent: string }; contractDigest: string }>(key)
      // A rewritten contract with a digest that matches itself but not the journal.
      artifact.contract.intent = "Something the operator never approved."
      const { computeCanonicalCommitment } = await import("@/execution/canonical-commitment")
      artifact.contractDigest = (await computeCanonicalCommitment(artifact.contract)).digest
      await Storage.write(key, artifact)
      expect(await GrantReview.readPublished(runId)).toBeUndefined()
      expect(await GrantReview.dispatchAuthority(runId)).toBeUndefined()
      expect(await rejection(invoke(runId, PROBE, probeDescriptor()))).toBeInstanceOf(GrantReviewBarrierError)
    })
  })

  test("the reducer refuses every proof that does not follow from this log, and the journal is unchanged", async () => {
    await within(async () => {
      const { runId, revision } = await reviewedRun()
      const candidate = revision.proposal.candidate
      // The genuine proof: exactly what the approval committed to.
      const proof = {
        revision: revision.revision,
        approvalId: revision.approvalId,
        approvedBy: "operator",
        proposalDigest: revision.digest,
        contractId: candidate.contractId,
        contractDigest: (await computeCanonicalCommitment(candidate)).digest,
        bindings: revision.proposal.bindings.map(({ subject, attestation, digest }) => ({
          subject,
          attestation,
          digest,
        })),
      }
      expect(proof.bindings).toHaveLength(1)
      const other = `sha256:${"a".repeat(64)}`
      const refused = async (type: "grant_review_published" | "grant_review_activated", payload: object) => {
        const before = (await readRunEvents(runId)).length
        const error = await rejection(appendEventOnly(runId, type, payload as never))
        expect((await readRunEvents(runId)).length).toBe(before)
        return error instanceof Error
      }
      // Not yet approved.
      expect(await refused("grant_review_published", proof)).toBe(true)
      await resolveApprovalEvent(runId, revision.approvalId, "approved", "operator")
      expect(await refused("grant_review_published", { ...proof, approvedBy: "someone else" })).toBe(true)
      expect(await refused("grant_review_published", { ...proof, proposalDigest: other })).toBe(true)
      expect(await refused("grant_review_published", { ...proof, revision: 2 })).toBe(true)
      expect(await refused("grant_review_published", { ...proof, approvalId: "apr_other" })).toBe(true)
      // A substituted contract or binding set is not what the operator approved.
      expect(await refused("grant_review_published", { ...proof, contractDigest: other })).toBe(true)
      expect(await refused("grant_review_published", { ...proof, bindings: [] })).toBe(true)
      expect(
        await refused("grant_review_published", {
          ...proof,
          bindings: [...proof.bindings, { subject: "native.tool.read", attestation: "exact", digest: other }],
        }),
      ).toBe(true)
      expect(
        await refused("grant_review_published", {
          ...proof,
          bindings: [{ ...proof.bindings[0]!, digest: other }],
        }),
      ).toBe(true)
      expect(
        await refused("grant_review_activated", {
          revision: 1,
          contractDigest: proof.contractDigest,
          bindings: proof.bindings,
        }),
      ).toBe(true)

      // The genuine chain is accepted once, and nothing may repeat or diverge from it.
      expect(await rejection(appendEventOnly(runId, "grant_review_published", proof))).toBeUndefined()
      expect(await refused("grant_review_published", proof)).toBe(true)
      const activation = { revision: 1, contractDigest: proof.contractDigest, bindings: proof.bindings }
      expect(await refused("grant_review_activated", { ...activation, contractDigest: other })).toBe(true)
      expect(await refused("grant_review_activated", { ...activation, bindings: [] })).toBe(true)
      expect(await rejection(appendEventOnly(runId, "grant_review_activated", activation))).toBeUndefined()
      expect(await refused("grant_review_activated", activation)).toBe(true)
    })
  })

  test("a request made without the contract and binding commitment can never publish", async () => {
    await within(async () => {
      const { runId, revision } = await reviewedRun()
      // A legacy-shaped request on the same run: subject without the commitment.
      const legacy = { ...((await subjectOf(runId, revision.approvalId)) as object), revision: 2 } as Record<
        string,
        unknown
      >
      delete legacy.contractDigest
      delete legacy.bindings
      await appendEventOnly(runId, "approval_requested", {
        approvalId: "apr_legacy_shape",
        approvalType: "capability_grant_review",
        risk: "high",
        contractGrantSubject: legacy as never,
      })
      await resolveApprovalEvent(runId, "apr_legacy_shape", "approved", "operator")
      const before = (await readRunEvents(runId)).length
      const error = await rejection(
        appendEventOnly(runId, "grant_review_published", {
          revision: 2,
          approvalId: "apr_legacy_shape",
          approvedBy: "operator",
          proposalDigest: revision.digest,
          contractId: revision.proposal.candidate.contractId,
          contractDigest: (await computeCanonicalCommitment(revision.proposal.candidate)).digest,
          bindings: revision.proposal.bindings.map(({ subject, attestation, digest }) => ({
            subject,
            attestation,
            digest,
          })),
        }),
      )
      expect(error).toBeInstanceOf(Error)
      expect((await readRunEvents(runId)).length).toBe(before)
    })
  })

  test("the reducer's MCP family namespaces are the ones identities are minted under", () => {
    expect(MCP_FAMILY_NAMESPACE).toEqual({
      tool: MCP_TOOL_NAMESPACE,
      resource: MCP_RESOURCE_NAMESPACE,
      prompt: MCP_PROMPT_NAMESPACE,
    })
  })

  test("an interruption after the proof rolls forward; one before it never publishes", async () => {
    await within(async () => {
      // After the journal proof: the publication happened, and is completed later.
      const { runId, revision } = await reviewedRun()
      await resolveApprovalEvent(runId, revision.approvalId, "approved", "operator")
      const approval = { approvalId: revision.approvalId, subject: await subjectOf(runId, revision.approvalId) }
      const died = await rejection(
        GrantReview.publish(runId, approval, {
          afterProof: async () => {
            throw new Error("process died")
          },
        }),
      )
      expect((died as Error).message).toBe("process died")
      await Storage.remove(["grant_review_published", Instance.project.id, runId])
      expect(await refusal(GrantReview.revise(runId, revision.proposal))).toBe("review_published")
      expect((await GrantReview.get(runId))?.revisions.map((item) => item.status)).toEqual(["published"])
      expect((await GrantReview.readPublished(runId))?.revision).toBe(1)
      expect((await GrantReview.publish(runId, approval)).status).toBe("already_published")

      // Before the proof: no journal publication, so recovery abandons it.
      const second = await reviewedRun()
      await resolveApprovalEvent(second.runId, second.revision.approvalId, "approved", "operator")
      await rejection(
        GrantReview.publish(
          second.runId,
          {
            approvalId: second.revision.approvalId,
            subject: await subjectOf(second.runId, second.revision.approvalId),
          },
          {
            afterArtifact: async () => {
              throw new Error("process died")
            },
          },
        ),
      )
      expect((await projectRunStateFromEvents(second.runId))?.grantReview.published).toBeNull()
      expect((await GrantReview.revise(second.runId, second.revision.proposal)).revision).toBe(2)
      expect(await GrantReview.readPublished(second.runId)).toBeUndefined()
    })
  })
})

describe("activation is refused before any effect unless it can be honoured", () => {
  test("not before publication, not for unsupported paths, not with a changed binding, and only once", async () => {
    let runId = ""
    await within(async () => {
      const unpublished = await reviewedRun()
      expect(await refusal(GrantReview.activate(unpublished.runId))).toBe("not_published")

      // A mutating run owes verification, which no grant can provide yet.
      const mutating = await published("Fix the bug in the parser.")
      const before = (await readRunEvents(mutating.runId)).length
      expect(await refusal(GrantReview.activate(mutating.runId))).toBe("activation_unsupported")
      expect((await readRunEvents(mutating.runId)).length).toBe(before)

      runId = (await published()).runId
    })
    // The remote server now points somewhere the operator never reviewed.
    await configure("http://127.0.0.1:9/elsewhere")
    await restart()
    await within(async () => {
      expect(await refusal(GrantReview.activate(runId))).toBe("binding_changed")
      expect((await projectRunStateFromEvents(runId))?.grantReview.activated).toBeNull()
    })
    await configure()
    await restart()
    await within(async () => {
      await GrantReview.activate(runId)
      expect(await refusal(GrantReview.activate(runId))).toBe("already_activated")
      // Activation lifts nothing: every session entry point and the guardian still refuse.
      expect(await rejection(readContract(runId))).toBeInstanceOf(GrantReviewBarrierError)
      expect(
        await rejection(SessionPrompt.prompt({ sessionID: runId, parts: [{ type: "text", text: "go" }] })),
      ).toBeInstanceOf(GrantReviewBarrierError)
      expect((await projectRunStateFromEvents(runId))?.status).toBe("queued")
    })
  })
})

describe("the journal binds every enforced record to the activation, and every authorization to its decision", () => {
  async function activatedRun() {
    const { runId, revision } = await published()
    await GrantReview.activate(runId)
    return { runId, revision, activation: (await projectRunStateFromEvents(runId))!.grantReview.activated! }
  }
  async function invocation(runId: string, id: string, toolId: string, kind: "builtin" | "mcp", contractId: string) {
    await recordToolInvocation(runId, id, {
      toolId,
      executor: { kind, id: toolId },
      contractId,
      input: { basis: "validated_tool_input", ...(await computeCanonicalCommitment({})) },
    })
  }

  test("an enforced allow must name an activated grant that can cover its capability", async () => {
    await within(async () => {
      const { runId, revision, activation } = await activatedRun()
      const contractId = revision.proposal.candidate.contractId
      await invocation(runId, "inv_forged_allow", PROBE, "mcp", contractId)
      const allow = (grantSubject: string | undefined, capabilityId = probeDescriptor().id) => ({
        subjectId: "inv_forged_allow",
        enforcement: "enforced",
        activation: { revision: activation.revision, contractDigest: activation.contractDigest },
        path: "mcp_tool",
        initiator: "model",
        capabilityId,
        enrolled: true,
        basis: "v2_grant",
        contractId,
        decision: "allow",
        grantScope: "run",
        ...(grantSubject ? { grantSubject } : {}),
      })
      const before = (await readRunEvents(runId)).length
      for (const payload of [
        allow("native.tool.read"),
        allow(undefined),
        // Names this exact identity, which could cover it, but was never activated.
        allow(probeDescriptor().id),
        allow("mcp_source:resource:gamma"),
        allow("mcp_source:tool:gamma", "native.tool.read"),
        // A source grant without the source it was matched on proves nothing.
        allow("mcp_source:tool:gamma"),
      ]) {
        const error = await rejection(
          appendEventOnly(runId, "capability_resolution_recorded", payload as never, `cmd_${Math.random()}`, {
            correlationId: "inv_forged_allow",
          }),
        )
        expect(error).toBeInstanceOf(Error)
      }
      // A record-only resolution has no place in an activated run's tool paths.
      expect(
        await rejection(
          appendEventOnly(
            runId,
            "capability_resolution_recorded",
            {
              subjectId: "inv_forged_allow",
              enforcement: "record_only",
              path: "mcp_tool",
              initiator: "model",
              capabilityId: probeDescriptor().id,
              enrolled: true,
              basis: "v2_grant",
              contractId,
              decision: "allow",
              grantScope: "run",
            },
            "cmd_record_only",
            { correlationId: "inv_forged_allow" },
          ),
        ),
      ).toBeInstanceOf(Error)
      expect((await readRunEvents(runId)).length).toBe(before)
    })
  })

  test("a source grant covers only identities its own server mints, and resource or prompt sources cannot be proven", async () => {
    await within(async () => {
      const { runId, revision, activation } = await activatedRun()
      const contractId = revision.proposal.candidate.contractId
      const delta = mcpCapability(["mcp", "delta", "probe"]).descriptor
      // The lookup itself denies the cross-server identity.
      expect(
        resolveCapabilityAuthority({
          contract: revision.proposal.candidate,
          authorityRunId: runId,
          path: "mcp_tool",
          initiator: "model",
          executor: { kind: "mcp", alias: PROBE, descriptor: delta },
          source: { server: "delta", name: "probe" },
          directory: Instance.directory,
          worktree: Instance.worktree,
        }).decision,
      ).toBe("deny")
      await invocation(runId, "inv_cross_server", PROBE, "mcp", contractId)
      const forged = (
        capabilityId: string,
        source?: { server: string; name: string },
        grantSubject = "mcp_source:tool:gamma",
      ) => ({
        subjectId: "inv_cross_server",
        enforcement: "enforced",
        activation: { revision: activation.revision, contractDigest: activation.contractDigest },
        path: "mcp_tool",
        initiator: "model",
        capabilityId,
        enrolled: true,
        basis: "v2_grant",
        contractId,
        decision: "allow",
        grantScope: "run",
        grantSubject,
        ...(source ? { source } : {}),
      })
      const before = (await readRunEvents(runId)).length
      for (const payload of [
        // A delta identity under the gamma grant, with or without a claimed source.
        forged(delta.id),
        forged(delta.id, { server: "delta", name: "probe" }),
        forged(delta.id, { server: "gamma", name: "probe" }),
        // A gamma source claimed for an identity it does not mint.
        forged(probeDescriptor().id, { server: "gamma", name: "other" }),
      ]) {
        expect(
          await rejection(
            appendEventOnly(runId, "capability_resolution_recorded", payload as never, `cmd_${Math.random()}`, {
              correlationId: "inv_cross_server",
            }),
          ),
        ).toBeInstanceOf(Error)
      }
      expect((await readRunEvents(runId)).length).toBe(before)
      // With no enforced decision recorded, nothing can authorize it.
      expect(
        await rejection(
          recordAuthorization(runId, "inv_cross_server", {
            finalDisposition: "allowed",
            contractDisposition: "allowed",
            runtimeGuardDisposition: "allowed",
            permissionDisposition: "allowed",
            approvalIds: [],
            reasonCodes: [],
          }),
        ),
      ).toBeInstanceOf(Error)
      expect((await projectRunStateFromEvents(runId))!.invocations["inv_cross_server"]!.status).toBe(
        "awaiting_authorization",
      )
    })
  })

  test("a resource or prompt source grant cannot prove coverage on replay", async () => {
    await within(async () => {
      // A run whose operator selected and acknowledged the server's resources and prompts.
      const { runId, revision } = await createGrantReviewedRun(
        { request: { intent: { input: "Inspect the repository, read only." } }, availableTools: ["read"] },
        {
          acknowledgedExternal: ["mcp_source:resource:gamma", "mcp_source:prompt:gamma"],
          sourceSelections: [
            { server: "gamma", family: "resource" },
            { server: "gamma", family: "prompt" },
          ],
        },
      )
      await resolveApprovalEvent(runId, revision.approvalId, "approved", "operator")
      await GrantReview.publish(runId, {
        approvalId: revision.approvalId,
        subject: await subjectOf(runId, revision.approvalId),
      })
      await GrantReview.activate(runId)
      const activation = (await projectRunStateFromEvents(runId))!.grantReview.activated!
      expect(activation.bindings.map((item) => item.subject)).toEqual([
        "mcp_source:prompt:gamma",
        "mcp_source:resource:gamma",
      ])
      const before = (await readRunEvents(runId)).length
      for (const [family, path] of [
        ["resource", "mcp_resource"],
        ["prompt", "mcp_prompt"],
      ] as const) {
        const capabilityId = mcpReadDescriptor(family, "gamma", "item").id
        expect(
          await rejection(
            appendEventOnly(
              runId,
              "capability_resolution_recorded",
              {
                subjectId: `op_${family}`,
                enforcement: "enforced",
                activation: { revision: activation.revision, contractDigest: activation.contractDigest },
                path,
                initiator: "operator",
                capabilityId,
                enrolled: true,
                basis: "v2_grant",
                contractId: revision.proposal.candidate.contractId,
                decision: "allow",
                grantScope: "run",
                grantSubject: `mcp_source:${family}:gamma`,
              },
              `cmd_${family}`,
              { correlationId: `op_${family}` },
            ),
          ),
        ).toBeInstanceOf(Error)
      }
      expect((await readRunEvents(runId)).length).toBe(before)
    })
  })

  test("an authorization can neither reverse an enforced denial nor stand without an enforced decision", async () => {
    await within(async () => {
      const { runId, revision, activation } = await activatedRun()
      const contractId = revision.proposal.candidate.contractId
      await invocation(runId, "inv_denied", "read", "builtin", contractId)
      await appendEventOnly(
        runId,
        "capability_resolution_recorded",
        {
          subjectId: "inv_denied",
          enforcement: "enforced",
          activation: { revision: activation.revision, contractDigest: activation.contractDigest },
          path: "native_tool",
          initiator: "model",
          capabilityId: "native.tool.read",
          enrolled: true,
          basis: "v2_grant",
          contractId,
          decision: "deny",
          reasonCode: "grant_absent",
        },
        "cmd_denied",
        { correlationId: "inv_denied" },
      )
      await invocation(runId, "inv_undecided", "read", "builtin", contractId)
      const allowed = {
        finalDisposition: "allowed" as const,
        contractDisposition: "allowed" as const,
        runtimeGuardDisposition: "allowed" as const,
        permissionDisposition: "allowed" as const,
        approvalIds: [],
        reasonCodes: [],
      }
      const before = (await readRunEvents(runId)).length
      expect(await rejection(recordAuthorization(runId, "inv_denied", allowed))).toBeInstanceOf(Error)
      expect(await rejection(recordAuthorization(runId, "inv_undecided", allowed))).toBeInstanceOf(Error)
      expect((await readRunEvents(runId)).length).toBe(before)
      const state = await projectRunStateFromEvents(runId)
      expect(state!.invocations["inv_denied"]!.status).toBe("awaiting_authorization")
      // The denial itself is still recordable.
      await recordAuthorization(runId, "inv_denied", {
        ...allowed,
        finalDisposition: "denied",
        contractDisposition: "denied",
        reasonCodes: ["grant_absent"],
      })
      expect((await projectRunStateFromEvents(runId))!.invocations["inv_denied"]!.status).toBe("denied")
    })
  })

  test("a private record that disagrees with the journal is refused even when nothing else changed", async () => {
    await within(async () => {
      const { runId } = await published()
      const record = (await GrantReview.get(runId))!
      const binding = record.revisions[0]!.proposal.bindings[0]!
      record.revisions[0]!.proposal.bindings = [{ ...binding, digest: `sha256:${"f".repeat(64)}` }]
      await Storage.write(["grant_review", Instance.project.id, runId], record)
      const before = (await readRunEvents(runId)).length
      expect(await refusal(GrantReview.activate(runId))).toBe("binding_changed")
      expect((await readRunEvents(runId)).length).toBe(before)
    })
  })

  test("activation verifies the journal's bindings, and refuses a rewritten private record", async () => {
    let runId = ""
    let candidate: unknown
    await within(async () => {
      const created = await published()
      runId = created.runId
      candidate = created.revision.proposal.candidate
    })
    await configure("http://127.0.0.1:9/replacement")
    await restart()
    await within(async () => {
      // Rewrite the stored revision so its bindings describe the replacement.
      const current = await captureReviewSnapshot(candidate as never)
      const record = (await GrantReview.get(runId))!
      const subject = (candidate as { capabilityGrants: { subject: never }[] }).capabilityGrants[0]!.subject
      const facts = bindingFacts(current, subject)!
      const commitment = await computeCanonicalCommitment(facts.facts)
      const proven = (await projectRunStateFromEvents(runId))!.grantReview.published!.bindings[0]!
      expect(commitment.digest).not.toBe(proven.digest)
      record.revisions[0]!.proposal.bindings = [
        {
          subject: proven.subject,
          attestation: facts.attestation,
          canonicalization: "sorted-json-v1",
          digest: commitment.digest,
        },
      ]
      await Storage.write(["grant_review", Instance.project.id, runId], record)
      const before = (await readRunEvents(runId)).length
      expect(await refusal(GrantReview.activate(runId))).toBe("binding_changed")
      expect((await readRunEvents(runId)).length).toBe(before)
      expect((await projectRunStateFromEvents(runId))!.grantReview.activated).toBeNull()
    })
  })
})

describe("tool paths are enforced for an activated reviewed run", () => {
  async function activated() {
    const { runId } = await published()
    await GrantReview.activate(runId)
    return runId
  }

  test("a granted remote tool is allowed under its acknowledged source, and the barrier still guards execution", async () => {
    await within(async () => {
      const runId = await activated()
      expect(await invoke(runId, PROBE, probeDescriptor())).toEqual({ status: "recorded" })
      const [resolution] = await enforcedResolutions(runId)
      const activation = (await projectRunStateFromEvents(runId))!.grantReview.activated!
      expect(resolution).toMatchObject({
        enforcement: "enforced",
        decision: "allow",
        basis: "v2_grant",
        grantSubject: "mcp_source:tool:gamma",
        // The proven source, which replay re-mints to check the grant's server covers it.
        source: { server: "gamma", name: "probe" },
        activation: { revision: activation.revision, contractDigest: activation.contractDigest },
      })
      // A grant is necessary, not sufficient: the runtime guard still runs, and
      // until stage 4d it meets the barrier.
      expect(
        await rejection(
          enforceRuntimeGuard({
            sessionID: runId,
            agent: "build",
            toolID: PROBE,
            callID: "call_stage4b",
            req: { permission: PROBE, patterns: ["*"], always: ["*"], metadata: {} },
          }),
        ),
      ).toBeInstanceOf(GrantReviewBarrierError)
    })
  })

  test("no grant, an unlisted alias, an unenrolled executor and a source run's native tool are denied before any effect", async () => {
    await within(async () => {
      const runId = await activated()
      const denied = async (work: Promise<unknown>) => {
        const error = await rejection(work)
        expect(error).toBeInstanceOf(NativeAuthorizationDeniedError)
        return (error as NativeAuthorizationDeniedError).reasonCode
      }
      // A source run binds no native capability, so nothing grants `read`.
      expect(await denied(invoke(runId, "read", nativeCapabilities.require("native.tool.read"), "builtin"))).toBe(
        "grant_absent",
      )
      // The contract's own tool lists still bind every grant.
      expect(await denied(invoke(runId, "gamma_other", mcpCapability(["mcp", "gamma", "other"]).descriptor))).toBe(
        "contract_tool_denied",
      )
      expect(await denied(invoke(runId, PROBE, undefined))).toBe("capability_unenrolled")
      const state = await projectRunStateFromEvents(runId)
      const denials = Object.values(state!.invocations)
      expect(denials).toHaveLength(3)
      for (const invocation of denials) expect(invocation.status).toBe("denied")
      expect((await enforcedResolutions(runId)).map((item) => item.decision)).toEqual(["deny", "deny", "deny"])
    })
  })

  test("a binding changed after activation denies at dispatch; the run keeps its other grants", async () => {
    let runId = ""
    await within(async () => {
      runId = await activated()
    })
    await configure("http://127.0.0.1:9/elsewhere")
    await restart()
    await within(async () => {
      const error = await rejection(invoke(runId, PROBE, probeDescriptor()))
      expect(error).toBeInstanceOf(NativeAuthorizationDeniedError)
      expect((error as NativeAuthorizationDeniedError).reasonCode).toBe("binding_changed")
    })
    await configure()
    await restart()
    await within(async () => {
      expect(await invoke(runId, PROBE, probeDescriptor())).toEqual({ status: "recorded" })
    })
  })

  test("a reviewed run that is not activated still meets the barrier at dispatch", async () => {
    await within(async () => {
      const { runId } = await published()
      expect(await rejection(invoke(runId, PROBE, probeDescriptor()))).toBeInstanceOf(GrantReviewBarrierError)
      const child = await Session.create({ parentID: runId, title: "child" })
      await Session.bindGoverningRun(child.id, runId)
      expect(
        await rejection(
          beginNativeInvocation({
            sessionID: child.id,
            invocationId: "inv_child",
            toolId: PROBE,
            executor: { kind: "mcp", id: PROBE },
            capability: probeDescriptor(),
            source: { server: "gamma", name: "probe" },
            args: {},
          }),
        ),
      ).toBeInstanceOf(GrantReviewBarrierError)
    })
  })
})

describe("native grants are accepted only from a compiled running image", () => {
  test("a compiled probe binds and allows a native grant; another build's binding is a changed binding", async () => {
    const { contract } = compileWithRunId({ request: { intent: { input: "Inspect source." } } }, "ses_stage4b_probe")
    contract.toolAllowlist = []
    contract.toolBlocklist = []
    const contractFile = path.join(home, "contract.json")
    await fs.writeFile(contractFile, JSON.stringify(contract))
    const module = (name: string) => JSON.stringify(path.resolve(import.meta.dir, `../capability/${name}.ts`))
    const entry = path.join(home, "native-probe.ts")
    await fs.writeFile(
      entry,
      `
import { readFileSync } from "node:fs"
import { proposeGrants } from ${module("grant-proposal")}
import { decideReviewedAction } from ${module("enforcement")}
import { daxExecutable } from ${module("implementation-binding")}
import { nativeCapabilities } from ${module("registry")}
const contract = JSON.parse(readFileSync(process.argv[2], "utf8"))
const shell = nativeCapabilities.require("native.tool.shell")
const snapshot = { daxExecutable: daxExecutable(), tools: [{ family: "native", alias: "shell", descriptor: shell }], mcpServers: {}, session: [], workflow: [] }
const proposal = await proposeGrants({ runId: contract.runId, contract, snapshot, inputs: { toolAllowlist: [], toolBlocklist: [], workflowClass: contract.workflowClass } })
const activation = { revision: 1, contractDigest: "sha256:${"c".repeat(64)}", bindings: proposal.bindings.map(({ subject, attestation, digest }) => ({ subject, attestation, digest })) }
const decide = (current) => decideReviewedAction({
  contract: proposal.candidate,
  contractDigest: activation.contractDigest,
  activation,
  resolve: { path: "native_tool", initiator: "model", authorityRunId: contract.runId, executor: { kind: "builtin", alias: "shell", descriptor: shell }, directory: "/", worktree: "/" },
  current,
})
const allowed = await decide(snapshot)
const otherBuild = await decide({ ...snapshot, daxExecutable: { ...snapshot.daxExecutable, bundle: "sha256:${"e".repeat(64)}" } })
console.log(JSON.stringify({ executable: snapshot.daxExecutable.form, attestation: proposal.bindings[0]?.attestation, allowed, otherBuild }))
`,
    )
    const outfile = path.join(home, "native-probe")
    const build = Bun.spawn(
      [process.execPath, "build", "--compile", "--define", `DAX_BUILD_COMMIT="probe"`, entry, "--outfile", outfile],
      { stdout: "pipe", stderr: "pipe" },
    )
    const [built, , buildErr] = await Promise.all([
      build.exited,
      new Response(build.stdout).text(),
      new Response(build.stderr).text(),
    ])
    if (built !== 0) throw new Error(buildErr)
    const run = Bun.spawn([process.platform === "win32" ? `${outfile}.exe` : outfile, contractFile], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [code, out, err] = await Promise.all([
      run.exited,
      new Response(run.stdout).text(),
      new Response(run.stderr).text(),
    ])
    if (code !== 0) throw new Error(err)
    const result = JSON.parse(out.trim().split("\n").at(-1)!)
    expect(result.executable).toBe("compiled")
    expect(result.attestation).toBe("exact")
    expect(result.allowed).toMatchObject({
      enforcement: "enforced",
      decision: "allow",
      grantSubject: "native.tool.shell",
    })
    expect(result.otherBuild).toMatchObject({ decision: "deny", reasonCode: "binding_changed" })
  }, 120_000)
})
