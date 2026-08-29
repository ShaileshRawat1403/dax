import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { mkdirSync, rmSync } from "node:fs"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Storage } from "@/storage/storage"
import { RunStore } from "@/state/run-store"
import { Bus } from "@/bus"
import { Lifecycle } from "@/bus/lifecycle"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian } from "@/execution/contract-guardian"
import {
  addApprovalEvent,
  addArtifactEvent,
  addStepEvent,
  createEventAuthorityRun,
  startStepEvent,
  transitionEventAuthority,
} from "@/state/events/event-transitions"
import { setRunAuthority } from "@/state/events/run-event-store"
import { recoverRun } from "@/state/recovery"
import { RunGateway } from "./run-gateway"

let testHome = ""
let previousTestHome: string | undefined

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  testHome = path.join(os.tmpdir(), `dax-gateway-authority-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  process.env.DAX_TEST_HOME = testHome
  mkdirSync(testHome, { recursive: true })
  await Instance.disposeAll()
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousTestHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousTestHome
  rmSync(testHome, { recursive: true, force: true })
})

async function createRunningCanonicalRun(title: string) {
  const session = await Session.create({ title })
  const { contract } = compileWithRunId(
    { request: { intent: { input: "Exercise Gateway authority selection." } } },
    session.id,
  )
  await ContractGuardian.create(session.id, contract)
  await createEventAuthorityRun(session.id, contract.contractId)
  await transitionEventAuthority(session.id, "queued", "execution_queued", {})
  await transitionEventAuthority(session.id, "running", "execution_started", {})
  await RunGateway.initialize()
  return { session, contract }
}

function compatibilityApproval(runId: string, approvalId: string) {
  const timestamp = new Date().toISOString()
  return {
    type: "approval.requested" as const,
    payload: {
      approval: {
        approvalId,
        runId,
        type: "tool_use" as const,
        status: "pending" as const,
        risk: "medium" as const,
        title: "Compatibility-only approval",
        reason: "Absent from canonical history",
        context: {},
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
  }
}

async function addSessionArtifact(runId: string, artifact: { id: string; kind: string; path?: string; title: string }) {
  await Session.update(runId, (draft) => {
    draft.state_v2 = {
      activity_timeline: [],
      approvals: [],
      audit_findings: [],
      artifacts: [
        {
          id: artifact.id,
          kind: artifact.kind,
          path: artifact.path,
          metadata: { title: artifact.title },
          created_at: Date.now(),
        },
      ],
    }
  })
}

describe("RunGateway authority source selection", () => {
  test("compatibility-only approvals cannot enter event-authority snapshot, approvals, or projections", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { session } = await createRunningCanonicalRun("Canonical approval isolation")
        await RunGateway.__testing.appendEvent(session.id, compatibilityApproval(session.id, "apr_compat_only"))

        const snapshot = await RunGateway.getSnapshot(session.id)
        const approvals = await RunGateway.getApprovals(session.id)
        const projections = await RunGateway.getProjections(session.id)

        expect(snapshot.pendingApprovalCount).toBe(0)
        expect(approvals).toEqual([])
        expect(projections.approvals).toEqual([])
        expect(projections.header.interventionSummary).toBeUndefined()
      },
    })
  })

  test("compatibility bus approvals remain observable without mutating canonical authority", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { session } = await createRunningCanonicalRun("Canonical bus isolation")
        const approval = compatibilityApproval(session.id, "apr_bus_only").payload.approval

        await Bus.publish(Lifecycle.ApprovalRequested, { runId: session.id, approval })

        expect((await RunGateway.replayEvents(session.id)).some((event) => event.type === "approval.requested")).toBe(
          true,
        )
        expect((await RunGateway.getSnapshot(session.id)).pendingApprovalCount).toBe(0)
        expect(await RunGateway.getApprovals(session.id)).toEqual([])
      },
    })
  })

  test("compatibility terminal, step, and trust records cannot contradict a running canonical step", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { session } = await createRunningCanonicalRun("Canonical lifecycle isolation")
        await addStepEvent(session.id, "step_canonical", "Canonical step", "executed")
        await startStepEvent(session.id, "step_canonical")
        await RunGateway.__testing.appendEvent(session.id, {
          type: "step.started",
          payload: { stepId: "step_compat", title: "Compatibility step" },
        })
        await RunGateway.__testing.appendEvent(session.id, {
          type: "audit.posture_updated",
          payload: { trust: { posture: "strong", blocked: false, reasons: ["compatibility"] } },
        })
        await RunGateway.__testing.appendEvent(session.id, {
          type: "run.completed",
          payload: { status: "completed", summaryAvailable: true },
        })

        const snapshot = await RunGateway.getSnapshot(session.id)
        const summary = await RunGateway.getSummary(session.id)

        expect(snapshot.status).toBe("running")
        expect(snapshot.completedAt).toBeUndefined()
        expect(snapshot.terminalReason).toBeUndefined()
        expect(snapshot.currentStep).toMatchObject({ stepId: "step_canonical", title: "Canonical step" })
        expect(snapshot.trust).toBeUndefined()
        expect(summary.status).toBe("running")
        expect(summary.terminalReason).toBeUndefined()
        expect(summary.outcome?.result).toBe("pending")
        expect((await recoverRun(session.id)).recoveredRunState?.status).toBe("running")
      },
    })
  })

  test("compatibility and Session artifacts cannot enter event-authority artifact truth", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { session } = await createRunningCanonicalRun("Canonical artifact isolation")
        await addSessionArtifact(session.id, {
          id: "artifact_session_only",
          kind: "report",
          path: "session-only.md",
          title: "Session-only artifact",
        })
        await RunGateway.__testing.appendEvent(session.id, {
          type: "artifact.created",
          payload: {
            artifact: {
              artifactId: "artifact_compat_only",
              runId: session.id,
              type: "report",
              title: "Compatibility-only artifact",
              createdAt: new Date().toISOString(),
            },
          },
        })

        const snapshot = await RunGateway.getSnapshot(session.id)
        const artifacts = await RunGateway.listArtifacts(session.id)
        const summary = await RunGateway.getSummary(session.id)
        const projections = await RunGateway.getProjections(session.id)

        expect(snapshot.artifactSummary).toMatchObject({ total: 0, latestArtifactIds: [] })
        expect(artifacts).toEqual([])
        expect(summary.artifactCount).toBe(0)
        expect(projections.artifacts).toEqual([])
      },
    })
  })

  test("canonical approvals appear consistently and route resolution through canonical history", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { session } = await createRunningCanonicalRun("Canonical approval projection")
        await addApprovalEvent(session.id, "apr_canonical", {
          approvalType: "tool_use",
          risk: "high",
          title: "Canonical approval",
          reason: "Canonical operator decision required",
          source: "manual",
        })

        expect((await RunGateway.getSnapshot(session.id)).pendingApprovalCount).toBe(1)
        expect(await RunGateway.getApprovals(session.id)).toContainEqual(
          expect.objectContaining({ approvalId: "apr_canonical", status: "pending", title: "Canonical approval" }),
        )
        expect((await RunGateway.getProjections(session.id)).approvals).toContainEqual(
          expect.objectContaining({ approvalId: "apr_canonical" }),
        )

        await RunGateway.resolveApproval(session.id, "apr_canonical", {
          decision: "approve",
          actorId: "operator",
          source: "dax",
        })

        expect((await RunGateway.getSnapshot(session.id)).pendingApprovalCount).toBe(0)
        expect(await RunGateway.getApprovals(session.id)).toEqual([])
      },
    })
  })

  test("canonical steps, artifacts, terminal state, and last event project without Session additions", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { session } = await createRunningCanonicalRun("Canonical positive projection")
        await addStepEvent(session.id, "step_canonical", "Canonical step", "executed")
        await startStepEvent(session.id, "step_canonical")
        expect((await RunGateway.getSnapshot(session.id)).currentStep?.stepId).toBe("step_canonical")

        await addArtifactEvent(session.id, "artifact_canonical", "report")
        await addSessionArtifact(session.id, {
          id: "artifact_canonical",
          kind: "summary",
          path: "canonical-report.md",
          title: "Decorated canonical report",
        })

        const artifacts = await RunGateway.listArtifacts(session.id)
        expect(artifacts).toEqual([
          expect.objectContaining({
            artifactId: "artifact_canonical",
            type: "report",
            title: "Decorated canonical report",
            path: "canonical-report.md",
          }),
        ])
        expect((await RunGateway.getSnapshot(session.id)).artifactSummary).toMatchObject({
          total: 1,
          byType: { report: 1 },
          latestArtifactIds: ["artifact_canonical"],
        })

        await transitionEventAuthority(session.id, "completed", "run_completed", {})
        const snapshot = await RunGateway.getSnapshot(session.id)
        const summary = await RunGateway.getSummary(session.id)

        expect(snapshot.status).toBe("completed")
        expect(snapshot.completedAt).toBeDefined()
        expect(snapshot.terminalReason).toBe("workflow_completed")
        expect(snapshot.lastEvent).toMatchObject({ sequence: 6, cursor: expect.any(String) })
        expect(summary.outcome?.result).toBe("success")
        expect(summary.artifactCount).toBe(1)
      },
    })
  })

  test("event-log authority with missing canonical state fails closed despite every fallback", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const session = await Session.create({ title: "Missing canonical state" })
        await setRunAuthority(session.id, "event-log")
        const legacy = await RunStore.create(session.id, "ctr_legacy_fallback")
        await RunStore.save(session.id, { ...legacy, status: "completed", completedAt: new Date().toISOString() })
        await RunGateway.__testing.appendEvent(session.id, {
          type: "run.created",
          payload: { status: "created", title: "Compatibility fallback" },
        })
        await RunGateway.__testing.appendEvent(session.id, {
          type: "run.completed",
          payload: { status: "completed", summaryAvailable: true },
        })

        await expect(RunGateway.getSnapshot(session.id)).rejects.toThrow(/no canonical state/i)
        await expect(RunGateway.getSummary(session.id)).rejects.toThrow(/no canonical state/i)
        await expect(RunGateway.getProjections(session.id)).rejects.toThrow(/no canonical state/i)
        await expect(recoverRun(session.id)).rejects.toThrow(/no canonical state/i)
      },
    })
  })

  test("canonical corruption and malformed authority markers propagate without compatibility fallback", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { session } = await createRunningCanonicalRun("Corrupt canonical projection")
        await RunGateway.__testing.appendEvent(session.id, {
          type: "run.completed",
          payload: { status: "completed", summaryAvailable: true },
        })
        await Storage.write(["run_events", Instance.project.id, session.id, "events.json"], [{ malformed: true }])
        await expect(RunGateway.getSnapshot(session.id)).rejects.toThrow()

        const malformed = await Session.create({ title: "Malformed authority marker" })
        await Storage.write(["run_authority", Instance.project.id, malformed.id, "authority.json"], {
          authority: "uncertain",
        })
        await RunGateway.__testing.appendEvent(malformed.id, {
          type: "run.created",
          payload: { status: "created", title: "Compatibility fallback" },
        })
        await expect(RunGateway.getSnapshot(malformed.id)).rejects.toThrow(/Invalid run authority/i)
      },
    })
  })

  test("canonical events without an authority marker cannot fall back to compatibility state", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { session } = await createRunningCanonicalRun("Missing canonical authority marker")
        await RunGateway.__testing.appendEvent(session.id, {
          type: "run.completed",
          payload: { status: "completed", summaryAvailable: true },
        })
        await Storage.remove(["run_authority", Instance.project.id, session.id, "authority.json"])

        await expect(RunGateway.getSnapshot(session.id)).rejects.toThrow(/canonical events without a run authority marker/i)
        await expect(RunGateway.getSummary(session.id)).rejects.toThrow(/canonical events without a run authority marker/i)
        await expect(recoverRun(session.id)).rejects.toThrow(/canonical events exist without a run authority marker/i)
      },
    })
  })

  test("genuine unmarked legacy replay retains approvals, steps, artifacts, and terminal status", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const session = await Session.create({ title: "Legacy compatibility run" })
        await RunGateway.initialize()
        await RunGateway.__testing.appendEvent(session.id, {
          type: "run.created",
          payload: { status: "created", title: session.title },
        })
        await RunGateway.__testing.appendEvent(session.id, {
          type: "run.started",
          payload: { status: "running" },
        })
        await RunGateway.__testing.appendEvent(session.id, {
          type: "step.started",
          payload: { stepId: "legacy_step", title: "Legacy step" },
        })
        await RunGateway.__testing.appendEvent(session.id, compatibilityApproval(session.id, "apr_legacy"))
        await addSessionArtifact(session.id, {
          id: "artifact_legacy",
          kind: "report",
          path: "legacy-report.md",
          title: "Legacy report",
        })
        await RunGateway.__testing.appendEvent(session.id, {
          type: "artifact.created",
          payload: {
            artifact: {
              artifactId: "artifact_legacy",
              runId: session.id,
              type: "report",
              title: "Legacy report",
              createdAt: new Date().toISOString(),
            },
          },
        })

        const running = await RunGateway.getSnapshot(session.id)
        expect(running.authority).toBe("dax-state-machine")
        expect(running.status).toBe("running")
        expect(running.currentStep?.stepId).toBe("legacy_step")
        expect(running.pendingApprovalCount).toBe(1)
        expect(running.artifactSummary?.total).toBe(1)
        expect(await RunGateway.getApprovals(session.id)).toHaveLength(1)
        expect(await RunGateway.listArtifacts(session.id)).toHaveLength(1)

        await RunGateway.__testing.appendEvent(session.id, {
          type: "approval.resolved",
          payload: {
            approvalId: "apr_legacy",
            status: "approved",
            decision: "approve",
            source: "system",
            resolvedAt: new Date().toISOString(),
          },
        })
        await RunGateway.__testing.appendEvent(session.id, {
          type: "run.completed",
          payload: { status: "completed", summaryAvailable: true },
        })

        const completed = await RunGateway.getSnapshot(session.id)
        const summary = await RunGateway.getSummary(session.id)
        expect(completed.status).toBe("completed")
        expect(completed.terminalReason).toBe("workflow_completed")
        expect(summary.outcome?.result).toBe("success")
        expect(summary.approvalCount).toBe(1)
        expect(summary.artifactCount).toBeGreaterThanOrEqual(1)
      },
    })
  })
})
