import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { resolveCapabilityAuthority } from "@/capability/authority"
import { mcpCapability, pluginCapability } from "@/capability/dynamic-identity"
import { CapabilityGrants } from "@/capability/grant"
import {
  checkBinding,
  proposalDigest,
  proposeGrants,
  type ReviewCatalogSnapshot,
  type ReviewToolEntry,
} from "@/capability/grant-proposal"
import { GrantReview, GrantReviewError } from "@/capability/grant-review"
import { captureReviewSnapshot } from "@/capability/grant-review-snapshot"
import { nativeCapabilities } from "@/capability/registry"
import { Config } from "@/config/config"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian, readContract, resolveExecutionAuthority } from "@/execution/contract-guardian"
import { ExecutionContractV2, type ExecutionContract } from "@/execution/execution-contract"
import { GrantReviewBarrierError } from "@/execution/grant-review-barrier"
import { RunFactory, createGrantReviewedRun } from "@/execution/run-factory"
import { Instance } from "@/project/instance"
import { Provider } from "@/provider/provider"
import { Sandbox } from "@/shell/sandbox"
import { Session } from "@/session"
import { LLM } from "@/session/llm"
import { authorizeOperatorShell } from "@/session/operator-shell-authority"
import { SessionPrompt } from "@/session/prompt"
import { addApprovalEvent, appendEventOnly, resolveApprovalEvent } from "@/state/events/event-transitions"
import { projectRunStateFromEvents, readRunEvents } from "@/state/events/run-event-store"
import { Storage } from "@/storage/storage"

/**
 * Grant stage 3: operator review of a run's capability grants.
 *
 * A proposal is data derived from recorded inputs, bound to the implementations
 * it names. A run under review has no executable contract and does nothing,
 * whatever the review's state. An approval publishes only the exact revision
 * the operator saw. Grant enforcement is stage 4 and is not here.
 */

const RUN = "ses_grant_stage3_proposal"
const native = (alias: string) => nativeCapabilities.require(`native.tool.${alias}`)
const nativeEntry = (alias: string): ReviewToolEntry => ({ family: "native", alias, descriptor: native(alias) })

function contract(configure?: (contract: ExecutionContract) => void, runId = RUN) {
  const { contract } = compileWithRunId({ request: { intent: { input: "Inspect source." } } }, runId)
  contract.toolAllowlist = []
  contract.toolBlocklist = []
  configure?.(contract)
  return contract
}

function pluginEntry(
  alias: string,
  file: string,
  metadata = "m1",
  entryContent: string | null = "sha256:a",
): ReviewToolEntry {
  const { descriptor, source } = pluginCapability(["directory", file, "default"])
  return { family: "plugin", alias, descriptor, source, metadata, entryContent }
}

function mcpEntry(server: string, name: string, definition = "d1"): ReviewToolEntry {
  return {
    family: "mcp_tool",
    alias: `${server}_${name}`,
    descriptor: mcpCapability(["mcp", server, name]).descriptor,
    server,
    name,
    definition,
  }
}

type MutableSnapshot = ReviewCatalogSnapshot & {
  tools: ReviewToolEntry[]
  mcpServers: Record<string, ReviewCatalogSnapshot["mcpServers"][string]>
}

function snapshot(change?: (snapshot: MutableSnapshot) => void): ReviewCatalogSnapshot {
  const value: MutableSnapshot = {
    daxVersion: "test",
    tools: [
      nativeEntry("read"),
      nativeEntry("shell"),
      nativeEntry("edit"),
      nativeEntry("task"),
      pluginEntry("lint", "/plugins/lint.js"),
      mcpEntry("alpha", "probe"),
      mcpEntry("alpha", "dangerous"),
      { family: "legacy", alias: "old" },
    ],
    mcpServers: { alpha: { type: "local", command: ["alpha-server"], environment: ["ALPHA_TOKEN"] } },
    session: [],
    workflow: [],
  }
  change?.(value)
  return value
}

const inputs = (value: ExecutionContract) => ({
  toolAllowlist: value.toolAllowlist,
  toolBlocklist: value.toolBlocklist,
  workflowClass: value.workflowClass,
})

async function propose(value = contract(), snap = snapshot(), writeScope?: { roots: string[]; reviewed: boolean }) {
  return proposeGrants({
    runId: value.runId,
    contract: value,
    snapshot: snap,
    inputs: { ...inputs(value), ...(writeScope ? { writeScope } : {}) },
  })
}

const subjects = (proposal: Awaited<ReturnType<typeof propose>>) =>
  proposal.candidate.capabilityGrants.map((grant) =>
    grant.subject.kind === "capability" ? grant.subject.capabilityId : `source:${grant.subject.server}`,
  )

describe("a proposal is deterministic data derived from recorded inputs", () => {
  test("the same inputs give the same proposal and digest; a changed catalog gives another", async () => {
    // A compiled contract carries fresh identifiers, so one contract is reused.
    const compiled = contract()
    const first = await proposalDigest(await propose(compiled))
    const again = await proposalDigest(await propose(compiled))
    expect(again).toEqual(first)
    // Registry order does not matter; content does.
    const reordered = await proposalDigest(
      await propose(
        compiled,
        snapshot((value) => value.tools.reverse()),
      ),
    )
    expect(reordered).toEqual(first)
    expect((await proposalDigest(await propose(contract()))).digest).not.toBe(first.digest)
    const changed = await proposalDigest(
      await propose(
        compiled,
        snapshot((value) => {
          value.tools[4] = pluginEntry("lint", "/plugins/lint.js", "m2")
        }),
      ),
    )
    expect(changed.digest).not.toBe(first.digest)
  })

  test("a blocked alias yields no grant; MCP tools are granted by exact identity, never by source", async () => {
    const proposal = await propose(contract((value) => (value.toolBlocklist = ["alpha_dangerous", "shell"])))
    const granted = subjects(proposal)
    expect(granted).toContain(mcpCapability(["mcp", "alpha", "probe"]).descriptor.id)
    expect(granted).not.toContain(mcpCapability(["mcp", "alpha", "dangerous"]).descriptor.id)
    expect(granted).not.toContain("native.tool.shell")
    expect(proposal.candidate.capabilityGrants.some((grant) => grant.subject.kind === "mcp_source")).toBe(false)
    // Resource and prompt reads are listed for the reviewer, not granted.
    expect(proposal.onDemandSources).toEqual([
      { server: "alpha", family: "resource" },
      { server: "alpha", family: "prompt" },
    ])
  })

  test("legacy executors are excluded, and a plugin under a native alias is marked", async () => {
    const proposal = await propose(
      contract(),
      snapshot((value) => value.tools.push(pluginEntry("read", "/plugins/read.js"))),
    )
    expect(proposal.excluded).toEqual([{ alias: "old", reason: "legacy_unenrolled" }])
    const override = pluginCapability(["directory", "/plugins/read.js", "default"]).descriptor.id
    // Dispatch selects the last executor under an alias; that is the one granted.
    expect(subjects(proposal)).toContain(override)
    expect(proposal.marked).toEqual([
      { capabilityId: override, alias: "read", note: "non_native_executor_under_native_alias" },
    ])
  })

  test("without reviewed scope evidence, filesystem and delegation capabilities are not granted", async () => {
    const filesystem = ["read", "edit"].filter((alias) => native(alias).scopeSupport === "filesystem")
    expect(filesystem.length).toBeGreaterThan(0)
    for (const writeScope of [undefined, { roots: ["src"], reviewed: false }]) {
      const proposal = await propose(contract(), snapshot(), writeScope)
      for (const alias of filesystem) {
        expect(subjects(proposal)).not.toContain(`native.tool.${alias}`)
        expect(proposal.needsScope).toContainEqual({
          capabilityId: `native.tool.${alias}`,
          alias,
          scopeSupport: "filesystem",
        })
      }
      // No proposed grant is run scope over a filesystem-capable capability.
      expect(
        proposal.candidate.capabilityGrants.some(
          (grant) => grant.scope.kind === "run" && grant.scope.acknowledgesNoFilesystemConfinement,
        ),
      ).toBe(false)
      expect(proposal.needsScope.some((item) => item.scopeSupport === "delegation")).toBe(true)
    }
    const reviewed = await propose(contract(), snapshot(), { roots: ["src", "src"], reviewed: true })
    for (const alias of filesystem) {
      expect(reviewed.candidate.capabilityGrants).toContainEqual({
        subject: { kind: "capability", capabilityId: `native.tool.${alias}` },
        decision: "allow",
        scope: { kind: "filesystem", roots: ["src"] },
      })
    }
  })
})

describe("approval binds the implementation, not only the identity", () => {
  test("a changed plugin file, MCP definition or server changes the binding; unrelated additions do not", async () => {
    const proposal = await propose()
    const bindingFor = (id: string) => {
      const index = proposal.candidate.capabilityGrants.findIndex(
        (grant) => grant.subject.kind === "capability" && grant.subject.capabilityId === id,
      )
      return { binding: proposal.bindings[index]!, subject: proposal.candidate.capabilityGrants[index]!.subject }
    }
    const lint = bindingFor(pluginCapability(["directory", "/plugins/lint.js", "default"]).descriptor.id)
    const probe = bindingFor(mcpCapability(["mcp", "alpha", "probe"]).descriptor.id)

    // Same logical identity, edited in place: the capability ID is unchanged.
    const edited = snapshot((value) => {
      value.tools[4] = pluginEntry("lint", "/plugins/lint.js", "m1", "sha256:b")
    })
    expect((edited.tools[4] as { descriptor: { id: string } }).descriptor.id).toBe(
      lint.subject.kind === "capability" ? lint.subject.capabilityId : "",
    )
    expect(await checkBinding(lint.binding, lint.subject, edited)).toBe("changed")

    const redefined = snapshot((value) => {
      value.tools[5] = mcpEntry("alpha", "probe", "d2")
    })
    expect(await checkBinding(probe.binding, probe.subject, redefined)).toBe("changed")
    const relaunched = snapshot((value) => {
      value.mcpServers.alpha = { type: "local", command: ["other-server"], environment: ["ALPHA_TOKEN"] }
    })
    expect(await checkBinding(probe.binding, probe.subject, relaunched)).toBe("changed")
    const gone = snapshot((value) => {
      value.mcpServers = {}
    })
    expect(await checkBinding(probe.binding, probe.subject, gone)).toBe("unavailable")

    const enlarged = snapshot((value) =>
      value.tools.push(mcpEntry("beta", "extra"), pluginEntry("fmt", "/plugins/fmt.js")),
    )
    expect(await checkBinding(lint.binding, lint.subject, enlarged)).toBe("unchanged")
    expect(await checkBinding(probe.binding, probe.subject, enlarged)).toBe("unchanged")
  })
})

describe("explicit denials survive any grant", () => {
  test("a reviewer-added source grant reaches the allowed tool and never the blocked one on the same server", async () => {
    const proposal = await propose(contract((value) => (value.toolBlocklist = ["alpha_dangerous"])))
    const reviewed = ExecutionContractV2.parse({
      ...proposal.candidate,
      capabilityGrants: CapabilityGrants.parse([
        ...proposal.candidate.capabilityGrants,
        { subject: { kind: "mcp_source", server: "alpha", family: "tool" }, decision: "allow", scope: { kind: "run" } },
      ]),
    })
    const decide = (name: string) =>
      resolveCapabilityAuthority({
        path: "mcp_tool",
        initiator: "model",
        contract: reviewed,
        authorityRunId: RUN,
        executor: { kind: "mcp", alias: `alpha_${name}`, descriptor: mcpCapability(["mcp", "alpha", name]).descriptor },
        source: { server: "alpha", name },
        directory: os.tmpdir(),
        worktree: os.tmpdir(),
      })
    expect(decide("probe")).toMatchObject({ decision: "allow" })
    expect(decide("dangerous")).toMatchObject({ decision: "deny", reasonCode: "contract_tool_denied" })
  })
})

let home: string
let directory: string
let previousHome: string | undefined

beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-grant-stage3-"))
  process.env.DAX_TEST_HOME = home
  directory = path.join(home, "project")
  await fs.mkdir(directory, { recursive: true })
  await fs.mkdir(path.join(home, ".config", "dax"), { recursive: true })
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: directory })
    if (result.exitCode) throw new Error(result.stderr.toString())
  }
  git("init")
  await fs.writeFile(path.join(directory, "seed.txt"), "seed content\n")
  git("add", "seed.txt")
  git("-c", "user.name=Grant Stage", "-c", "user.email=stage@example.invalid", "commit", "-m", "seed")
  await fs.writeFile(
    path.join(directory, "dax.json"),
    JSON.stringify({ command: { "stage-three": { template: "!`echo controlled`" } } }),
  )
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

async function reviewedRun() {
  return createGrantReviewedRun({ request: { intent: { input: "Inspect the repository, read only." } } })
}

/** What the operator saw and approved: the subject the run log holds for this revision. */
async function subjectOf(runId: string, approvalId: string) {
  const events = await readRunEvents(runId)
  const requested = events
    .filter((event) => event.type === "approval_requested")
    .map((event) => event.payload as { approvalId: string; contractGrantSubject?: unknown })
    .find((payload) => payload.approvalId === approvalId)
  return requested!.contractGrantSubject as {
    kind: "contract_grant_set"
    runId: string
    contractId: string
    revision: number
    canonicalization: "sorted-json-v1"
    digest: string
  }
}

/** The rejection a promise settles with, or undefined if it fulfills. */
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

describe("review publication is exact, serialized and recoverable", () => {
  test("a reviewed run waits on one digest-bound request and has no executable contract", async () => {
    await within(async () => {
      const { runId, revision } = await reviewedRun()
      const state = await projectRunStateFromEvents(runId)
      expect(state?.status).toBe("waiting_approval")
      expect(state?.approvals.map((item) => item.approvalId)).toEqual([revision.approvalId])
      expect(await subjectOf(runId, revision.approvalId)).toEqual({
        kind: "contract_grant_set",
        runId,
        contractId: revision.proposal.candidate.contractId,
        revision: 1,
        canonicalization: "sorted-json-v1",
        digest: revision.digest,
      })
      expect(revision.digest).toBe((await proposalDigest(revision.proposal)).digest)
      expect(await rejection(readContract(runId))).toBeInstanceOf(GrantReviewBarrierError)
      // Nothing was written where the guardian reads.
      expect(await rejection(Storage.read(["execution_contract", Instance.project.id, runId]))).toMatchObject({
        name: "NotFoundError",
      })
    })
  })

  test("only an approved current request with the exact subject publishes, once", async () => {
    await within(async () => {
      const { runId, revision } = await reviewedRun()
      const subject = await subjectOf(runId, revision.approvalId)
      const approval = { approvalId: revision.approvalId, subject }

      expect(await refusal(GrantReview.publish(runId, approval))).toBe("approval_not_approved")
      await resolveApprovalEvent(runId, revision.approvalId, "approved", "operator")
      expect(
        await refusal(
          GrantReview.publish(runId, { ...approval, subject: { ...subject, digest: `sha256:${"0".repeat(64)}` } }),
        ),
      ).toBe("digest_mismatch")
      expect(await refusal(GrantReview.publish(runId, { ...approval, subject: { ...subject, revision: 2 } }))).toBe(
        "revision_not_current",
      )
      expect(
        await refusal(GrantReview.publish(runId, { ...approval, subject: { ...subject, runId: "ses_other" } })),
      ).toBe("subject_mismatch")
      expect(await refusal(GrantReview.publish(runId, { approvalId: "apr_other", subject }))).toBe(
        "approval_not_current",
      )
      expect(await refusal(GrantReview.publish(runId, { ...approval, subject: { ...subject, kind: "other" } }))).toBe(
        "subject_invalid",
      )
      expect(await GrantReview.readPublished(runId)).toBeUndefined()

      const result = await GrantReview.publish(runId, approval)
      expect(result.status).toBe("published")
      expect(result.published.contract).toEqual(revision.proposal.candidate)
      expect(await GrantReview.readPublished(runId)).toEqual(result.published)

      // A repeated approval is a no-op; a published review cannot be revised.
      expect((await GrantReview.publish(runId, approval)).status).toBe("already_published")
      expect(await refusal(GrantReview.revise(runId, revision.proposal))).toBe("review_published")
      expect((await GrantReview.get(runId))?.revisions.map((item) => item.status)).toEqual(["published"])
    })
  })

  test("denied, expired and tampered reviews publish nothing", async () => {
    await within(async () => {
      for (const decision of ["rejected", "expired", "cancelled"] as const) {
        const { runId, revision } = await reviewedRun()
        await resolveApprovalEvent(runId, revision.approvalId, decision, "operator")
        const subject = await subjectOf(runId, revision.approvalId)
        expect(await refusal(GrantReview.publish(runId, { approvalId: revision.approvalId, subject }))).toBe(
          "approval_not_approved",
        )
        expect(await GrantReview.readPublished(runId)).toBeUndefined()
      }
      // A stored proposal edited after the request no longer matches its digest.
      const { runId, revision } = await reviewedRun()
      await resolveApprovalEvent(runId, revision.approvalId, "approved", "operator")
      const key = ["grant_review", Instance.project.id, runId]
      const record = await Storage.read<{ revisions: { proposal: { candidate: { capabilityGrants: unknown[] } } }[] }>(
        key,
      )
      record.revisions[0]!.proposal.candidate.capabilityGrants = []
      await Storage.write(key, record)
      const subject = await subjectOf(runId, revision.approvalId)
      expect(await refusal(GrantReview.publish(runId, { approvalId: revision.approvalId, subject }))).toBe(
        "digest_mismatch",
      )
    })
  })

  test("a new revision supersedes the old request, and concurrent revisions serialize", async () => {
    await within(async () => {
      const { runId, revision } = await reviewedRun()
      const first = await subjectOf(runId, revision.approvalId)
      const second = await GrantReview.revise(runId, revision.proposal)
      expect(second.revision).toBe(2)
      let state = await projectRunStateFromEvents(runId)
      expect(state?.status).toBe("waiting_approval")
      expect(state?.approvals.find((item) => item.approvalId === revision.approvalId)?.status).toBe("expired")
      // The old request can neither be approved now nor publish.
      expect(await rejection(resolveApprovalEvent(runId, revision.approvalId, "approved", "operator"))).toBeInstanceOf(
        Error,
      )
      expect(await refusal(GrantReview.publish(runId, { approvalId: revision.approvalId, subject: first }))).toBe(
        "revision_not_current",
      )

      const [a, b] = await Promise.all([
        GrantReview.revise(runId, revision.proposal),
        GrantReview.revise(runId, revision.proposal),
      ])
      expect([a.revision, b.revision].sort()).toEqual([3, 4])
      const record = await GrantReview.get(runId)
      expect(record?.revisions.map((item) => item.status)).toEqual([
        "superseded",
        "superseded",
        "superseded",
        "pending",
      ])
      state = await projectRunStateFromEvents(runId)
      expect(state?.approvals.filter((item) => item.status === "pending").map((item) => item.approvalId)).toEqual([
        record!.revisions[3]!.approvalId,
      ])
    })
  })

  test("an approval nobody put their name to publishes nothing", async () => {
    await within(async () => {
      for (const actor of [null, "", "   "]) {
        const { runId, revision } = await reviewedRun()
        await resolveApprovalEvent(runId, revision.approvalId, "approved", actor)
        const subject = await subjectOf(runId, revision.approvalId)
        expect(await refusal(GrantReview.publish(runId, { approvalId: revision.approvalId, subject }))).toBe(
          "approval_actor_missing",
        )
        expect(await GrantReview.readPublished(runId)).toBeUndefined()
      }
    })
  })

  for (const point of ["afterIntent", "afterArtifact"] as const) {
    test(`a publication interrupted ${point === "afterIntent" ? "before" : "after"} its artifact recovers only through a new reviewed revision`, async () => {
      let runId = ""
      let first: { approvalId: string; subject: unknown } | undefined
      await within(async () => {
        const created = await reviewedRun()
        runId = created.runId
        first = {
          approvalId: created.revision.approvalId,
          subject: await subjectOf(runId, created.revision.approvalId),
        }
        await resolveApprovalEvent(runId, created.revision.approvalId, "approved", "operator")
        const died = await rejection(
          GrantReview.publish(runId, first, {
            [point]: async () => {
              throw new Error("process died")
            },
          }),
        )
        expect((died as Error).message).toBe("process died")
      })
      await Instance.disposeAll()
      await within(async () => {
        expect(await refusal(GrantReview.publish(runId, first!))).toBe("publication_uncertain")
        expect(await GrantReview.readPublished(runId)).toBeUndefined()

        const stored = (await GrantReview.get(runId))!
        const replacement = await GrantReview.revise(runId, stored.revisions[0]!.proposal)
        expect(replacement.revision).toBe(2)
        const record = (await GrantReview.get(runId))!
        expect(record.revisions.map((item) => item.status)).toEqual(["uncertain", "pending"])
        expect(record.publication).toBeUndefined()
        expect(record.abandoned).toEqual([
          { revision: 1, digest: stored.revisions[0]!.digest, approvalId: stored.revisions[0]!.approvalId },
        ])
        // Whatever the interruption left behind is gone, and the old approval publishes nothing.
        expect(await rejection(Storage.read(["grant_review_published", Instance.project.id, runId]))).toMatchObject({
          name: "NotFoundError",
        })
        expect(await refusal(GrantReview.publish(runId, first!))).toBe("revision_not_current")
        expect(await GrantReview.readPublished(runId)).toBeUndefined()
        expect(await rejection(readContract(runId))).toBeInstanceOf(GrantReviewBarrierError)

        // The new revision needs its own approval, then publishes as itself.
        const second = { approvalId: replacement.approvalId, subject: await subjectOf(runId, replacement.approvalId) }
        expect(await refusal(GrantReview.publish(runId, second))).toBe("approval_not_approved")
        await resolveApprovalEvent(runId, replacement.approvalId, "approved", "operator")
        const result = await GrantReview.publish(runId, second)
        expect(result.published.revision).toBe(2)
        expect(await GrantReview.readPublished(runId)).toEqual(result.published)
      })
    })
  }
})

describe("a grant review never claims execution", () => {
  test("the run is queued, waits on review, and returns to the queue when decided", async () => {
    await within(async () => {
      const { runId, revision } = await reviewedRun()
      const types = (await readRunEvents(runId)).map((event) => event.type)
      expect(types).toEqual(["contract_compiled", "execution_queued", "approval_requested"])
      expect((await projectRunStateFromEvents(runId))?.startedAt ?? null).toBeNull()

      // Denied: back to the queue, and a new revision can be requested from there.
      await resolveApprovalEvent(runId, revision.approvalId, "rejected", "operator")
      expect((await projectRunStateFromEvents(runId))?.status).toBe("queued")
      const second = await GrantReview.revise(runId, revision.proposal)
      expect((await projectRunStateFromEvents(runId))?.status).toBe("waiting_approval")

      // Approved and published: still queued, never running.
      await resolveApprovalEvent(runId, second.approvalId, "approved", "operator")
      expect((await projectRunStateFromEvents(runId))?.status).toBe("queued")
      await GrantReview.publish(runId, {
        approvalId: second.approvalId,
        subject: await subjectOf(runId, second.approvalId),
      })
      const state = await projectRunStateFromEvents(runId)
      expect(state?.status).toBe("queued")
      expect(state?.startedAt ?? null).toBeNull()
      expect((await readRunEvents(runId)).some((event) => event.type === "execution_started")).toBe(false)
    })
  })

  test("only a grant review request may enter review from the queue, and it must carry its subject", async () => {
    await within(async () => {
      const { runId, revision } = await reviewedRun()
      await resolveApprovalEvent(runId, revision.approvalId, "rejected", "operator")
      // An ordinary approval from the queue is still illegal.
      expect(await rejection(addApprovalEvent(runId, "apr_ordinary", { approvalType: "tool" }))).toBeInstanceOf(Error)
      // A grant review type without its subject, or a subject on another type, is refused.
      expect(
        await rejection(
          appendEventOnly(runId, "approval_requested", {
            approvalId: "apr_bare",
            approvalType: "capability_grant_review",
            risk: "high",
          }),
        ),
      ).toBeInstanceOf(Error)
      expect(
        await rejection(
          appendEventOnly(runId, "approval_requested", {
            approvalId: "apr_mislabelled",
            approvalType: "tool",
            risk: "high",
            contractGrantSubject: await subjectOf(runId, revision.approvalId),
          }),
        ),
      ).toBeInstanceOf(Error)
      expect((await projectRunStateFromEvents(runId))?.status).toBe("queued")
    })
  })
})

describe("capture reads the current catalog and publication checks it afresh", () => {
  async function probe(description: string) {
    const folder = path.join(home, ".config", "dax", "tool")
    await fs.mkdir(folder, { recursive: true })
    const file = path.join(folder, "search.js")
    await fs.writeFile(
      file,
      `export default { description: ${JSON.stringify(description)}, args: {}, async execute() { return "ok" } }`,
    )
    return file
  }

  test("a cold capture sees an enrolled loader plugin as a plugin, not a legacy executor", async () => {
    await probe("initial")
    await within(async () => {
      const captured = await captureReviewSnapshot(contract())
      expect(captured.tools.find((item) => item.alias === "search")?.family).toBe("plugin")
    })
  })

  test("a plugin changed after review is caught by the first fresh capture, and publication refuses it", async () => {
    const file = await probe("initial")
    await within(async () => {
      const { runId, revision } = await reviewedRun()
      const granted = revision.proposal.candidate.capabilityGrants.findIndex(
        (grant) => grant.subject.kind === "capability" && grant.subject.capabilityId.startsWith("plugin.tool.v1."),
      )
      expect(granted).toBeGreaterThanOrEqual(0)
      const binding = revision.proposal.bindings[granted]!
      const subject = revision.proposal.candidate.capabilityGrants[granted]!.subject

      // The loaded module's metadata changes in place; the capability ID does not.
      const loaded = (await import(file)) as { default: { description: string } }
      loaded.default.description = "changed after operator review"
      expect(await checkBinding(binding, subject, await captureReviewSnapshot(revision.proposal.candidate))).toBe(
        "changed",
      )

      await resolveApprovalEvent(runId, revision.approvalId, "approved", "operator")
      const approval = { approvalId: revision.approvalId, subject: await subjectOf(runId, revision.approvalId) }
      expect(await refusal(GrantReview.publish(runId, approval))).toBe("binding_changed")
      expect(await GrantReview.readPublished(runId)).toBeUndefined()

      // Restored, the same approval publishes: the binding is to content, not to time.
      loaded.default.description = "initial"
      expect((await GrantReview.publish(runId, approval)).status).toBe("published")
    })
  })
})

describe("an approved, published review stays non-executable until stage 4", () => {
  test("prompt, loop, command, shell, birth, dispatch authority and workflow access do nothing", async () => {
    await within(async () => {
      const { runId, revision } = await reviewedRun()
      await resolveApprovalEvent(runId, revision.approvalId, "approved", "operator")
      await GrantReview.publish(runId, {
        approvalId: revision.approvalId,
        subject: await subjectOf(runId, revision.approvalId),
      })
      const child = await Session.create({ parentID: runId, title: "child" })
      await Session.bindGoverningRun(child.id, runId)

      const marker = path.join(home, "effect.txt")
      const eventsBefore = (await readRunEvents(runId)).length
      const stream = spyOn(LLM, "stream").mockRejectedValue(new Error("provider must not be called"))
      const getModel = spyOn(Provider, "getModel").mockRejectedValue(new Error("provider must not be resolved"))
      // Every DAX shell launch, operator or template, is wrapped here first.
      const wrap = spyOn(Sandbox, "wrap").mockRejectedValue(new Error("no process may be launched"))
      try {
        const attempts: [string, () => Promise<unknown>][] = [
          [
            "prompt",
            () => SessionPrompt.prompt({ sessionID: runId, parts: [{ type: "text", text: "Read seed.txt" }] }),
          ],
          [
            "prompt without reply, with an attachment",
            () =>
              SessionPrompt.prompt({
                sessionID: runId,
                noReply: true,
                parts: [
                  {
                    type: "file",
                    mime: "text/plain",
                    url: `file://${path.join(directory, "seed.txt")}`,
                    filename: "seed.txt",
                  },
                ],
              }),
          ],
          ["child prompt", () => SessionPrompt.prompt({ sessionID: child.id, parts: [{ type: "text", text: "hi" }] })],
          ["loop", () => SessionPrompt.loop({ sessionID: runId })],
          ["command", () => SessionPrompt.command({ sessionID: runId, command: "stage-three", arguments: "" })],
          ["shell", () => SessionPrompt.shell({ sessionID: runId, agent: "build", command: `touch ${marker}` })],
          ["birth", () => SessionPrompt.ensureCanonicalRunBirth({ sessionID: runId, intent: "go" })],
          ["dispatch authority", () => resolveExecutionAuthority(runId, runId)],
          [
            "operator shell authority",
            () =>
              authorizeOperatorShell({
                sessionID: runId,
                agent: "build",
                command: "true",
                callID: "call_stage3",
                capability: {} as never,
              }),
          ],
          ["workflow contract", () => RunFactory.getContract(runId)],
          ["guardian read", () => ContractGuardian.get(runId)],
          ["v1 fallback write", () => ContractGuardian.create(runId, contract(undefined, runId))],
        ]
        for (const [name, attempt] of attempts) {
          const error = await rejection(attempt())
          expect({ name, barrier: error instanceof GrantReviewBarrierError }).toEqual({ name, barrier: true })
        }
        expect(stream).not.toHaveBeenCalled()
        expect(getModel).not.toHaveBeenCalled()
        expect(wrap).not.toHaveBeenCalled()
      } finally {
        wrap.mockRestore()
        stream.mockRestore()
        getModel.mockRestore()
      }
      expect(await Bun.file(marker).exists()).toBe(false)
      expect(await Session.messages({ sessionID: runId })).toEqual([])
      expect(await Session.messages({ sessionID: child.id })).toEqual([])
      expect((await readRunEvents(runId)).length).toBe(eventsBefore)
      expect(await rejection(Storage.read(["execution_contract", Instance.project.id, runId]))).toMatchObject({
        name: "NotFoundError",
      })
    })
  })
})
