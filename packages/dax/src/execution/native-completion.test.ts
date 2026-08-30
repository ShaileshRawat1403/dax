import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { mkdirSync, rmSync } from "node:fs"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import { compileWithRunId } from "./compiler"
import { ContractGuardian } from "./contract-guardian"
import { computeCanonicalCommitment } from "./canonical-commitment"
import { adjudicateNativeCompletionCandidate } from "./native-completion"
import { RunCompletionBlockedError, RunLifecycle } from "@/state/run-lifecycle"
import {
  addApprovalEvent,
  appendEventOnly,
  createEventAuthorityRun,
  getEventAuthorityState,
  recordAuthorization,
  recordToolInvocation,
  resolveApprovalEvent,
  transitionEventAuthority,
} from "@/state/events/event-transitions"
import { readRunEvents } from "@/state/events/run-event-store"
import type { ExecutionContract } from "./execution-contract"
import { NativeVerificationEffects } from "./native-verification"
import type { CheckDefinition, CheckResult } from "@/sdlc/check-types"

let testHome = ""
let previousTestHome: string | undefined

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  testHome = path.join(os.tmpdir(), `dax-native-completion-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  process.env.DAX_TEST_HOME = testHome
  mkdirSync(testHome, { recursive: true })
  await Instance.disposeAll()
  NativeVerificationEffects.reset()
})

afterEach(async () => {
  NativeVerificationEffects.reset()
  await Instance.disposeAll()
  if (previousTestHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousTestHome
  rmSync(testHome, { recursive: true, force: true })
})

async function createNativeRun(input?: {
  expectedOutputs?: ExecutionContract["expectedOutputs"]
  verificationRequired?: boolean
  validationCommands?: string[]
}) {
  const session = await Session.create({ title: "Native completion candidate" })
  const { contract } = compileWithRunId(
    { request: { intent: { input: "Return a governed execution summary." } } },
    session.id,
  )
  contract.expectedOutputs = input?.expectedOutputs ?? [{ type: "summary", description: "Execution summary" }]
  contract.runtimePolicy = {
    ...contract.runtimePolicy!,
    scope: { targetFiles: [], targetSubsystems: [], avoidAreas: [] },
    postconditions: {
      verificationRequired: input?.verificationRequired ?? false,
      validationPlan: input?.verificationRequired ? ["Collect evidence"] : [],
      validationCommands: input?.verificationRequired ? (input.validationCommands ?? ["bun test"]) : [],
    },
  }

  await ContractGuardian.create(session.id, contract)
  await Session.bindGoverningRun(session.id, session.id)
  await createEventAuthorityRun(session.id, contract.contractId, input?.verificationRequired ?? false, "warn")
  await transitionEventAuthority(session.id, "queued", "execution_queued", {})
  await transitionEventAuthority(session.id, "running", "execution_started", {})
  return { session, contract }
}

function checkResult(check: CheckDefinition, status: "passed" | "failed"): CheckResult {
  const now = new Date().toISOString()
  return {
    id: check.id,
    kind: check.kind,
    label: check.label,
    command: [check.command, ...check.args].join(" "),
    cwd: check.cwd,
    required: check.required,
    risk: check.risk,
    exitCode: status === "passed" ? 0 : 1,
    status,
    startedAt: now,
    finishedAt: now,
    durationMs: 1,
    stdoutPreview: status === "passed" ? "verified" : "",
    stderrPreview: status === "failed" ? "verification failed" : "",
  }
}

async function createAssistantCandidate(sessionID: string, text = "Governed work is complete.") {
  const messageID = Identifier.ascending("message")
  await Session.updateMessage({
    id: messageID,
    parentID: Identifier.ascending("message"),
    role: "assistant",
    mode: "build",
    agent: "build",
    path: { cwd: testHome, root: testHome },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: "test-model",
    providerID: "test-provider",
    time: { created: Date.now(), completed: Date.now() },
    sessionID,
    finish: "stop",
  })
  if (text) {
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID,
      sessionID,
      type: "text",
      text,
      time: { start: Date.now(), end: Date.now() },
    })
  }
  return messageID
}

async function recordInvocation(runId: string, contractId: string, invocationId: string) {
  const input = await computeCanonicalCommitment({ path: "README.md" })
  await recordToolInvocation(runId, invocationId, {
    toolId: "read",
    input: { basis: "validated_tool_input", ...input },
    contractId,
    executor: { kind: "builtin", id: "read" },
  })
}

async function recordPassedVerification(runId: string, status: "passed" | "failed" = "passed") {
  await appendEventOnly(runId, "verification_recorded", {
    status,
    receipts: [{ receiptId: `verification_${status}` }],
    checks: [],
  })
}

describe("native canonical completion", () => {
  test("finish stop completes only after required verification and expected output evidence pass", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { session } = await createNativeRun({ verificationRequired: true })
        await recordPassedVerification(session.id)
        const messageID = await createAssistantCandidate(session.id)

        const decision = await adjudicateNativeCompletionCandidate({
          sessionID: session.id,
          assistantMessageID: messageID,
          finishReason: "stop",
        })

        expect(decision).toMatchObject({ candidate: true, accepted: true, runId: session.id })
        const state = await getEventAuthorityState(session.id)
        expect(state?.status).toBe("completed")
        expect(state?.governance.completionProof).toMatchObject({
          decision: "pass",
          verificationExecuted: true,
          expectedOutputTypesSatisfied: ["summary"],
        })
        const completed = (await readRunEvents(session.id)).find((event) => event.type === "run_completed")
        expect(completed?.payload).toMatchObject({ completionProof: { decision: "pass" } })
      },
    })
  })

  test("provider stop executes the complete contract verification plan before completion", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const executed: string[] = []
        NativeVerificationEffects.set({
          async run(check) {
            executed.push([check.command, ...check.args].join(" "))
            return checkResult(check, "passed")
          },
        })
        const { session } = await createNativeRun({
          verificationRequired: true,
          validationCommands: ["bun run typecheck", "bun test"],
        })

        const decision = await adjudicateNativeCompletionCandidate({
          sessionID: session.id,
          assistantMessageID: await createAssistantCandidate(session.id),
          finishReason: "stop",
        })

        expect(decision).toMatchObject({ accepted: true, reasonCodes: [] })
        expect(executed).toEqual(["bun run typecheck", "bun test"])
        const events = await readRunEvents(session.id)
        const verification = events.find((event) => event.type === "verification_recorded")
        const completed = events.find((event) => event.type === "run_completed")
        expect(verification?.payload).toMatchObject({ status: "passed" })
        expect((verification?.payload as { checks: CheckResult[] }).checks.map((check) => check.command)).toEqual(
          executed,
        )
        expect(verification!.seq).toBeLessThan(completed!.seq)
      },
    })
  })

  test("an authorized invocation without a terminal result rejects completion", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { session, contract } = await createNativeRun()
        await recordInvocation(session.id, contract.contractId, "call_authorized")
        await recordAuthorization(session.id, "call_authorized", {
          finalDisposition: "allowed",
          contractDisposition: "allowed",
          runtimeGuardDisposition: "allowed",
          permissionDisposition: "allowed",
          approvalIds: [],
          reasonCodes: [],
        })

        const decision = await adjudicateNativeCompletionCandidate({
          sessionID: session.id,
          assistantMessageID: await createAssistantCandidate(session.id),
          finishReason: "stop",
        })

        expect(decision).toMatchObject({ candidate: true, accepted: false })
        expect(decision.reasonCodes).toContain("invocation_missing_result:call_authorized")
        expect((await getEventAuthorityState(session.id))?.status).toBe("running")
      },
    })
  })

  test("an invocation awaiting authorization rejects completion", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { session, contract } = await createNativeRun()
        await recordInvocation(session.id, contract.contractId, "call_waiting")

        const decision = await adjudicateNativeCompletionCandidate({
          sessionID: session.id,
          assistantMessageID: await createAssistantCandidate(session.id),
          finishReason: "stop",
        })

        expect(decision.reasonCodes).toContain("invocation_awaiting_authorization:call_waiting")
        expect((await getEventAuthorityState(session.id))?.status).toBe("running")
      },
    })
  })

  test("an unresolved approval rejects completion", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { session } = await createNativeRun()
        await addApprovalEvent(session.id, "apr_pending", { title: "Pending human decision" })

        const decision = await adjudicateNativeCompletionCandidate({
          sessionID: session.id,
          assistantMessageID: await createAssistantCandidate(session.id),
          finishReason: "stop",
        })

        expect(decision.reasonCodes).toContain("approval_pending:apr_pending")
        expect((await getEventAuthorityState(session.id))?.status).toBe("waiting_approval")
      },
    })
  })

  test("a rejected approval cannot become successful completion", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { session } = await createNativeRun()
        await addApprovalEvent(session.id, "apr_denied", { title: "Denied human decision" })
        await resolveApprovalEvent(session.id, "apr_denied", "rejected", "operator")

        const decision = await adjudicateNativeCompletionCandidate({
          sessionID: session.id,
          assistantMessageID: await createAssistantCandidate(session.id),
          finishReason: "stop",
        })

        expect(decision.reasonCodes).toContain("approval_not_approved:rejected:apr_denied")
        expect((await getEventAuthorityState(session.id))?.status).toBe("running")
      },
    })
  })

  test("missing expected output rejects completion and records the existing governance requirement", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { session } = await createNativeRun({
          expectedOutputs: [{ type: "file", description: "Changed file" }],
        })

        const decision = await adjudicateNativeCompletionCandidate({
          sessionID: session.id,
          assistantMessageID: await createAssistantCandidate(session.id),
          finishReason: "stop",
        })

        expect(decision.reasonCodes).toContain("completion_proof:missing_expected_outputs")
        const state = await getEventAuthorityState(session.id)
        expect(state?.status).toBe("waiting_approval")
        expect(state?.approvals).toContainEqual(
          expect.objectContaining({
            status: "pending",
            source: "system",
            context: expect.objectContaining({ notes: expect.arrayContaining(["missing_expected_outputs"]) }),
          }),
        )
      },
    })
  })

  test("a required contract with no executable validation plan rejects completion", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { session } = await createNativeRun({ verificationRequired: true, validationCommands: [] })

        const decision = await adjudicateNativeCompletionCandidate({
          sessionID: session.id,
          assistantMessageID: await createAssistantCandidate(session.id),
          finishReason: "stop",
        })

        expect(decision.reasonCodes).toContain("completion_proof:missing_verification")
        expect((await getEventAuthorityState(session.id))?.status).toBe("waiting_approval")
      },
    })
  })

  test("an actually failed contract verification rejects completion", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        NativeVerificationEffects.set({ run: async (check) => checkResult(check, "failed") })
        const { session } = await createNativeRun({ verificationRequired: true })

        const decision = await adjudicateNativeCompletionCandidate({
          sessionID: session.id,
          assistantMessageID: await createAssistantCandidate(session.id),
          finishReason: "stop",
        })

        expect(decision.reasonCodes).toContain("completion_proof:missing_verification")
        const events = await readRunEvents(session.id)
        expect(events.find((event) => event.type === "verification_recorded")?.payload).toMatchObject({
          status: "failed",
        })
        expect(events.some((event) => event.type === "run_completed")).toBe(false)
        expect((await getEventAuthorityState(session.id))?.status).toBe("waiting_approval")
      },
    })
  })

  test("tool-calls finish reason is not an objective completion candidate", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { session } = await createNativeRun()
        const decision = await adjudicateNativeCompletionCandidate({
          sessionID: session.id,
          assistantMessageID: await createAssistantCandidate(session.id),
          finishReason: "tool-calls",
        })

        expect(decision).toMatchObject({ candidate: false, accepted: false })
        expect((await getEventAuthorityState(session.id))?.status).toBe("running")
      },
    })
  })

  test("a provider or session error cannot become successful completion", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { session } = await createNativeRun()
        const decision = await adjudicateNativeCompletionCandidate({
          sessionID: session.id,
          assistantMessageID: await createAssistantCandidate(session.id),
          finishReason: "stop",
          hasError: true,
        })

        expect(decision.reasonCodes).toContain("provider_or_session_error")
        expect((await getEventAuthorityState(session.id))?.status).toBe("running")
      },
    })
  })

  test("strict completion blocks with a stable reason when the execution contract is missing", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const session = await Session.create({ title: "Missing completion contract" })
        await createEventAuthorityRun(session.id, "ctr_missing", false, "warn")
        await transitionEventAuthority(session.id, "queued", "execution_queued", {})
        await transitionEventAuthority(session.id, "running", "execution_started", {})

        const error = await RunLifecycle.transition(session.id, "completed", "run_completed", {}, {
          requirePassingCompletionProof: true,
        }).catch((cause) => cause)

        expect(error).toBeInstanceOf(RunCompletionBlockedError)
        expect((error as RunCompletionBlockedError).failedChecks).toEqual(["missing_execution_contract"])
        expect((await getEventAuthorityState(session.id))?.status).toBe("running")
        expect((await readRunEvents(session.id)).some((event) => event.type === "run_completed")).toBe(false)
      },
    })
  })

  test("strict completion blocks with a stable reason when canonical state is missing", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const session = await Session.create({ title: "Missing canonical completion state" })
        const { contract } = compileWithRunId(
          { request: { intent: { input: "Prove completion." } } },
          session.id,
        )
        await ContractGuardian.create(session.id, contract)

        const error = await RunLifecycle.transition(session.id, "completed", "run_completed", {}, {
          requirePassingCompletionProof: true,
        }).catch((cause) => cause)

        expect(error).toBeInstanceOf(RunCompletionBlockedError)
        expect((error as RunCompletionBlockedError).failedChecks).toEqual(["missing_canonical_state"])
        expect((await readRunEvents(session.id)).some((event) => event.type === "run_completed")).toBe(false)
      },
    })
  })

  test("contract corruption propagates through strict completion without recording run_completed", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { session } = await createNativeRun()
        await Storage.write(["execution_contract", Instance.project.id, session.id], { malformed: true })

        const completion = RunLifecycle.transition(session.id, "completed", "run_completed", {}, {
          requirePassingCompletionProof: true,
        })

        await expect(completion).rejects.toThrow(/Invalid ExecutionContract/i)
        expect((await getEventAuthorityState(session.id))?.status).toBe("running")
        expect((await readRunEvents(session.id)).some((event) => event.type === "run_completed")).toBe(false)
      },
    })
  })

  test("a genuinely ungoverned historical session safely declines canonical completion", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const session = await Session.create({ title: "Historical ungoverned session" })
        const decision = await adjudicateNativeCompletionCandidate({
          sessionID: session.id,
          assistantMessageID: await createAssistantCandidate(session.id),
          finishReason: "stop",
        })

        expect(decision).toEqual({ candidate: true, accepted: false, reasonCodes: ["ungoverned_session"] })
      },
    })
  })

  test("an unbound historical contract without event authority safely declines canonical completion", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const session = await Session.create({ title: "Historical non-canonical session" })
        const { contract } = compileWithRunId(
          { request: { intent: { input: "Historical governed execution." } } },
          session.id,
        )
        await ContractGuardian.create(session.id, contract)

        const decision = await adjudicateNativeCompletionCandidate({
          sessionID: session.id,
          assistantMessageID: await createAssistantCandidate(session.id),
          finishReason: "stop",
        })

        expect(decision).toEqual({
          candidate: true,
          accepted: false,
          runId: session.id,
          reasonCodes: ["non_canonical_authority:missing"],
        })
        expect((await readRunEvents(session.id)).some((event) => event.type === "run_completed")).toBe(false)
      },
    })
  })

  test("explicit broken governing authority still propagates instead of becoming compatibility", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const session = await Session.create({ title: "Broken explicit authority" })
        await Session.bindGoverningRun(session.id, "ses_missing_native_completion_authority")

        const completion = adjudicateNativeCompletionCandidate({
          sessionID: session.id,
          assistantMessageID: await createAssistantCandidate(session.id),
          finishReason: "stop",
        })

        await expect(completion).rejects.toThrow(/Governing ExecutionContract not found/i)
      },
    })
  })

  test("legacy Session state cannot satisfy missing canonical verification", async () => {
    await Instance.provide({
      directory: testHome,
      async fn() {
        const { session } = await createNativeRun({ verificationRequired: true, validationCommands: [] })
        await Session.update(session.id, (draft) => {
          draft.state_v2 = {
            activity_timeline: [],
            approvals: [],
            artifacts: [{ id: "legacy_summary", kind: "summary", metadata: {}, created_at: Date.now() }],
            audit_findings: [],
            completion_proof: {
              decision: "pass",
              failedChecks: [],
              verificationExecuted: true,
              receiptIds: ["legacy_receipt"],
              artifactChecks: true,
              expectedOutputChecks: true,
              expectedOutputTypesSatisfied: ["summary"],
              expectedOutputTypesMissing: [],
              scopeChecks: true,
              sensitivePathApprovalChecks: true,
              checkedAt: new Date().toISOString(),
            },
          }
        })

        const decision = await adjudicateNativeCompletionCandidate({
          sessionID: session.id,
          assistantMessageID: await createAssistantCandidate(session.id),
          finishReason: "stop",
        })

        expect(decision.reasonCodes).toContain("completion_proof:missing_verification")
        expect((await getEventAuthorityState(session.id))?.status).toBe("waiting_approval")
      },
    })
  })
})
