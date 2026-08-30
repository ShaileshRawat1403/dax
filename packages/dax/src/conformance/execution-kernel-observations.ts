import { spyOn } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionSummary } from "@/session/summary"
import { LLM } from "@/session/llm"
import { Provider } from "@/provider/provider"
import { Plugin } from "@/plugin"
import { Truncate } from "@/tool/truncation"
import { Tool } from "@/tool/tool"
import { ToolRegistry } from "@/tool/registry"
import { Permission } from "@/governance"
import { NativeVerificationEffects } from "@/execution/native-verification"
import { RunFactory } from "@/execution/run-factory"
import { RAOAdapter } from "@/rao/adapters"
import { RunGateway } from "@/server/run-gateway"
import { WorkerRunEffects } from "@/workflows/worker-run"
import { getEventAuthorityState } from "@/state/events/event-transitions"
import { readRunEvents } from "@/state/events/run-event-store"
import type { RunEventEnvelope } from "@/state/events/run-event-types"
import type { CheckDefinition, CheckResult } from "@/sdlc/check-types"
import z from "zod"

export type ConformancePoint =
  | "contract_bound"
  | "input_validated"
  | "policy_emitted"
  | "approval_emitted"
  | "execution_emitted"
  | "output_validated"
  | "verification_emitted"
  | "completion_projected"

export const CONFORMANCE_POINTS: ConformancePoint[] = [
  "contract_bound",
  "input_validated",
  "policy_emitted",
  "approval_emitted",
  "execution_emitted",
  "output_validated",
  "verification_emitted",
  "completion_projected",
]

export type PointEvidence = {
  satisfied: boolean
  references: string[]
  note?: string
}

export type KernelObservation = {
  kernel: "native" | "worker"
  points: Record<ConformancePoint, PointEvidence>
  semantics: {
    positive: boolean
    failure: boolean
    incomplete: boolean
  }
  authorityConsumers?: {
    mutationEvidenceClaim: boolean
    touchedFiles: string[]
    completionScopeChecks: boolean
  }
}

const meterModel = Provider.Model.parse({
  id: "gpt-4o",
  providerID: "openai",
  api: { id: "gpt-4o", url: "https://example.invalid", npm: "@ai-sdk/openai" },
  name: "Execution meter model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 128_000, output: 4_096 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
})

function has(events: RunEventEnvelope[], type: RunEventEnvelope["type"]): boolean {
  return events.some((event) => event.type === type)
}

function first(events: RunEventEnvelope[], type: RunEventEnvelope["type"]): RunEventEnvelope | undefined {
  return events.find((event) => event.type === type)
}

function payload<T>(event: RunEventEnvelope | undefined): T | undefined {
  return event?.payload as T | undefined
}

async function waitFor<T>(read: () => Promise<T>, ready: (value: T) => boolean, label: string): Promise<T> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const value = await read()
    if (ready(value)) return value
    await Bun.sleep(10)
  }
  throw new Error(`timed out waiting for ${label}`)
}

function stream(parts: unknown[]): Awaited<ReturnType<typeof LLM.stream>> {
  return {
    fullStream: (async function* () {
      for (const part of parts) yield part
    })(),
  } as unknown as Awaited<ReturnType<typeof LLM.stream>>
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const process = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`)
  return stdout
}

async function initializeGitRepository(directory: string): Promise<void> {
  await fs.mkdir(path.join(directory, "src"), { recursive: true })
  await fs.writeFile(path.join(directory, "src", "base.ts"), "export const base = 1\n")
  await fs.writeFile(path.join(directory, "outside.txt"), "outside = 1\n")
  await runGit(directory, ["init"])
  await runGit(directory, ["add", "."])
  await runGit(directory, ["-c", "user.name=DAX Tests", "-c", "user.email=dax@example.invalid", "commit", "-m", "base"])
}

function passedCheck(check: CheckDefinition): CheckResult {
  const now = new Date().toISOString()
  return {
    id: check.id,
    kind: check.kind,
    label: check.label,
    command: [check.command, ...check.args].join(" "),
    cwd: check.cwd,
    required: check.required,
    risk: check.risk,
    exitCode: 0,
    status: "passed",
    startedAt: now,
    finishedAt: now,
    durationMs: 1,
    stdoutPreview: "",
    stderrPreview: "",
  }
}

function failedCheck(check: CheckDefinition): CheckResult {
  return { ...passedCheck(check), exitCode: 1, status: "failed", stderrPreview: "verification failed" }
}

async function withNativeModel<T>(
  implementation: (input: LLM.StreamInput) => Promise<Awaited<ReturnType<typeof LLM.stream>>>,
  run: () => Promise<T>,
): Promise<T> {
  const originalGetModel = Provider.getModel
  const getModel = spyOn(Provider, "getModel").mockImplementation(async (providerID, modelID) => {
    if (providerID === meterModel.providerID && modelID === meterModel.id) return meterModel
    return originalGetModel(providerID, modelID)
  })
  const summary = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
  const truncate = spyOn(Truncate, "output").mockResolvedValue({
    content: "validated meter output",
    truncated: false,
  })
  const trigger = spyOn(Plugin, "trigger").mockImplementation(async (_name, _input, output) => output)
  const llm = spyOn(LLM, "stream").mockImplementation(implementation)
  try {
    return await run()
  } finally {
    llm.mockRestore()
    trigger.mockRestore()
    truncate.mockRestore()
    summary.mockRestore()
    getModel.mockRestore()
    await Bun.sleep(25)
  }
}

async function seedSession(sessionID: string): Promise<void> {
  await SessionPrompt.prompt({
    sessionID,
    model: { providerID: meterModel.providerID, modelID: meterModel.id },
    parts: [{ type: "text", text: "Prepare the governed meter run." }],
    noReply: true,
  })
}

async function observeNativeApprovalAndMutation(project: string) {
  const target = path.join(project, "src", "native-meter.txt")
  const session = await Session.create({ title: "Native approval meter" })
  await Session.update(session.id, (draft) => {
    draft.permission = [{ permission: "edit", pattern: "*", action: "ask" }]
  })
  await seedSession(session.id)

  let modelCall = 0
  let writeReturned = false
  let writeOutput: unknown
  let unsubscribePermission: (() => void) | undefined
  const permissionAsked = new Promise<Permission.Request>((resolve) => {
    unsubscribePermission = Bus.subscribe(Permission.Event.Asked, (event) => {
      if (event.properties.sessionID !== session.id) return
      unsubscribePermission?.()
      resolve(event.properties)
    })
  })
  const prompt = withNativeModel(
    async (input) => {
      modelCall++
      if (modelCall === 1) {
        const write = input.tools.write
        if (!write?.execute) throw new Error("native write tool was not resolved")
        const args = { filePath: target, content: "native meter mutation\n" }
        writeOutput = await write.execute(args, {
          toolCallId: "call_native_meter_write",
          abortSignal: new AbortController().signal,
          messages: [],
        })
        writeReturned = true
        return stream([
          { type: "start" },
          { type: "tool-call", toolCallId: "call_native_meter_write", toolName: "write", input: args },
          { type: "tool-result", toolCallId: "call_native_meter_write", output: writeOutput },
          {
            type: "finish-step",
            finishReason: "tool-calls",
            usage: { inputTokens: 1, outputTokens: 1 },
            providerMetadata: {},
          },
          { type: "finish" },
        ])
      }
      return stream([
        { type: "start" },
        { type: "text-start" },
        { type: "text-delta", text: "The requested write ran." },
        { type: "text-end" },
        {
          type: "finish-step",
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1 },
          providerMetadata: {},
        },
        { type: "finish" },
      ])
    },
    () =>
      SessionPrompt.prompt({
        sessionID: session.id,
        model: { providerID: meterModel.providerID, modelID: meterModel.id },
        parts: [{ type: "text", text: "Write src/native-meter.txt and verify the mutation before completion." }],
      }),
  )

  const guardEvents = await waitFor(
    () => readRunEvents(session.id),
    (events) => has(events, "approval_requested"),
    "native runtime-guard approval",
  )
  const guardApprovalId = payload<{ approvalId: string }>(first(guardEvents, "approval_requested"))?.approvalId
  if (!guardApprovalId) throw new Error("native runtime-guard approval had no identity")
  const beforeApproval = guardEvents
  const targetExistsBeforeApproval = await Bun.file(target).exists()
  await RunGateway.resolveApproval(session.id, guardApprovalId, {
    decision: "approve",
    actorId: "two-kernel-meter",
    source: "api",
    comment: "Approve runtime-guard scope",
  })

  let request: Permission.Request | undefined
  for (let attempt = 0; attempt < 300 && !request; attempt++) {
    const observed = await Promise.race([
      permissionAsked.then((value) => ({ kind: "permission" as const, value })),
      Bun.sleep(10).then(() => ({ kind: "poll" as const })),
    ])
    if (observed.kind === "permission") {
      request = observed.value
      break
    }

    const pendingGuard = (await getEventAuthorityState(session.id))?.approvals.find(
      (item) => item.source === "system" && item.status === "pending",
    )
    if (!pendingGuard) continue
    await RunGateway.resolveApproval(session.id, pendingGuard.approvalId, {
      decision: "approve",
      actorId: "two-kernel-meter",
      source: "api",
      comment: "Approve runtime-guard scope",
    })
  }
  if (!request) throw new Error("timed out waiting for native permission approval")
  await Permission.reply({ requestID: request.id, reply: "once", message: "Approve exact native mutation" })
  await prompt
  unsubscribePermission?.()

  const events = await readRunEvents(session.id)
  const state = await getEventAuthorityState(session.id)
  const contract = await RunFactory.getContract(session.id)
  const persistedSession = await Session.get(session.id)
  const invocation = first(events, "tool_invocation_recorded")
  const authorization = first(events, "authorization_recorded")
  const result = first(events, "tool_result_recorded")
  const approval = first(events, "approval_requested")
  const approvalResolved = first(events, "approval_resolved")
  const mutation = first(events, "mutation_recorded")

  return {
    session,
    contract,
    persistedSession,
    events,
    state,
    writeReturned,
    targetExistsBeforeApproval,
    targetExistsAfterApproval: await Bun.file(target).exists(),
    invocation,
    authorization,
    result,
    approval,
    approvalResolved,
    mutation,
    noAuthorizationBeforeApproval: !has(beforeApproval, "authorization_recorded"),
    noResultBeforeApproval: !has(beforeApproval, "tool_result_recorded"),
    noMutationBeforeApproval: !has(beforeApproval, "mutation_recorded"),
  }
}

async function observeNativeReadOnlyCompletion() {
  const session = await Session.create({ title: "Native completion meter" })
  await seedSession(session.id)
  let writeExcluded = false
  await withNativeModel(
    async (input) => {
      writeExcluded = input.tools.write === undefined
      return stream([
        { type: "start" },
        { type: "text-start" },
        { type: "text-delta", text: "Read-only governed summary." },
        { type: "text-end" },
        {
          type: "finish-step",
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1 },
          providerMetadata: {},
        },
        { type: "finish" },
      ])
    },
    () =>
      SessionPrompt.prompt({
        sessionID: session.id,
        model: { providerID: meterModel.providerID, modelID: meterModel.id },
        parts: [{ type: "text", text: "Read only: return a concise governed summary." }],
      }),
  )
  const events = await readRunEvents(session.id)
  const contract = await RunFactory.getContract(session.id)
  return { events, contract, writeExcluded, state: await getEventAuthorityState(session.id) }
}

async function observeNativeToolBoundary(input: { mode: "allowed" | "input" | "output" | "denied" }) {
  const toolId = `native_meter_${input.mode}_${crypto.randomUUID().replaceAll("-", "")}`
  let bodyEntered = false
  let authorizationVisibleAtEntry = false
  let executorSessionID = ""
  await ToolRegistry.register(
    Tool.define(toolId, {
      description: `Native ${input.mode} boundary meter`,
      parameters: z.object({ value: z.string() }).strict(),
      result: Tool.result(z.object({ count: z.number().int() }).strict()),
      async execute() {
        bodyEntered = true
        if (input.mode === "allowed") {
          authorizationVisibleAtEntry = has(await readRunEvents(executorSessionID), "authorization_recorded")
        }
        if (input.mode === "output") {
          return {
            title: "domain-invalid",
            output: "generic transport remains valid",
            metadata: { count: "not-a-number" },
          } as unknown as { title: string; output: string; metadata: { count: number } }
        }
        return { title: "valid", output: "valid", metadata: { count: 1 } }
      },
    }),
  )

  const session = await Session.create({ title: `Native ${input.mode} meter` })
  executorSessionID = session.id
  await Session.update(session.id, (draft) => {
    draft.permission = [{ permission: toolId, pattern: "*", action: input.mode === "denied" ? "deny" : "allow" }]
  })
  await seedSession(session.id)
  let observedError: unknown

  await withNativeModel(
    async (modelInput) => {
      const tool = modelInput.tools[toolId]
      if (!tool?.execute) throw new Error(`${toolId} was not resolved`)
      try {
        await tool.execute(
          input.mode === "input" ? ({ value: 42 } as unknown as { value: string }) : { value: "valid" },
          {
            toolCallId: `call_${toolId}`,
            abortSignal: new AbortController().signal,
            messages: [],
          },
        )
      } catch (error) {
        observedError = error
      }
      return input.mode === "allowed"
        ? stream([
            { type: "start" },
            { type: "text-start" },
            { type: "text-delta", text: "Allowed boundary probe completed." },
            { type: "text-end" },
            {
              type: "finish-step",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1 },
              providerMetadata: {},
            },
            { type: "finish" },
          ])
        : stream([
            { type: "start" },
            { type: "error", error: observedError ?? new Error("expected boundary rejection") },
            { type: "finish" },
          ])
    },
    () =>
      SessionPrompt.prompt({
        sessionID: session.id,
        model: { providerID: meterModel.providerID, modelID: meterModel.id },
        parts: [{ type: "text", text: `Run ${toolId} for the governed boundary check.` }],
      }),
  )

  const events = await readRunEvents(session.id)
  return {
    bodyEntered,
    authorizationVisibleAtEntry,
    observedError,
    events,
    authorization: first(events, "authorization_recorded"),
    results: events.filter((event) => event.type === "tool_result_recorded"),
  }
}

export async function observeNativeKernel(root: string): Promise<KernelObservation> {
  const project = path.join(root, "native-project")
  await fs.mkdir(project, { recursive: true })
  await initializeGitRepository(project)
  await fs.writeFile(
    path.join(project, "package.json"),
    JSON.stringify({ scripts: { test: "bun test src/native-meter.test.ts" } }),
  )
  await fs.writeFile(path.join(project, "bun.lock"), "")
  await fs.writeFile(
    path.join(project, "src", "native-meter.test.ts"),
    'import { expect, test } from "bun:test"\ntest("native meter", () => expect(1).toBe(1))\n',
  )
  await runGit(project, ["add", "."])
  await runGit(project, ["-c", "user.name=DAX Tests", "-c", "user.email=dax@example.invalid", "commit", "-m", "checks"])
  await fs.mkdir(path.join(root, ".config", "dax"), { recursive: true })

  NativeVerificationEffects.set({ run: async (check) => passedCheck(check) })

  return Instance.provide({
    directory: project,
    async fn() {
      const positive = await observeNativeApprovalAndMutation(project)
      const completion = await observeNativeReadOnlyCompletion()
      const allowed = await observeNativeToolBoundary({ mode: "allowed" })
      const invalidInput = await observeNativeToolBoundary({ mode: "input" })
      const invalidOutput = await observeNativeToolBoundary({ mode: "output" })
      const denied = await observeNativeToolBoundary({ mode: "denied" })

      const invocationPayload = payload<{ invocationId: string; contractId: string }>(positive.invocation)
      const authorizationPayload = payload<{
        invocationId: string
        finalDisposition: string
        contractDisposition: string
        runtimeGuardDisposition: string
        permissionDisposition: string
        approvalIds: string[]
      }>(positive.authorization)
      const approvalPayload = payload<{ approvalId: string }>(positive.approval)
      const resultPayload = payload<{ invocationId: string; status: string }>(positive.result)
      const deniedAuthorization = payload<{ finalDisposition: string }>(denied.authorization)
      const invalidInputCompleted = invalidInput.results.some(
        (event) => payload<{ status: string }>(event)?.status === "completed",
      )
      const invalidOutputCompleted = invalidOutput.results.some(
        (event) => payload<{ status: string }>(event)?.status === "completed",
      )
      const verificationRequired = positive.contract?.runtimePolicy?.postconditions.verificationRequired === true
      const verificationRecorded = has(positive.events, "verification_recorded")
      const positiveResultEvent = first(positive.events, "tool_result_recorded")
      const positiveVerificationEvent = first(positive.events, "verification_recorded")
      const positiveCompletionEvent = first(positive.events, "run_completed")
      if (!positive.state) throw new Error("native mutation did not project canonical state")
      const raoState = RAOAdapter.toRAORunState(positive.state)

      return {
        kernel: "native" as const,
        points: {
          contract_bound: {
            satisfied:
              Boolean(positive.contract) &&
              positive.persistedSession.governingRunId === positive.session.id &&
              invocationPayload?.contractId === positive.contract?.contractId &&
              completion.writeExcluded,
            references: ["SessionPrompt.ensureCanonicalRunBirth", "contract_compiled", "tool_invocation_recorded.contractId"],
          },
          input_validated: {
            satisfied:
              Boolean(invalidInput.observedError) && !invalidInput.bodyEntered && !invalidInputCompleted,
            references: ["SessionPrompt.resolveTools", "Tool.parameters.parse", "tool_result_recorded:failed"],
          },
          policy_emitted: {
            satisfied:
              authorizationPayload?.finalDisposition === "allowed" &&
              authorizationPayload.contractDisposition === "allowed" &&
              authorizationPayload.runtimeGuardDisposition !== "not_evaluated" &&
              authorizationPayload.permissionDisposition === "approval_required" &&
              allowed.authorizationVisibleAtEntry &&
              positive.authorization!.seq < positive.result!.seq,
            references: ["authorization_recorded", "RuntimeGuard", "Permission"],
          },
          approval_emitted: {
            satisfied:
              Boolean(approvalPayload?.approvalId) &&
              has(positive.events, "approval_resolved") &&
              authorizationPayload?.approvalIds.includes(approvalPayload!.approvalId) === true &&
              positive.noAuthorizationBeforeApproval &&
              positive.noResultBeforeApproval &&
              positive.noMutationBeforeApproval &&
              !positive.targetExistsBeforeApproval &&
              positive.targetExistsAfterApproval,
            references: ["approval_requested", "approval_resolved", "authorization_recorded.approvalIds"],
          },
          execution_emitted: {
            satisfied:
              invocationPayload?.invocationId === resultPayload?.invocationId &&
              resultPayload?.status === "completed" &&
              Boolean(positive.mutation) &&
              positive.writeReturned &&
              deniedAuthorization?.finalDisposition === "denied" &&
              denied.results.length === 0,
            references: ["tool_invocation_recorded", "mutation_recorded", "tool_result_recorded"],
          },
          output_validated: {
            satisfied:
              invalidOutput.bodyEntered && Boolean(invalidOutput.observedError) && !invalidOutputCompleted,
            references: ["Tool.result.parse", "ToolResultValidationError", "tool_result_recorded:failed"],
          },
          verification_emitted: {
            satisfied:
              verificationRequired &&
              Boolean(positiveResultEvent) &&
              Boolean(positiveVerificationEvent) &&
              Boolean(positiveCompletionEvent) &&
              positiveResultEvent!.seq < positiveVerificationEvent!.seq &&
              positiveVerificationEvent!.seq < positiveCompletionEvent!.seq,
            references: verificationRecorded ? ["verification_recorded"] : [],
          },
          completion_projected: {
            satisfied:
              has(completion.events, "run_completed") &&
              completion.state?.status === "completed" &&
              has(positive.events, "run_completed") &&
              positive.state?.status === "completed",
            references: ["SessionPrompt", "native completion adjudication", "run_completed"],
          },
        },
        semantics: {
          positive: resultPayload?.status === "completed" && Boolean(positive.mutation),
          failure:
            invalidInput.results.some((event) => payload<{ status: string }>(event)?.status === "failed") &&
            invalidOutput.results.some((event) => payload<{ status: string }>(event)?.status === "failed") &&
            deniedAuthorization?.finalDisposition === "denied",
          incomplete:
            invalidOutput.results.some((event) => payload<{ status: string }>(event)?.status === "failed") &&
            !has(invalidOutput.events, "run_completed"),
        },
        authorityConsumers: {
          mutationEvidenceClaim: raoState.evidence.some((receipt) => receipt.source === "dax_mutation_ledger"),
          touchedFiles: positive.state.governance.touchedFiles,
          completionScopeChecks: positive.state.governance.completionProof?.scopeChecks === true,
        },
      }
    },
  }).finally(() => NativeVerificationEffects.reset())
}

type WorkerCase = {
  runId?: string
  workflowClass?: string
  events: RunEventEnvelope[]
  state?: Awaited<ReturnType<typeof getEventAuthorityState>>
  workerEntered: boolean
  policyVisibleAtEntry: boolean
  verificationCwd?: string
  expectedDiff?: string
  createError?: unknown
}

function workerRequest(repository: string, input?: {
  intent?: string
  providerHint?: string
  repoPath?: string
  writeScope?: unknown
}) {
  return {
    intent: {
      input: input?.intent ?? "Modify src/base.ts under the governed worker contract.",
      kind: "workflow_step" as const,
      repoPath: input?.repoPath === undefined ? repository : input.repoPath,
    },
    workflowHint: "worker_run" as const,
    personaPreset: { personaId: "governed-worker", providerHint: input?.providerHint ?? "worker:codex" },
    workerConstraints: {
      writeScope: (input?.writeScope ?? ["src/**"]) as string[],
      forbiddenPaths: ["package.json"],
      verification: ["bun test"],
      provenance: {
        writeScope: "operator-confirmed" as const,
        forbiddenPaths: "operator-authored" as const,
        verification: "operator-confirmed" as const,
      },
      egress: { filter: false },
    },
    metadata: { source: "api" as const, initiatedBy: "two-kernel-meter" },
  }
}

async function waitForRun(runId: string, predicate: (events: RunEventEnvelope[]) => boolean, label: string) {
  return waitFor(
    () => readRunEvents(runId),
    predicate,
    label,
  )
}

async function runWorkerCase(input: {
  repository: string
  request?: ReturnType<typeof workerRequest>
  write?: (checkout: string) => Promise<void>
  processExit?: number
  malformedProcess?: boolean
  verification?: "passed" | "failed"
  malformedPatch?: boolean
  hold?: { release?: (result: { exitCode: number; stdout: string; stderr: string }) => void }
}): Promise<WorkerCase> {
  let workerEntered = false
  let policyVisibleAtEntry = false
  let verificationCwd: string | undefined
  let expectedDiff: string | undefined

  WorkerRunEffects.reset()
  WorkerRunEffects.set({
    async runWorker(invocation, checkout) {
      workerEntered = true
      const entryEvents = await readRunEvents(invocation.env.DAX_RUN_ID!)
      policyVisibleAtEntry = has(entryEvents, "contract_compiled") && has(entryEvents, "contract_refined")
      if (input.hold) {
        return new Promise((resolve) => {
          input.hold!.release = resolve
        })
      }
      await input.write?.(checkout)
      expectedDiff = await runGit(checkout, ["diff"])
      return {
        exitCode: input.malformedProcess ? ("zero" as unknown as number) : (input.processExit ?? 0),
        stdout: "worker observed",
        stderr: input.processExit ? "worker failed" : "",
        sandboxProvider: "seatbelt",
        reapedDescendants: false,
      }
    },
    ...(input.malformedPatch
      ? {
          async computeDiff() {
            return {
              content: "diff --git a/src/base.ts b/src/base.ts\n+malformed",
              changedPaths: [42 as unknown as string],
            }
          },
        }
      : {}),
    async runVerification(check) {
      verificationCwd = check.cwd
      return input.verification === "failed" ? failedCheck(check) : passedCheck(check)
    },
  })

  let createError: unknown
  let created: Awaited<ReturnType<typeof RunGateway.createRun>> | undefined
  try {
    created = await RunGateway.createRun(input.request ?? workerRequest(input.repository))
  } catch (error) {
    createError = error
  }
  if (!created) {
    return { events: [], workerEntered, policyVisibleAtEntry, verificationCwd, expectedDiff, createError }
  }

  if (created.workflowClass !== "worker_run") {
    await waitFor(
      () => RunGateway.getSnapshot(created!.runId),
      (snapshot) => ["completed", "failed", "cancelled"].includes(snapshot.status),
      "non-worker fallback terminal state",
    )
    return {
      runId: created.runId,
      workflowClass: created.workflowClass,
      events: await readRunEvents(created.runId),
      state: await getEventAuthorityState(created.runId),
      workerEntered,
      policyVisibleAtEntry,
      verificationCwd,
      expectedDiff,
    }
  }

  if (input.hold) {
    const events = await waitForRun(
      created.runId,
      (items) => has(items, "contract_refined") && workerEntered && Boolean(input.hold?.release),
      "held worker entry",
    )
    return {
      runId: created.runId,
      workflowClass: created.workflowClass,
      events,
      state: await getEventAuthorityState(created.runId),
      workerEntered,
      policyVisibleAtEntry,
      verificationCwd,
      expectedDiff,
    }
  }

  const events = await waitForRun(
    created.runId,
    (items) =>
      has(items, "approval_requested") || has(items, "run_failed") || has(items, "workflow_completed"),
    "worker approval or terminal state",
  )
  return {
    runId: created.runId,
    workflowClass: created.workflowClass,
    events,
    state: await getEventAuthorityState(created.runId),
    workerEntered,
    policyVisibleAtEntry,
    verificationCwd,
    expectedDiff,
  }
}

async function resolveWorkerApproval(workerCase: WorkerCase, decision: "approve" | "deny") {
  const approval = first(workerCase.events, "approval_requested")
  const approvalId = payload<{ approvalId: string }>(approval)?.approvalId
  if (!workerCase.runId || !approvalId) throw new Error("worker case did not reach approval")
  await RunGateway.resolveApproval(workerCase.runId, approvalId, {
    decision,
    actorId: "two-kernel-meter",
    source: "api",
    comment: `${decision} observed patch`,
  })
  const events = await waitForRun(
    workerCase.runId,
    (items) => has(items, "workflow_completed") || has(items, "run_failed") || has(items, "approval_denied"),
    `worker approval ${decision}`,
  )
  return { events, state: await getEventAuthorityState(workerCase.runId) }
}

export async function observeWorkerKernel(root: string): Promise<KernelObservation> {
  const repository = path.join(root, "worker-project")
  await fs.mkdir(repository, { recursive: true })
  await initializeGitRepository(repository)

  return Instance.provide({
    directory: repository,
    async fn() {
      let invalidProviderEntered = false
      WorkerRunEffects.reset()
      WorkerRunEffects.set({
        async runWorker() {
          invalidProviderEntered = true
          return { exitCode: 0, stdout: "", stderr: "" }
        },
      })
      const invalidProvider = await RunGateway.createRun(
        workerRequest(repository, {
          intent: "Analyze this repository without selecting an unregistered worker.",
          providerHint: "worker:unknown",
        }),
      )
      await waitFor(
        () => RunGateway.getSnapshot(invalidProvider.runId),
        (snapshot) => ["completed", "failed", "cancelled"].includes(snapshot.status),
        "invalid provider fallback",
      )
      const invalidProviderEvents = await readRunEvents(invalidProvider.runId)

      const missingTask = await runWorkerCase({
        repository,
        request: workerRequest(repository, { intent: "" }),
      })
      const missingRepo = await runWorkerCase({
        repository,
        request: workerRequest(repository, { repoPath: "" }),
      })
      const malformedScope = await runWorkerCase({
        repository,
        request: workerRequest(repository, { writeScope: [42] }),
      })
      const emptyPatch = await runWorkerCase({ repository, write: async () => {} })
      const malformedPatch = await runWorkerCase({
        repository,
        malformedPatch: true,
        write: async (checkout) => {
          await fs.writeFile(path.join(checkout, "src", "base.ts"), "export const base = 9\n")
        },
      })
      const outOfScope = await runWorkerCase({
        repository,
        write: async (checkout) => {
          await fs.writeFile(path.join(checkout, "outside.txt"), "outside = 2\n")
        },
      })
      const failedProcess = await runWorkerCase({ repository, processExit: 7 })
      const malformedProcess = await runWorkerCase({ repository, malformedProcess: true })
      const failedVerification = await runWorkerCase({
        repository,
        verification: "failed",
        write: async (checkout) => {
          await fs.writeFile(path.join(checkout, "src", "base.ts"), "export const base = 3\n")
        },
      })
      const denied = await runWorkerCase({
        repository,
        write: async (checkout) => {
          await fs.writeFile(path.join(checkout, "src", "base.ts"), "export const base = 4\n")
        },
      })
      const deniedTerminal = await resolveWorkerApproval(denied, "deny")

      const approved = await runWorkerCase({
        repository,
        write: async (checkout) => {
          await fs.writeFile(path.join(checkout, "src", "base.ts"), "export const base = 5\n")
        },
      })
      const approvedTerminal = await resolveWorkerApproval(approved, "approve")

      const hold: { release?: (result: { exitCode: number; stdout: string; stderr: string }) => void } = {}
      const incomplete = await runWorkerCase({ repository, hold })
      const incompleteBeforeRelease = {
        state: incomplete.state,
        events: incomplete.events,
      }
      hold.release?.({ exitCode: 9, stdout: "", stderr: "crashed" })
      if (!incomplete.runId) throw new Error("held worker run was not created")
      const incompleteAfterRelease = await waitForRun(
        incomplete.runId,
        (events) => has(events, "run_failed"),
        "held worker failure",
      )

      const approvedEvents = approvedTerminal.events
      const contractCompiled = first(approvedEvents, "contract_compiled")
      const contractRefined = first(approvedEvents, "contract_refined")
      const mutation = first(approvedEvents, "mutation_recorded")
      const verification = first(approvedEvents, "verification_recorded")
      const approval = first(approvedEvents, "approval_requested")
      const approvalResolved = first(approvedEvents, "approval_resolved")
      const draft = first(approvedEvents, "draft_created")
      const mutationPayload = payload<{ changedPaths: string[] }>(mutation)
      const draftPayload = payload<{ content: string }>(draft)
      const verificationPayload = payload<{ status: string }>(verification)
      const failedVerificationPayload = payload<{ status: string }>(
        first(failedVerification.events, "verification_recorded"),
      )

      const invalidInputsRejected =
        invalidProvider.workflowClass === "worker_run" &&
        !invalidProviderEntered &&
        has(invalidProviderEvents, "run_failed") &&
        !missingTask.workerEntered &&
        !missingRepo.workerEntered &&
        !malformedScope.workerEntered &&
        (has(missingTask.events, "run_failed") || Boolean(missingTask.createError)) &&
        (has(missingRepo.events, "run_failed") || Boolean(missingRepo.createError)) &&
        (has(malformedScope.events, "run_failed") || Boolean(malformedScope.createError))

      return {
        kernel: "worker" as const,
        points: {
          contract_bound: {
            satisfied:
              Boolean(contractCompiled) &&
              Boolean(contractRefined) &&
              approved.policyVisibleAtEntry &&
              contractCompiled!.seq < contractRefined!.seq,
            references: ["RunGateway.createRun", "RunFactory", "contract_compiled", "contract_refined"],
          },
          input_validated: {
            satisfied: invalidInputsRejected,
            references: ["production workflow selection", "ExternalWorkerId", "WorkerContract.parse"],
            note: invalidInputsRejected
              ? undefined
              : "An explicit worker_run request with an unknown worker provider falls back to generic native execution instead of being rejected.",
          },
          policy_emitted: {
            satisfied:
              approved.policyVisibleAtEntry &&
              has(outOfScope.events, "contract_refined") &&
              has(outOfScope.events, "run_failed") &&
              !has(outOfScope.events, "mutation_recorded"),
            references: ["contract_refined", "worker scope enforcement", "run_failed"],
          },
          approval_emitted: {
            satisfied:
              Boolean(approval) &&
              Boolean(approvalResolved) &&
              draftPayload?.content === approved.expectedDiff &&
              has(deniedTerminal.events, "approval_denied") &&
              !has(deniedTerminal.events, "workflow_completed") &&
              deniedTerminal.state?.status === "failed",
            references: ["draft_created", "approval_requested", "approval_resolved", "approval_denied"],
          },
          execution_emitted: {
            satisfied:
              Boolean(mutation) &&
              mutationPayload?.changedPaths.join(",") === "src/base.ts" &&
              has(failedProcess.events, "step_failed") &&
              has(failedProcess.events, "run_failed") &&
              !has(failedProcess.events, "mutation_recorded") &&
              incompleteBeforeRelease.state?.status === "running" &&
              !has(incompleteBeforeRelease.events, "mutation_recorded") &&
              !has(incompleteBeforeRelease.events, "run_failed") &&
              !has(incompleteBeforeRelease.events, "workflow_completed") &&
              has(incompleteAfterRelease, "run_failed"),
            references: ["mutation_recorded", "step_failed", "run_failed"],
          },
          output_validated: {
            satisfied:
              has(malformedProcess.events, "run_failed") &&
              !has(malformedProcess.events, "mutation_recorded") &&
              has(malformedPatch.events, "run_failed") &&
              !has(malformedPatch.events, "mutation_recorded"),
            references: [
              "WorkerProcessResultSchema",
              "WorkerPatchSchema",
              "Git staged diff",
              "mutation_recorded",
            ],
          },
          verification_emitted: {
            satisfied:
              verificationPayload?.status === "passed" &&
              Boolean(approved.verificationCwd?.includes(".dax/worker-checkouts/")) &&
              failedVerificationPayload?.status === "failed" &&
              !has(failedVerification.events, "approval_requested") &&
              !has(failedVerification.events, "workflow_completed"),
            references: ["verification_recorded", "worker checkout cwd", "run_failed"],
          },
          completion_projected: {
            satisfied:
              has(approvedTerminal.events, "workflow_completed") &&
              approvedTerminal.state?.status === "completed" &&
              first(approvedTerminal.events, "workflow_completed")!.seq > first(approvedTerminal.events, "approval_resolved")!.seq &&
              !has(deniedTerminal.events, "workflow_completed") &&
              !has(failedVerification.events, "workflow_completed") &&
              !has(emptyPatch.events, "workflow_completed"),
            references: ["workflow_completed", "approval_resolved", "canonical run projection"],
          },
        },
        semantics: {
          positive: Boolean(mutation) && approvedTerminal.state?.status === "completed",
          failure:
            has(failedProcess.events, "run_failed") &&
            has(malformedProcess.events, "run_failed") &&
            has(failedVerification.events, "run_failed") &&
            has(emptyPatch.events, "run_failed") &&
            has(malformedPatch.events, "run_failed") &&
            has(outOfScope.events, "run_failed") &&
            deniedTerminal.state?.status === "failed",
          incomplete:
            incompleteBeforeRelease.state?.status === "running" &&
            !has(incompleteBeforeRelease.events, "run_failed") &&
            !has(incompleteBeforeRelease.events, "workflow_completed"),
        },
      }
    },
  }).finally(() => WorkerRunEffects.reset())
}
