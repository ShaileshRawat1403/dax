import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { mkdirSync, rmSync } from "node:fs"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Storage } from "@/storage/storage"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian } from "@/execution/contract-guardian"
import { createMutationReceipt } from "@/sdlc/mutation-receipt"
import {
  addApprovalEvent,
  appendEventOnly,
  createEventAuthorityRun,
  recordAuthorization,
  recordNativeMutation,
  recordToolInvocation,
  resolveApprovalEvent,
  transitionEventAuthority,
} from "@/state/events/event-transitions"
import { readRunEvents, setRunAuthority } from "@/state/events/run-event-store"
import { createEvent } from "@/state/events/run-event-types"
import { RunGateway } from "./run-gateway"

let testHome = ""
let previousTestHome: string | undefined

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  testHome = path.join(os.tmpdir(), `dax-inspector-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

async function createCanonicalRun(options?: { worker?: boolean }) {
  const session = await Session.create({ title: "Canonical inspector" })
  const { contract } = compileWithRunId(
    {
      request: {
        intent: { input: "Inspect canonical authority only." },
        ...(options?.worker
          ? {
              workflowHint: "worker_run" as const,
              personaPreset: { personaId: "worker", providerHint: "worker:codex" },
            }
          : {}),
      },
    },
    session.id,
  )
  await ContractGuardian.create(session.id, contract)
  await createEventAuthorityRun(session.id, contract.contractId)
  await transitionEventAuthority(session.id, "queued", "execution_queued", {})
  await transitionEventAuthority(session.id, "running", "execution_started", {})
  return { runId: session.id, contract }
}

function completionProof(decision: "pass" | "fail") {
  return {
    decision,
    failedChecks: decision === "fail" ? ["missing_verification"] : [],
    verificationExecuted: decision === "pass",
    receiptIds: [],
    artifactChecks: true,
    expectedOutputChecks: true,
    expectedOutputTypesSatisfied: [],
    expectedOutputTypesMissing: [],
    scopeChecks: true,
    sensitivePathApprovalChecks: true,
    checkedAt: "2026-01-01T00:00:00.000Z",
  }
}

describe("RunGateway canonical inspector projection", () => {
  test("reads a single canonical snapshot, preserves full approval history, and keeps raw previews out of chronology", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { runId, contract } = await createCanonicalRun()
        await addApprovalEvent(runId, "apr_resolved", {
          title: "Review change",
          reason: "governed action",
          source: "permission",
          context: { toolName: "shell", command: "bun test", notes: ["operator-visible basis"] },
        })
        await resolveApprovalEvent(runId, "apr_resolved", "approved", "operator")
        await addApprovalEvent(runId, "apr_pending", { title: "Review another change", reason: "governed action" })
        await resolveApprovalEvent(runId, "apr_pending", "approved", "operator")

        await recordToolInvocation(runId, "inv_1", {
          toolId: "shell",
          contractId: contract.contractId,
          executor: { kind: "builtin", id: "shell" },
          input: {
            basis: "validated_tool_input",
            canonicalization: "sorted-json-v1",
            digest: `sha256:${"a".repeat(64)}`,
            redactedPreview: "SECRET_PREVIEW_MUST_NOT_ENTER_CHRONOLOGY",
            truncated: false,
          },
        })
        await recordAuthorization(runId, "inv_1", {
          finalDisposition: "allowed",
          contractDisposition: "allowed",
          runtimeGuardDisposition: "allowed",
          permissionDisposition: "allowed",
          approvalIds: [],
          reasonCodes: [],
        })

        const projection = await RunGateway.getInspectorProjection(runId)

        expect(projection.kind).toBe("canonical")
        if (projection.kind !== "canonical") throw new Error("expected canonical inspector")
        expect(projection.canonicalStatus).toBe("running")
        expect(projection.authority).toMatchObject({ source: "event-log", validated: true })
        expect(projection.authority.eventSequence).toBe((await readRunEvents(runId)).at(-1)!.seq)
        expect(projection.approvals.map((approval) => approval.approvalId)).toEqual(["apr_resolved", "apr_pending"])
        expect(projection.approvals.map((approval) => approval.status)).toEqual(["approved", "approved"])
        expect(projection.approvals[0]).toMatchObject({
          source: "permission",
          context: { toolName: "shell", command: "bun test", notes: ["operator-visible basis"] },
        })
        expect(projection.durableAuthorization.items[0]?.inputCommitment?.redactedPreview).toContain("SECRET_PREVIEW")
        expect(JSON.stringify(projection.chronology)).not.toContain("SECRET_PREVIEW")
        expect(projection.uncertainty).toContainEqual({ code: "unresolved_invocations", subjectIds: ["inv_1"] })
        expect(projection.completion.integrityWarning).toBeNull()
      },
    })
  })

  test("returns authority_unreadable for a canonical log without its authority marker", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const runId = "run_unmarked"
        const event = createEvent(runId, 0, "contract_compiled", { contractId: "ctr_unmarked" })
        await Storage.write(["run_events", Instance.project.id, runId, "events.json"], [event])

        expect(await RunGateway.getInspectorProjection(runId)).toEqual({
          schemaVersion: "run-inspector.v1",
          kind: "authority_unreadable",
          runId,
          reason: "authority_marker_missing",
        })
      },
    })
  })

  test("projects native mutation and verification attestations without leaking them into chronology", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { runId, contract } = await createCanonicalRun()
        await recordToolInvocation(runId, "inv_mutate", {
          toolId: "edit",
          contractId: contract.contractId,
          executor: { kind: "builtin", id: "edit" },
          input: {
            basis: "validated_tool_input",
            canonicalization: "sorted-json-v1",
            digest: `sha256:${"c".repeat(64)}`,
            redactedPreview: "native-input-secret",
            truncated: false,
          },
        })
        await recordAuthorization(runId, "inv_mutate", {
          finalDisposition: "allowed",
          contractDisposition: "allowed",
          runtimeGuardDisposition: "allowed",
          permissionDisposition: "allowed",
          approvalIds: [],
          reasonCodes: [],
        })
        const mutation = createMutationReceipt({ runId, changedPaths: ["src/secret-safe.ts"], diff: "diff content" })
        await recordNativeMutation(runId, mutation, ["inv_mutate"])
        await appendEventOnly(runId, "verification_recorded", {
          status: "passed",
          receipts: [
            {
              schemaVersion: "dax.sdlc.receipt.v1",
              receiptId: "rcpt_verify",
              runId,
              claim: "typecheck passed",
              proofType: "command_result",
              source: "dax",
              checkId: "typecheck",
              status: "passed",
              command: "bun run typecheck",
              cwd: ".",
              durationMs: 42,
              verifiedAt: "2026-01-01T00:00:00.000Z",
              digest: "d".repeat(64),
            },
            { receiptId: "rcpt_historical" },
          ],
          checks: [
            {
              id: "typecheck",
              kind: "typecheck",
              label: "Typecheck",
              command: "bun run typecheck",
              cwd: ".",
              required: true,
              risk: "low",
              exitCode: 0,
              status: "passed",
              startedAt: "2026-01-01T00:00:00.000Z",
              finishedAt: "2026-01-01T00:00:01.000Z",
              durationMs: 1000,
              stdoutPreview: "ok",
              stderrPreview: "",
            },
          ],
        })

        const projection = await RunGateway.getInspectorProjection(runId)
        expect(projection.kind).toBe("canonical")
        if (projection.kind !== "canonical") throw new Error("expected canonical inspector")
        expect(projection.mutationEvidence.items[0]).toMatchObject({
          kind: "attested",
          receiptId: mutation.receiptId,
          observationWindowInvocationIds: ["inv_mutate"],
          digest: mutation.digest,
        })
        expect(projection.verificationEvidence.checks[0]).toMatchObject({
          label: "Typecheck",
          command: "bun run typecheck",
          durationMs: 1000,
        })
        expect(projection.verificationEvidence.receipts).toContainEqual({
          kind: "receipt_id_only",
          receiptId: "rcpt_historical",
        })
        expect(JSON.stringify(projection.chronology)).not.toContain("native-input-secret")
        expect(JSON.stringify(projection.chronology)).not.toContain("bun run typecheck")
      },
    })
  })

  test("reports legacy authority as unsupported instead of reading session state", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const runId = "run_legacy"
        await setRunAuthority(runId, "legacy")

        expect(await RunGateway.getInspectorProjection(runId)).toEqual({
          schemaVersion: "run-inspector.v1",
          kind: "legacy_unsupported",
          runId,
          reason: "legacy_authority",
        })
      },
    })
  })

  test("reports an ungoverned run without canonical authority as unsupported", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        expect(await RunGateway.getInspectorProjection("run_ungoverned")).toEqual({
          schemaVersion: "run-inspector.v1",
          kind: "legacy_unsupported",
          runId: "run_ungoverned",
          reason: "no_canonical_authority",
        })
      },
    })
  })

  test("marks worker action detail as coarse while preserving canonical worker evidence", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { runId } = await createCanonicalRun({ worker: true })
        await appendEventOnly(runId, "contract_refined", {
          writeScope: ["src/**"],
          forbiddenPaths: [".env"],
          verification: ["bun test"],
          provenance: { writeScope: "operator-authored" },
        })
        await appendEventOnly(runId, "worker_sandbox_recorded", {
          provider: "seatbelt",
          providerId: "worker_1",
          filesystem: "checkout-write-only",
          network: "none",
          reapedDescendants: true,
          egress: "filtered",
          egressEnforcement: "cooperative-proxy",
          egressAllowHosts: ["api.example.test"],
        })
        await appendEventOnly(runId, "worker_egress_denied", {
          providerId: "worker_1",
          hosts: ["blocked.example.test"],
        })

        const projection = await RunGateway.getInspectorProjection(runId)
        expect(projection.kind).toBe("canonical")
        if (projection.kind !== "canonical") throw new Error("expected canonical inspector")
        expect(projection.workerEvidence.sandbox).toMatchObject({
          provider: "seatbelt",
          reapedDescendants: true,
          egressAllowHosts: { values: ["api.example.test"], omittedCount: 0 },
        })
        expect(projection.workerEvidence.egressDenials).toEqual([
          { providerId: "worker_1", hosts: ["blocked.example.test"], hostsOmittedCount: 0 },
        ])
        expect(projection.uncertainty).toContainEqual({
          code: "worker_action_details_unavailable",
          detail: "Canonical evidence records governed invocations and receipts, not worker-internal actions.",
        })
      },
    })
  })

  test("does not silently treat malformed event-authority history as legacy", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { runId } = await createCanonicalRun()
        await Storage.write(["run_events", Instance.project.id, runId, "events.json"], [{ malformed: true }])

        expect(await RunGateway.getInspectorProjection(runId)).toEqual({
          schemaVersion: "run-inspector.v1",
          kind: "authority_unreadable",
          runId,
          reason: "canonical_log_unreadable",
        })
      },
    })
  })

  test("treats missing and mismatched immutable contracts as unreadable canonical authority", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const missing = await createCanonicalRun()
        await Storage.remove(["execution_contract", Instance.project.id, missing.runId])
        expect(await RunGateway.getInspectorProjection(missing.runId)).toMatchObject({
          kind: "authority_unreadable",
          reason: "execution_contract_missing",
        })

        const mismatched = await createCanonicalRun()
        await Storage.write(["execution_contract", Instance.project.id, mismatched.runId], {
          ...mismatched.contract,
          contractId: "ctr_mismatched",
        })
        expect(await RunGateway.getInspectorProjection(mismatched.runId)).toMatchObject({
          kind: "authority_unreadable",
          reason: "execution_contract_mismatch",
        })
      },
    })
  })

  test("marks completed canonical state without a generic proof as an integrity warning", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { runId } = await createCanonicalRun()
        await transitionEventAuthority(runId, "completed", "run_completed", {})

        const projection = await RunGateway.getInspectorProjection(runId)
        expect(projection.kind).toBe("canonical")
        if (projection.kind !== "canonical") throw new Error("expected canonical inspector")
        expect(projection.canonicalStatus).toBe("completed")
        expect(projection.completion.genericCompletionProof).toBeNull()
        expect(projection.completion.integrityWarning).toBe("completed_without_generic_completion_proof")
        expect(projection.uncertainty).toContainEqual({ code: "completed_without_generic_completion_proof" })
      },
    })
  })

  test("distinguishes completed passing and failing generic completion proofs", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const passing = await createCanonicalRun()
        await transitionEventAuthority(passing.runId, "completed", "run_completed", {
          completionProof: completionProof("pass"),
        })
        const failing = await createCanonicalRun()
        await transitionEventAuthority(failing.runId, "completed", "run_completed", {
          completionProof: completionProof("fail"),
        })

        const passingProjection = await RunGateway.getInspectorProjection(passing.runId)
        const failingProjection = await RunGateway.getInspectorProjection(failing.runId)
        expect(passingProjection.kind).toBe("canonical")
        expect(failingProjection.kind).toBe("canonical")
        if (passingProjection.kind !== "canonical" || failingProjection.kind !== "canonical") {
          throw new Error("expected canonical inspectors")
        }
        expect(passingProjection.completion.integrityWarning).toBeNull()
        expect(failingProjection.completion.integrityWarning).toBe("completed_with_failing_generic_completion_proof")
        expect(failingProjection.uncertainty).toContainEqual({
          code: "completed_with_failing_generic_completion_proof",
        })
      },
    })
  })

  test("keeps workflow completion evidence distinct from a generic proof on the same terminal event", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { runId } = await createCanonicalRun()
        await transitionEventAuthority(runId, "completed", "workflow_signed_off", {
          completionProof: completionProof("pass"),
        })

        const projection = await RunGateway.getInspectorProjection(runId)
        expect(projection.kind).toBe("canonical")
        if (projection.kind !== "canonical") throw new Error("expected canonical inspector")
        expect(projection.completion.workflowSpecificEvidence).toMatchObject({
          eventType: "workflow_signed_off",
        })
        expect(projection.completion.genericCompletionProof).toMatchObject({ decision: "pass" })
        expect(projection.completion.integrityWarning).toBeNull()
      },
    })
  })
})
