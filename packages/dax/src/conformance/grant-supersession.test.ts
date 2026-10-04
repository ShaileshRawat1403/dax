import { afterEach, beforeEach, expect, test, spyOn } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "@/project/instance"
import { Storage } from "@/storage/storage"
import { createEventAuthorityRun, appendEventOnly, resolveApprovalEvent } from "@/state/events/event-transitions"
import { readRunEvents, projectRunStateFromEvents, appendRunEventBatchAtTail } from "@/state/events/run-event-store"
import { reduceRunState } from "@/state/events/run-reducer"
import { supersededReviewApprovals } from "@/state/events/grant-review-supersession"
import { createGrantReviewedRun } from "@/execution/run-factory"
import { GrantReview } from "@/capability/grant-review"
import { Config } from "@/config/config"
import type { ContractGrantApprovalSubject } from "@/state/events/contract-grant-approval"

let home: string
let directory: string
let oldHome: string | undefined
beforeEach(async () => {
  oldHome = process.env.DAX_TEST_HOME
  home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-supersession-"))
  directory = path.join(home, "project")
  process.env.DAX_TEST_HOME = home
  await fs.mkdir(directory, { recursive: true })
  await fs.mkdir(path.join(home, ".config", "dax"), { recursive: true })
  const git = Bun.spawnSync(["git", "init", "--quiet", directory])
  expect(git.exitCode).toBe(0)
  await Instance.disposeAll()
  Config.global.reset()
})
afterEach(async () => {
  await Instance.disposeAll()
  Config.global.reset()
  if (oldHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = oldHome
  await fs.rm(home, { recursive: true, force: true })
})
const within = (fn: () => Promise<void>) => Instance.provide({ directory, fn })
async function refused(work: Promise<unknown>, message?: string) {
  const error = await work.then(
    () => undefined,
    (error: unknown) => error,
  )
  expect(error).toBeInstanceOf(Error)
  if (message) expect((error as Error).message).toContain(message)
}
const digest = `sha256:${"a".repeat(64)}`
const RUN = "ses_supersession"
const subject = (
  revision: number,
  change: Partial<ContractGrantApprovalSubject> = {},
): ContractGrantApprovalSubject => ({
  kind: "contract_grant_set",
  runId: RUN,
  contractId: "contract_supersession",
  revision,
  canonicalization: "sorted-json-v1",
  digest,
  contractDigest: digest,
  bindings: [],
  ...change,
})
async function birth() {
  await createEventAuthorityRun(RUN, "contract_supersession", false, "enforce", "reviewed_grants")
  await appendEventOnly(RUN, "execution_queued", {})
}
const request = (id: string, value: ContractGrantApprovalSubject) =>
  appendEventOnly(RUN, "approval_requested", {
    approvalId: id,
    approvalType: "capability_grant_review",
    risk: "high",
    contractGrantSubject: value,
  })
const supersede = (old: string, next: string, decision: "expired" | "approved" = "expired") =>
  appendEventOnly(RUN, "approval_resolved", { approvalId: old, decision, supersededByApprovalId: next })
const prove = async (id: string, revision: number) => {
  await resolveApprovalEvent(RUN, id, "approved", "operator")
  await appendEventOnly(RUN, "grant_review_published", {
    approvalId: id,
    contractId: "contract_supersession",
    revision,
    proposalDigest: digest,
    contractDigest: digest,
    bindings: [],
    approvedBy: "operator",
  })
  await appendEventOnly(RUN, "grant_review_activated", {
    revision,
    contractDigest: digest,
    bindings: [],
  })
}

test("journal-only two-link supersession reaches exact proven current review", () =>
  within(async () => {
    await birth()
    await request("r1", subject(1))
    await request("r2", subject(2))
    await supersede("r1", "r2")
    await request("r3", subject(3))
    await supersede("r2", "r3")
    expect(supersededReviewApprovals((await projectRunStateFromEvents(RUN))!, "r3").size).toBe(0)
    await prove("r3", 3)
    const state = reduceRunState(await readRunEvents(RUN))!
    expect([...supersededReviewApprovals(state, "r3")]).toEqual(["r1", "r2"])
    expect(supersededReviewApprovals(state, "r2").size).toBe(0)
    expect(state.approvals[0]!.supersededByApprovalId).toBe("r2")
    const before = await readRunEvents(RUN)
    await refused(supersede("r1", "r3"))
    expect(await readRunEvents(RUN)).toEqual(before)
  }))

for (const variant of [
  "equal",
  "older",
  "cross-run",
  "cross-contract",
  "incomplete-old",
  "incomplete-new",
  "missing-successor",
  "approved-successor",
  "ordinary-old",
  "wrong-decision",
  "stale-successor",
  "cyclic",
  "published",
  "activated",
  "started",
  "malformed",
] as const) {
  test(`supersession ${variant} refuses before journal publication`, () =>
    within(async () => {
      await birth()
      const old = variant === "incomplete-old" ? subject(1, { bindings: undefined }) : subject(1)
      if (variant === "ordinary-old") await request("r2", subject(2))
      if (variant === "ordinary-old")
        await appendEventOnly(RUN, "approval_requested", {
          approvalId: "r1",
          approvalType: "workflow_gate",
          risk: "high",
        })
      else await request("r1", old)
      if (variant !== "missing-successor" && variant !== "ordinary-old")
        await request(
          "r2",
          subject(
            variant === "equal" ? 1 : variant === "older" ? 1 : 2,
            variant === "cross-run"
              ? { runId: "ses_other" }
              : variant === "cross-contract"
                ? { contractId: "other" }
                : variant === "incomplete-new"
                  ? { contractDigest: undefined }
                  : {},
          ),
        )
      if (variant === "approved-successor") await resolveApprovalEvent(RUN, "r2", "approved", "operator")
      if (variant === "stale-successor") await request("r3", subject(3))
      if (variant === "published" || variant === "activated" || variant === "started") {
        await resolveApprovalEvent(RUN, "r2", "approved", "operator")
        await appendEventOnly(RUN, "grant_review_published", {
          approvalId: "r2",
          contractId: "contract_supersession",
          revision: 2,
          proposalDigest: digest,
          contractDigest: digest,
          bindings: [],
          approvedBy: "operator",
        })
        if (variant !== "published")
          await appendEventOnly(RUN, "grant_review_activated", {
            revision: 2,
            contractDigest: digest,
            bindings: [],
          })
        if (variant === "started") await appendEventOnly(RUN, "execution_started", {})
        await request("r4", subject(4))
      }
      const before = await readRunEvents(RUN)
      await refused(
        variant === "malformed"
          ? appendEventOnly(RUN, "approval_resolved", {
              approvalId: "r1",
              decision: "expired",
              supersededByApprovalId: "",
            })
          : supersede(
              "r1",
              variant === "cyclic" ? "r1" : ["published", "activated", "started"].includes(variant) ? "r4" : "r2",
              variant === "wrong-decision" ? "approved" : "expired",
            ),
      )
      expect(await readRunEvents(RUN)).toEqual(before)
    }))
}

test("historical expiry without explicit proof remains blocking, including unrelated requests", () =>
  within(async () => {
    await birth()
    await request("r1", subject(1))
    await resolveApprovalEvent(RUN, "r1", "expired")
    await request("r2", subject(2))
    await prove("r2", 2)
    const state = (await projectRunStateFromEvents(RUN))!
    expect(supersededReviewApprovals(state, "r2").size).toBe(0)
  }))

test("invalid second event in batch publishes neither request nor resolution", () =>
  within(async () => {
    await birth()
    await request("r1", subject(1))
    const before = await readRunEvents(RUN)
    await refused(
      appendRunEventBatchAtTail(RUN, () => [
        {
          type: "approval_requested",
          payload: {
            approvalId: "r2",
            approvalType: "capability_grant_review",
            risk: "high",
            contractGrantSubject: subject(1),
          },
        },
        { type: "approval_resolved", payload: { approvalId: "r1", decision: "expired", supersededByApprovalId: "r2" } },
      ]),
    )
    expect(await readRunEvents(RUN)).toEqual(before)
  }))

test("two interrupted private revisions recover every canonical pending request with skipped revisions", () =>
  within(async () => {
    const created = await createGrantReviewedRun({ request: { intent: { input: "Inspect source." } } })
    const rename = Storage.rename
    const fault = spyOn(Storage, "rename").mockImplementation(async (from, to) => {
      if (from.includes("run_events")) throw new Error("fault-before-atomic-publication")
      return rename(from, to)
    })
    try {
      await refused(GrantReview.revise(created.runId, created.revision.proposal), "fault-before-atomic-publication")
      await refused(GrantReview.revise(created.runId, created.revision.proposal), "fault-before-atomic-publication")
      expect((await GrantReview.get(created.runId))!.revisions.at(-1)!.revision).toBe(3)
      expect((await projectRunStateFromEvents(created.runId))!.pendingApprovalIds).toEqual([
        created.revision.approvalId,
      ])
    } finally {
      fault.mockRestore()
    }
    const recovered = await GrantReview.revise(created.runId, created.revision.proposal)
    const state = reduceRunState(await readRunEvents(created.runId))!
    expect(recovered.revision).toBe(4)
    expect(state.pendingApprovalIds).toEqual([recovered.approvalId])
    expect(state.approvals[0]!.supersededByApprovalId).toBe(recovered.approvalId)
    expect(Object.keys(state.grantReview.requests)).toHaveLength(2)
  }))

test("uncertain successful batch replay and subsequent revision preserve the complete chain", () =>
  within(async () => {
    const created = await createGrantReviewedRun({ request: { intent: { input: "Inspect source." } } })
    const rename = Storage.rename
    const fault = spyOn(Storage, "rename").mockImplementation(async (from, to) => {
      const result = await rename(from, to)
      if (from.includes("run_events")) throw new Error("fault-after-atomic-publication")
      return result
    })
    try {
      await refused(GrantReview.revise(created.runId, created.revision.proposal), "fault-after-atomic-publication")
    } finally {
      fault.mockRestore()
    }
    const second = (await GrantReview.get(created.runId))!.revisions.at(-1)!
    const state = reduceRunState(await readRunEvents(created.runId))!
    expect(state.approvals[0]!.supersededByApprovalId).toBe(second.approvalId)
    expect(state.pendingApprovalIds).toEqual([second.approvalId])
    const third = await GrantReview.revise(created.runId, created.revision.proposal)
    const replay = reduceRunState(await readRunEvents(created.runId))!
    expect(replay.approvals[1]!.supersededByApprovalId).toBe(third.approvalId)
    expect(replay.pendingApprovalIds).toEqual([third.approvalId])
  }))

test("historical request-before-expiry interruption recovers canonical pending even when private old is superseded", () =>
  within(async () => {
    const created = await createGrantReviewedRun({ request: { intent: { input: "Inspect source." } } })
    const rename = Storage.rename
    const fault = spyOn(Storage, "rename").mockImplementation(async (from, to) => {
      if (from.includes("run_events")) throw new Error("fault-before-batch")
      return rename(from, to)
    })
    try {
      await refused(GrantReview.revise(created.runId, created.revision.proposal))
    } finally {
      fault.mockRestore()
    }
    const record = (await GrantReview.get(created.runId))!
    const current = record.revisions.at(-1)!
    expect(record.revisions[0]!.status).toBe("superseded")
    // Old producer ordering could leave just its successor request durable.
    const { computeCanonicalCommitment } = await import("@/execution/canonical-commitment")
    await appendEventOnly(created.runId, "approval_requested", {
      approvalId: current.approvalId,
      approvalType: "capability_grant_review",
      risk: "high",
      contractGrantSubject: {
        kind: "contract_grant_set",
        runId: created.runId,
        contractId: record.contractId,
        revision: current.revision,
        canonicalization: "sorted-json-v1",
        digest: current.digest,
        contractDigest: (await computeCanonicalCommitment(current.proposal.candidate)).digest,
        bindings: current.proposal.bindings.map((binding, index) => ({
          ...binding,
          decision: current.proposal.candidate.capabilityGrants[index]!.decision,
        })),
      },
    })
    const recovered = await GrantReview.revise(created.runId, created.revision.proposal)
    const state = reduceRunState(await readRunEvents(created.runId))!
    expect(state.approvals.slice(0, 2).map((item) => item.supersededByApprovalId)).toEqual([
      recovered.approvalId,
      recovered.approvalId,
    ])
    expect(state.pendingApprovalIds).toEqual([recovered.approvalId])
  }))
