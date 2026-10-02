import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { mcpCapability } from "@/capability/dynamic-identity"
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
import { appendEventOnly, resolveApprovalEvent } from "@/state/events/event-transitions"
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

  test("the reducer refuses every proof that does not follow from this log", async () => {
    await within(async () => {
      const { runId, revision } = await reviewedRun()
      const digest = `sha256:${"a".repeat(64)}`
      const proof = {
        revision: 1,
        approvalId: revision.approvalId,
        approvedBy: "operator",
        proposalDigest: revision.digest,
        contractId: revision.proposal.candidate.contractId,
        contractDigest: digest,
        bindings: [],
      }
      const append = (type: "grant_review_published" | "grant_review_activated", payload: object) =>
        rejection(appendEventOnly(runId, type, payload as never))
      // Not yet approved, then approved by nobody named.
      expect(await append("grant_review_published", proof)).toBeInstanceOf(Error)
      await resolveApprovalEvent(runId, revision.approvalId, "approved", "operator")
      expect(await append("grant_review_published", { ...proof, approvedBy: "someone else" })).toBeInstanceOf(Error)
      expect(await append("grant_review_published", { ...proof, proposalDigest: digest })).toBeInstanceOf(Error)
      expect(await append("grant_review_published", { ...proof, revision: 2 })).toBeInstanceOf(Error)
      expect(await append("grant_review_published", { ...proof, approvalId: "apr_other" })).toBeInstanceOf(Error)
      expect(
        await append("grant_review_activated", { revision: 1, contractDigest: digest, bindings: [] }),
      ).toBeInstanceOf(Error)
      // An enforced resolution with no activation behind it.
      expect(
        await rejection(
          appendEventOnly(
            runId,
            "capability_resolution_recorded",
            {
              subjectId: "op_forged",
              enforcement: "enforced",
              activation: { revision: 1, contractDigest: digest },
              path: "operator_shell",
              initiator: "operator",
              capabilityId: "session.shell.operator",
              enrolled: true,
              basis: "v2_grant",
              contractId: revision.proposal.candidate.contractId,
              decision: "deny",
              reasonCode: "grant_absent",
            },
            "cmd_forged",
            { correlationId: "op_forged" },
          ),
        ),
      ).toBeInstanceOf(Error)

      // The genuine chain is accepted once, and nothing may repeat or diverge from it.
      expect(await append("grant_review_published", proof)).toBeUndefined()
      expect(await append("grant_review_published", proof)).toBeInstanceOf(Error)
      expect(
        await append("grant_review_activated", {
          revision: 1,
          contractDigest: `sha256:${"b".repeat(64)}`,
          bindings: [],
        }),
      ).toBeInstanceOf(Error)
      expect(
        await append("grant_review_activated", {
          revision: 1,
          contractDigest: digest,
          bindings: [{ subject: "native.tool.read", attestation: "exact", digest }],
        }),
      ).toBeInstanceOf(Error)
      expect(
        await append("grant_review_activated", { revision: 1, contractDigest: digest, bindings: [] }),
      ).toBeUndefined()
      expect(
        await append("grant_review_activated", { revision: 1, contractDigest: digest, bindings: [] }),
      ).toBeInstanceOf(Error)
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
