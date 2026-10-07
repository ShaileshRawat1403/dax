/** Genuine compiled production modules; no image, authority, dispatch or provider spies. */
import assert from "node:assert/strict"
import z from "zod"
import { Tool } from "@/tool/tool"
import { ToolRegistry } from "@/tool/registry"
import { WorkflowRegistry } from "@/workflows/registry"
import { verifyWorkerPatch } from "@/worker/worker-verification"
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Global } from "@/global"
import { AgentCommand } from "@/cli/cmd/debug/agent"
import { verifySdlc } from "@/sdlc/verify-session"
import { GrantReviewBarrierError } from "@/execution/grant-review-barrier"
import { Config } from "@/config/config"
import { GrantReview } from "@/capability/grant-review"
import { daxExecutable } from "@/capability/implementation-binding"
import { CapabilityActionDeniedError, recordActionResolution } from "@/capability/record-resolution"
import { mcpReadDescriptor } from "@/mcp/resource-identity"
import { ExecutionContractV2 } from "@/execution/execution-contract"
import { ContractGuardian, readContract } from "@/execution/contract-guardian"
import { adjudicateNativeCompletionCandidate } from "@/execution/native-completion"
import { supersededReviewApprovals } from "@/state/events/grant-review-supersession"
import { createGrantReviewedRun } from "@/execution/run-factory"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { resolveApprovalEvent, transitionEventAuthority } from "@/state/events/event-transitions"
import { appendRunEventAtTail, projectRunStateFromEvents, readRunEvents } from "@/state/events/run-event-store"
import { reduceRunState } from "@/state/events/run-reducer"
import { Storage } from "@/storage/storage"
import { Hono } from "hono"
import { RunRoutes } from "@/server/routes/run"
import { subjectKey } from "@/capability/grant-proposal"
import { CreateRunResponse } from "@/server/run-contract"
import { runGraph } from "@/execution/run-graph"
import { createTaskGraph, addTask } from "@/planner/task-graph"
import { OperatorRouter } from "@/operators/router"
import { RunGrantReview, RunBadRequestError, ReviewedRunRefusal } from "@/capability/reviewed-run-contract"

declare const DAX_PRODUCER_VARIANT: string
const home = process.argv[2]!
const phase = process.argv[3]!
const directory = path.join(home, "project")
const evidence = path.join(directory, "evidence.txt")
const sentinel = path.join(directory, "shell-effect")
let providerCalls = 0
let interruptedRunId: string | undefined
async function controlledMcp() {
  const calls = { tool: 0, resource: 0, prompt: 0 }
  const sessions = new Map<string, { protocol: McpServer; transport: WebStandardStreamableHTTPServerTransport }>()
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const id = request.headers.get("mcp-session-id")
      let session = id ? sessions.get(id) : undefined
      if (!session && !id && request.method === "POST") {
        const protocol = new McpServer(
          { name: "compiled controlled MCP", version: "1" },
          { capabilities: { tools: {}, resources: {}, prompts: {} } },
        )
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: false,
        })
        protocol.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: [{ name: "probe", description: "Controlled effect", inputSchema: { type: "object", properties: {} } }],
        }))
        protocol.setRequestHandler(CallToolRequestSchema, async () => {
          calls.tool++
          return { content: [{ type: "text", text: "MCP tool effect" }] }
        })
        protocol.setRequestHandler(ListResourcesRequestSchema, async () => ({
          resources: [{ name: "private fixture", uri: "fixture://private-resource", mimeType: "text/plain" }],
        }))
        protocol.setRequestHandler(ReadResourceRequestSchema, async (request) => {
          calls.resource++
          return { contents: [{ uri: request.params.uri, mimeType: "text/plain", text: "MCP resource effect" }] }
        })
        protocol.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: "private-prompt" }] }))
        protocol.setRequestHandler(GetPromptRequestSchema, async () => {
          calls.prompt++
          return { messages: [{ role: "user", content: { type: "text", text: "MCP prompt effect" } }] }
        })
        await protocol.connect(transport)
        session = { protocol, transport }
        const response = await transport.handleRequest(request)
        sessions.set(transport.sessionId!, session)
        return response
      }
      return session ? session.transport.handleRequest(request) : new Response("Unknown MCP session", { status: 404 })
    },
  })
  return {
    calls,
    config: { type: "remote" as const, url: `http://127.0.0.1:${http.port}/mcp`, oauth: false, timeout: 3000 },
    async close() {
      await Promise.all([...sessions.values()].map(({ protocol }) => protocol.close()))
      await http.stop(true)
    },
  }
}
const mcpFixtures = ["mcp", "ask"].includes(phase)
  ? { gamma: await controlledMcp(), delta: await controlledMcp() }
  : undefined
async function awaitRunCompletion(runId: string) {
  const deadline = Date.now() + 30_000
  while (true) {
    const state = await projectRunStateFromEvents(runId)
    if (state?.status === "completed" && SessionStatus.get(runId).type === "idle") return state
    assert.ok(
      state && !["failed", "cancelled"].includes(state.status),
      `Run terminated before completion: ${JSON.stringify(state)}`,
    )
    assert.ok(
      Date.now() < deadline,
      `Completion deadline exceeded: ${JSON.stringify({ state, activity: SessionStatus.get(runId), providerCalls })}`,
    )
    await Bun.sleep(25)
  }
}
const model = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const input = (await request.json()) as {
      messages: { role: string; content: unknown }[]
      tools?: { function?: { name?: string } }[]
    }
    providerCalls++
    console.error(
      "model request",
      providerCalls,
      input.messages.map((m) => m.role),
    )
    const userIndex = input.messages.findLastIndex((message) => message.role === "user")
    const latestUser = JSON.stringify(input.messages[userIndex]?.content ?? "")
    const hasResult = input.messages.slice(userIndex + 1).some((message) => message.role === "tool")
    const offers = (name: string) => input.tools?.some((tool) => tool.function?.name === name) === true
    const mcpAlias = ["gamma_probe", "delta_probe"].find(
      (name) => offers(name) && latestUser.includes(`PRODUCER_MCP_${name}`),
    )
    if (phase === "kill-open" && interruptedRunId && offers("read") && latestUser.includes("PRODUCER_KILL_OPEN")) {
      const ready = path.join(home, "process-interruption-ready.json")
      await fs.writeFile(`${ready}.tmp`, JSON.stringify({ runId: interruptedRunId, providerCalls }))
      await fs.rename(`${ready}.tmp`, ready)
      // The parent test kills this owned process while the actual provider
      // dispatch is pending. No graceful cancellation or settlement runs.
      return await new Promise<Response>(() => {})
    }
    const wantsUnbound = latestUser.includes("PRODUCER_UNBOUND") && offers("owned_unbound") && !hasResult
    const wantsMcp = !!mcpAlias && !hasResult
    const wantsBatch = latestUser.includes("PRODUCER_BATCH") && offers("batch") && !hasResult
    const wantsTask = latestUser.includes("PRODUCER_TASK_") && offers("task") && !hasResult
    const wantsRead = latestUser.includes("PRODUCER_READ") && offers("read") && !hasResult
    const taskId = latestUser.match(/PRODUCER_TASK_RESUME (ses_[a-zA-Z0-9_-]+)/)?.[1]
    const choice = wantsUnbound
      ? {
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `call_unbound_${providerCalls}`,
                type: "function",
                function: { name: "owned_unbound", arguments: "{}" },
              },
            ],
          },
          finish_reason: null,
        }
      : wantsBatch
        ? {
            delta: {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: `call_batch_${providerCalls}`,
                  type: "function",
                  function: {
                    name: "batch",
                    arguments: JSON.stringify({
                      tool_calls: [
                        { tool: "read", parameters: { filePath: evidence } },
                        {
                          tool: "write",
                          parameters: { filePath: path.join(directory, "batch-forbidden"), content: "must not write" },
                        },
                      ],
                    }),
                  },
                },
              ],
            },
            finish_reason: null,
          }
        : wantsMcp
          ? {
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: `call_mcp_${providerCalls}`,
                    type: "function",
                    function: { name: mcpAlias, arguments: "{}" },
                  },
                ],
              },
              finish_reason: null,
            }
          : wantsTask
            ? {
                delta: {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: `call_task_${providerCalls}`,
                      type: "function",
                      function: {
                        name: "task",
                        arguments: JSON.stringify({
                          description: "Inspect controlled evidence",
                          prompt: "PRODUCER_READ: inspect the evidence file.",
                          subagent_type: latestUser.includes("PRODUCER_TASK_UNKNOWN")
                            ? "deliberately_missing_agent"
                            : "general",
                          ...(taskId ? { task_id: taskId } : {}),
                        }),
                      },
                    },
                  ],
                },
                finish_reason: null,
              }
            : wantsRead
              ? {
                  delta: {
                    role: "assistant",
                    tool_calls: [
                      {
                        index: 0,
                        id: `call_read_${providerCalls}`,
                        type: "function",
                        function: { name: "read", arguments: JSON.stringify({ filePath: evidence }) },
                      },
                    ],
                  },
                  finish_reason: null,
                }
              : { delta: { role: "assistant", content: "Evidence inspected." }, finish_reason: null }
    const finish = wantsUnbound || wantsBatch || wantsMcp || wantsTask || wantsRead ? "tool_calls" : "stop"
    const data =
      [choice, { delta: {}, finish_reason: finish }]
        .map(
          (item) =>
            `data: ${JSON.stringify({ id: "chat_probe", object: "chat.completion.chunk", created: 1, model: "probe", choices: [{ index: 0, ...item }] })}\n\n`,
        )
        .join("") + "data: [DONE]\n\n"
    return new Response(data, { headers: { "content-type": "text/event-stream" } })
  },
})
await fs.mkdir(path.join(home, ".config", "dax"), { recursive: true })
if (phase !== "api-start-child")
  await fs.writeFile(
    path.join(home, ".config", "dax", "dax.json"),
    JSON.stringify({
      enabled_providers: ["stage4d"],
      model: "stage4d/probe",
      small_model: "stage4d/probe",
      provider: {
        stage4d: {
          npm: "@ai-sdk/openai-compatible",
          name: "Local deterministic fixture",
          options: { baseURL: `http://127.0.0.1:${model.port}/v1` },
          models: { probe: { name: "Fixture", limit: { context: 8192, output: 2048 }, tool_call: true } },
        },
      },
      permission: { "*": "allow" },
      ...(phase === "paths"
        ? {
            experimental: { batch_tool: true },
            command: { guarded: { template: "!`bun -e \"require('fs').writeFileSync('command-forbidden', 'ran')\"`" } },
          }
        : {}),
      mcp: mcpFixtures
        ? { gamma: mcpFixtures.gamma.config, delta: mcpFixtures.delta.config }
        : { gamma: { type: "remote", url: "http://127.0.0.1:9/fixture", enabled: false } },
    }),
  )
await fs.mkdir(directory, { recursive: true })
if (!(await fs.stat(path.join(directory, ".git")).catch(() => undefined)))
  assert.equal(Bun.spawnSync(["git", "init", "--quiet", directory]).exitCode, 0)
await fs.writeFile(evidence, "D1 compiled producer evidence\n")
Config.global.reset()
const modelSelection = { providerID: "stage4d", modelID: "probe" }
const controls: string[] = []
const request = { intent: { input: "Inspect the repository, read only." }, workflowHint: "generic" as const }
async function create(native = true) {
  return createGrantReviewedRun(
    { request, availableTools: ["read"] },
    native
      ? { writeScope: { roots: ["."], reviewed: true } }
      : {
          acknowledgedExternal: ["mcp_source:resource:gamma", "mcp_source:prompt:gamma"],
          sourceSelections: [
            { server: "gamma", family: "resource" },
            { server: "gamma", family: "prompt" },
          ],
        },
  )
}
async function approve(created: Awaited<ReturnType<typeof create>>) {
  await resolveApprovalEvent(created.runId, created.revision.approvalId, "approved", "fixture-operator")
}
async function publish(created: Awaited<ReturnType<typeof create>>) {
  const subject = (await readRunEvents(created.runId)).find((e) => e.type === "approval_requested")!.payload as {
    contractGrantSubject: unknown
  }
  await GrantReview.publish(created.runId, {
    approvalId: created.revision.approvalId,
    subject: subject.contractGrantSubject,
  })
}
async function active(native = true) {
  const created = await create(native)
  await approve(created)
  await publish(created)
  await GrantReview.activate(created.runId)
  return created
}
const textPrompt = (runId: string, text = "Inspect evidence.") =>
  SessionPrompt.prompt({
    sessionID: runId,
    model: modelSelection,
    completionPolicy: "explicit",
    parts: [{ type: "text", text }],
  })
async function blocked(runId: string, label: string) {
  const before = await Session.messages({ sessionID: runId })
  const calls = providerCalls
  await assert.rejects(readContract(runId))
  await assert.rejects(GrantReview.dispatchAuthority(runId))
  await assert.rejects(textPrompt(runId))
  await assert.rejects(SessionPrompt.loop({ sessionID: runId }))
  await assert.rejects(SessionPrompt.command({ sessionID: runId, command: "pm", arguments: "list" }))
  await assert.rejects(SessionPrompt.shell({ sessionID: runId, agent: "build", command: `touch '${sentinel}'` }))
  assert.equal(providerCalls, calls)
  assert.equal((await Session.messages({ sessionID: runId })).length, before.length)
  assert.equal(
    await fs.stat(sentinel).then(
      () => true,
      () => false,
    ),
    false,
  )
  const journalKey = ["run_events", Instance.project.id, runId, "events.json"]
  const rawBefore = await Storage.read<unknown>(journalKey)
  await assert.rejects(
    recordActionResolution({
      governedBy: { runId },
      subject: "barrier-direct-read",
      path: "mcp_resource",
      initiator: "operator",
      executor: {
        kind: "mcp",
        alias: "resource",
        descriptor: mcpReadDescriptor("resource", "gamma", "file:///private"),
      },
      source: { server: "gamma", name: "file:///private" },
    }),
    (error) => error instanceof GrantReviewBarrierError || error instanceof CapabilityActionDeniedError,
  )
  assert.deepEqual(await Storage.read<unknown>(journalKey), rawBefore)
  controls.push(label)
  console.error("barrier control", label)
}
async function checkArtifactMutation(change: (value: any) => void, label: string) {
  const { runId } = await active()
  const key = ["grant_review_published", Instance.project.id, runId]
  const artifact = await Storage.read<any>(key)
  change(artifact)
  await Storage.write(key, artifact)
  await blocked(runId, label)
}
async function checkJournalMutation(change: (value: any[]) => void, label: string, native = true) {
  const { runId } = await active(native)
  const key = ["run_events", Instance.project.id, runId, "events.json"]
  const events = await Storage.read<any[]>(key)
  change(events)
  await Storage.write(key, events)
  await blocked(runId, label)
}
try {
  await Instance.provide({
    directory,
    fn: async () => {
      if (phase === "api-start-child") {
        const { runId, expected } = JSON.parse(process.argv[4]!)
        const app = new Hono().route("/runs", RunRoutes())
        const response = await app.request(`http://dax.internal/runs/${runId}/grant-review/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expected }),
        })
        const result = await response.json()
        assert.ok([200, 409].includes(response.status), JSON.stringify(result))
        if (response.status === 200) {
          for (let index = 0; index < 400; index++) {
            const messages = await Session.messages({ sessionID: runId })
            if (
              SessionStatus.get(runId).type === "idle" &&
              messages.some((message) => message.info.role === "assistant")
            )
              break
            await new Promise((resolve) => setTimeout(resolve, 25))
          }
          assert.equal(SessionStatus.get(runId).type, "idle")
          assert.ok((await Session.messages({ sessionID: runId })).some((message) => message.info.role === "assistant"))
        }
        controls.push(`api-cross-process-start-${response.status}`)
      } else if (phase === "unsupported") {
        const effect = path.join(directory, "unbound-tool-effect")
        await ToolRegistry.register(
          Tool.define("owned_unbound", {
            description: "Owned unbound execution control",
            parameters: z.object({}),
            result: Tool.result(z.object({})),
            async execute() {
              await fs.writeFile(effect, "must never run")
              return { title: "owned", output: "executed", metadata: {} }
            },
          }),
        )
        const reviewed = await createGrantReviewedRun(
          { request, availableTools: ["owned_unbound", "read"] },
          { writeScope: { roots: ["."], reviewed: true } },
        )
        assert.ok(reviewed.revision.proposal.excluded.some((item) => item.alias === "owned_unbound"))
        await approve(reviewed)
        await publish(reviewed)
        await GrantReview.activate(reviewed.runId)
        await GrantReview.claimStart(reviewed.runId, (await GrantReview.inspect(reviewed.runId)).expected)
        await textPrompt(reviewed.runId, "PRODUCER_UNBOUND: invoke the owned custom tool.")
        const state = (await projectRunStateFromEvents(reviewed.runId))!
        assert.ok(
          state.capabilityResolutions.some(
            (item) => item.path === "native_tool" && item.decision === "deny" && item.enforcement === "enforced",
          ),
        )
        assert.equal(await fs.exists(effect), false)
        assert.deepEqual(reduceRunState(await readRunEvents(reviewed.runId)), state)
        controls.push("compiled-custom-tool-attempt-durable-denial-zero-effect")

        const verification = await active()
        await GrantReview.claimStart(verification.runId, (await GrantReview.inspect(verification.runId)).expected)
        const verifyEffect = path.join(directory, "worker-verification-effect")
        await fs.writeFile(
          path.join(directory, "package.json"),
          JSON.stringify({
            name: "owned-verification",
            scripts: { test: "bun -e \"require('fs').writeFileSync('worker-verification-effect','ran')\"" },
          }),
        )
        await assert.rejects(
          verifyWorkerPatch({ runId: verification.runId, cwd: directory, commands: ["bun run test"] }),
          CapabilityActionDeniedError,
        )
        const verifyState = (await projectRunStateFromEvents(verification.runId))!
        assert.ok(
          verifyState.capabilityResolutions.some(
            (item) =>
              item.path === "verification_command" && item.enforcement === "enforced" && item.decision === "deny",
          ),
        )
        assert.equal(await fs.exists(verifyEffect), false)
        assert.deepEqual(reduceRunState(await readRunEvents(verification.runId)), verifyState)
        controls.push("compiled-worker-verification-denial-before-command")

        for (const workflowClass of WorkflowRegistry.list()) {
          const created = await createGrantReviewedRun({
            request: {
              intent: {
                input:
                  workflowClass === "draft_and_approve"
                    ? "Create a controlled draft"
                    : workflowClass === "review_and_signoff"
                      ? "Review controlled code"
                      : "Inspect controlled repository",
              },
              workflowHint: workflowClass,
              ...(workflowClass === "worker_run" ? { personaPreset: { providerHint: "worker:codex" } } : {}),
            },
            availableTools: ["read"],
          })
          assert.equal(created.revision.proposal.candidate.workflowClass, workflowClass)
          const before = await readRunEvents(created.runId)
          const calls = providerCalls
          const workflow = WorkflowRegistry.create(workflowClass, {
            runId: created.runId,
            contract: created.revision.proposal.candidate as never,
          })!
          await assert.rejects(workflow.execute(), GrantReviewBarrierError)
          assert.equal(providerCalls, calls)
          assert.deepEqual(await readRunEvents(created.runId), before)
          assert.equal((await Session.messages({ sessionID: created.runId })).length, 0)
          const projected = (await projectRunStateFromEvents(created.runId))!
          assert.equal(Object.keys(projected.steps).length, 0)
          assert.deepEqual(reduceRunState(before), projected)
          controls.push(`compiled-pending-${workflowClass}-refusal-before-steps`)
        }
      } else if (phase === "paths") {
        const make = async (tools = ["read"]) => {
          const reviewed = await createGrantReviewedRun(
            { request, availableTools: tools },
            { writeScope: { roots: ["."], reviewed: true } },
          )
          await approve(reviewed)
          await publish(reviewed)
          await GrantReview.activate(reviewed.runId)
          await GrantReview.claimStart(reviewed.runId, (await GrantReview.inspect(reviewed.runId)).expected)
          return reviewed.runId
        }
        const shellRun = await make()
        await assert.rejects(
          SessionPrompt.shell({
            sessionID: shellRun,
            agent: "build",
            model: modelSelection,
            command: "bun -e \"require('fs').writeFileSync('shell-forbidden', 'ran')\"",
          }),
        )
        assert.equal(
          await fs.stat(path.join(directory, "shell-forbidden")).then(
            () => true,
            () => false,
          ),
          false,
        )
        assert.ok(
          (await readRunEvents(shellRun)).some(
            (event) =>
              event.type === "capability_resolution_recorded" &&
              event.payload.path === "operator_shell" &&
              event.payload.decision === "deny" &&
              event.payload.enforcement === "enforced",
          ),
        )
        controls.push("compiled-operator-shell-denial-before-process-effect")
        const commandRun = await make()
        await assert.rejects(
          SessionPrompt.command({ sessionID: commandRun, command: "guarded", arguments: "", model: "stage4d/probe" }),
        )
        assert.equal(
          await fs.stat(path.join(directory, "command-forbidden")).then(
            () => true,
            () => false,
          ),
          false,
        )
        assert.ok(
          (await readRunEvents(commandRun)).some(
            (event) =>
              event.type === "capability_resolution_recorded" &&
              event.payload.path === "command_shell" &&
              event.payload.decision === "deny" &&
              event.payload.enforcement === "enforced",
          ),
        )
        controls.push("compiled-command-shell-denial-before-snippet-effect")
        const contextRun = await make()
        const parts = await SessionPrompt.resolvePromptParts("@evidence.txt", {
          sessionID: contextRun,
          initiator: "operator",
        })
        assert.ok(parts.some((part) => part.type === "file" && part.url === pathToFileURL(evidence).href))
        await SessionPrompt.prompt({
          sessionID: contextRun,
          model: modelSelection,
          completionPolicy: "explicit",
          parts: [
            { type: "text", text: "Inspect the attached evidence" },
            { type: "file", filename: "evidence.txt", mime: "text/plain", url: pathToFileURL(evidence).href },
          ],
        })
        assert.ok(
          (await Session.messages({ sessionID: contextRun })).some((message) =>
            message.parts.some((part) => part.type === "text" && part.text.includes("D1 compiled producer evidence")),
          ),
        )
        const contextEvents = await readRunEvents(contextRun)
        for (const actionPath of ["template_reference", "context_attachment"])
          assert.ok(
            contextEvents.some(
              (event) =>
                event.type === "capability_resolution_recorded" &&
                event.payload.path === actionPath &&
                event.payload.decision === "allow" &&
                event.payload.enforcement === "enforced",
            ),
          )
        assert.deepEqual(reduceRunState(contextEvents), await projectRunStateFromEvents(contextRun))
        controls.push("compiled-template-and-attachment-real-content-and-replay")
        const batchRun = await make(["batch", "read"])
        await textPrompt(batchRun, "PRODUCER_BATCH")
        const batchState = (await projectRunStateFromEvents(batchRun))!
        assert.ok(
          Object.values(batchState.invocations).some(
            (invocation) => invocation.toolId === "read" && invocation.status === "completed",
          ),
        )
        assert.ok(
          Object.values(batchState.invocations).some(
            (invocation) => invocation.toolId === "write" && invocation.status === "denied",
          ),
        )
        assert.ok(
          batchState.capabilityResolutions.some(
            (resolution) =>
              resolution.path === "batch_leaf" &&
              resolution.decision === "deny" &&
              resolution.enforcement === "enforced",
          ),
        )
        assert.equal(
          await fs.stat(path.join(directory, "batch-forbidden")).then(
            () => true,
            () => false,
          ),
          false,
        )
        assert.deepEqual(reduceRunState(await readRunEvents(batchRun)), batchState)
        controls.push("compiled-batch-allowed-read-and-denied-write-zero-effect")
      } else if (phase === "debug") {
        const before = []
        for await (const session of Session.list()) before.push(session.id)
        const cwd = process.cwd()
        try {
          process.chdir(directory)
          const handler = AgentCommand.handler
          assert.equal(typeof handler, "function")
          await handler!({
            name: "build",
            tool: "read",
            params: JSON.stringify({ filePath: evidence }),
            _: [],
            $0: "dax",
          } as Parameters<NonNullable<typeof AgentCommand.handler>>[0])
        } finally {
          process.chdir(cwd)
        }
        const created = []
        for await (const session of Session.list()) if (!before.includes(session.id)) created.push(session)
        assert.equal(created.length, 1)
        assert.equal(created[0]!.governingRunId, undefined)
        assert.equal(await readContract(created[0]!.id), null)
        assert.deepEqual(await readRunEvents(created[0]!.id), [])
        assert.equal(providerCalls, 0)
        controls.push("compiled-debug-handler-real-read-explicit-no-contract")
      } else if (phase === "identity") {
        for (const field of ["projectID", "id"] as const) {
          const reviewed = await active()
          await GrantReview.claimStart(reviewed.runId, (await GrantReview.inspect(reviewed.runId)).expected)
          const info = await Session.get(reviewed.runId)
          const before = await readRunEvents(reviewed.runId)
          const calls = providerCalls
          const other = await active()
          await Storage.write(["session", Instance.project.id, reviewed.runId], {
            ...info,
            [field]: field === "id" ? other.runId : "foreign-owner",
          })
          try {
            const error = await textPrompt(reviewed.runId, "PRODUCER_READ").then(
              () => undefined,
              (error) => error,
            )
            assert.equal(
              error?.code,
              "session_identity_mismatch",
              JSON.stringify({
                field,
                error: error?.message,
                modelCalls: providerCalls - calls,
                newEvents: (await readRunEvents(reviewed.runId)).length - before.length,
              }),
            )
            assert.equal(providerCalls, calls)
            assert.deepEqual(await readRunEvents(reviewed.runId), before)
          } finally {
            await Storage.write(["session", Instance.project.id, reviewed.runId], info)
          }
          assert.equal((await Session.get(reviewed.runId)).id, reviewed.runId)
          controls.push(`compiled-session-${field}-mismatch-before-model-and-journal`)
        }
        const pending = await create()
        const other = await active()
        await GrantReview.claimStart(other.runId, (await GrantReview.inspect(other.runId)).expected)
        const info = await Session.get(pending.runId)
        const beforePending = await readRunEvents(pending.runId)
        const beforeOther = await readRunEvents(other.runId)
        const calls = providerCalls
        await Storage.write(["session", Instance.project.id, pending.runId], { ...info, governingRunId: other.runId })
        try {
          const error = await textPrompt(pending.runId, "PRODUCER_READ").then(
            () => undefined,
            (error) => error,
          )
          assert.equal(
            error?.code,
            "session_authority_mismatch",
            JSON.stringify({
              error: error?.message,
              modelCalls: providerCalls - calls,
              borrowedRootEvents: (await readRunEvents(other.runId)).length - beforeOther.length,
            }),
          )
          assert.equal(providerCalls, calls)
          assert.deepEqual(await readRunEvents(pending.runId), beforePending)
          assert.deepEqual(await readRunEvents(other.runId), beforeOther)
        } finally {
          await Storage.write(["session", Instance.project.id, pending.runId], info)
        }
        controls.push("compiled-owned-pending-review-cannot-borrow-another-root")
      } else if (phase === "ask") {
        assert.ok(mcpFixtures)
        process.env.DAX_GRANT_ASK_TIMEOUT_MS = "20000"
        const app = new Hono().route("/runs", RunRoutes())
        const make = async () => {
          const reviewed = await createGrantReviewedRun(
            { request, availableTools: ["gamma_probe"] },
            {
              acknowledgedExternal: ["mcp_source:tool:gamma"],
              sourceSelections: [{ server: "gamma", family: "tool" }],
              askSubjects: ["mcp_source:tool:gamma"],
            },
          )
          await approve(reviewed)
          await publish(reviewed)
          await GrantReview.activate(reviewed.runId)
          await GrantReview.claimStart(reviewed.runId, (await GrantReview.inspect(reviewed.runId)).expected)
          return reviewed.runId
        }
        const pendingAsk = async (runId: string) => {
          const deadline = Date.now() + 10_000
          while (Date.now() < deadline) {
            const state = (await projectRunStateFromEvents(runId))!
            const ask = state.approvals.find(
              (approval) => approval.approvalType === "capability_grant_ask" && approval.status === "pending",
            )
            if (ask) return ask
            await Bun.sleep(10)
          }
          throw new Error("Actual tool dispatch did not request operator approval")
        }
        const answer = async (runId: string, approvalId: string, decision: "approve" | "deny", remember = false) => {
          const response = await app.request(`http://dax.internal/runs/${runId}/approvals/${approvalId}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ decision, actorId: "fixture-operator", ...(remember ? { remember: true } : {}) }),
          })
          assert.equal(response.status, 200, await response.text())
        }
        const runId = await make()
        const first = textPrompt(runId, "PRODUCER_MCP_gamma_probe")
        const approval = await pendingAsk(runId)
        assert.equal(mcpFixtures.gamma.calls.tool, 0)
        await answer(runId, approval.approvalId, "approve", true)
        await first
        assert.equal(mcpFixtures.gamma.calls.tool, 1)
        const approvalCount = (await projectRunStateFromEvents(runId))!.approvals.filter(
          (item) => item.approvalType === "capability_grant_ask",
        ).length
        await textPrompt(runId, "PRODUCER_MCP_gamma_probe")
        assert.equal(mcpFixtures.gamma.calls.tool, 2)
        const remembered = (await projectRunStateFromEvents(runId))!
        assert.equal(
          remembered.approvals.filter((item) => item.approvalType === "capability_grant_ask").length,
          approvalCount,
        )
        assert.ok(remembered.grantReview.remembered[approval.approvalId])
        assert.deepEqual(reduceRunState(await readRunEvents(runId)), remembered)
        controls.push("compiled-ask-zero-effects-before-route-approval")
        controls.push("compiled-remembered-exact-tuple-second-real-dispatch")
        const deniedRunId = await make()
        const denied = textPrompt(deniedRunId, "PRODUCER_MCP_gamma_probe")
        const deniedApproval = await pendingAsk(deniedRunId)
        assert.equal(mcpFixtures.gamma.calls.tool, 2)
        await answer(deniedRunId, deniedApproval.approvalId, "deny")
        await denied
        assert.equal(mcpFixtures.gamma.calls.tool, 2)
        const deniedState = (await projectRunStateFromEvents(deniedRunId))!
        assert.ok(
          Object.values(deniedState.invocations).some(
            (invocation) => invocation.toolId === "gamma_probe" && invocation.status === "denied",
          ),
        )
        assert.equal(Object.keys(deniedState.grantReview.remembered).length, 0)
        assert.deepEqual(reduceRunState(await readRunEvents(deniedRunId)), deniedState)
        controls.push("compiled-ask-denial-and-no-cross-run-memory-effects")
      } else if (phase === "sdlc") {
        await fs.writeFile(
          path.join(directory, "package.json"),
          JSON.stringify({
            name: "owned-verification-control",
            scripts: { test: "bun -e \"require('fs').writeFileSync('verification-effect', 'ran')\"" },
          }),
        )
        const effect = path.join(directory, "verification-effect")
        const reviewed = await active()
        await GrantReview.claimStart(reviewed.runId, (await GrantReview.inspect(reviewed.runId)).expected)
        const before = await readRunEvents(reviewed.runId)
        const error = await verifySdlc({ repoRoot: directory, runId: reviewed.runId }).then(
          () => undefined,
          (error) => error,
        )
        const effectExists = await fs.stat(effect).then(
          () => true,
          (error) => {
            if (error.code === "ENOENT") return false
            throw error
          },
        )
        assert.ok(error instanceof CapabilityActionDeniedError, JSON.stringify({ error: error?.message, effectExists }))
        assert.equal(effectExists, false)
        const after = await readRunEvents(reviewed.runId)
        assert.equal(after.length, before.length + 1)
        assert.equal(after.at(-1)!.type, "capability_resolution_recorded")
        assert.equal(after.at(-1)!.payload.path, "verification_command")
        assert.equal(after.at(-1)!.payload.enforcement, "enforced")
        assert.equal(after.at(-1)!.payload.decision, "deny")
        const legacy = await verifySdlc({ repoRoot: directory })
        assert.ok(legacy.report.checks.some((check) => check.id === "js-test" && check.status === "passed"))
        assert.equal(await fs.readFile(effect, "utf8"), "ran")
        await fs.unlink(effect)
        const legacySession = await Session.create({ title: "Explicit v1 verification compatibility" })
        const { compileWithRunId } = await import("@/execution/compiler")
        await ContractGuardian.create(legacySession.id, compileWithRunId({ request }, legacySession.id).contract)
        await Session.bindGoverningRun(legacySession.id, legacySession.id)
        const v1 = await verifySdlc({ repoRoot: directory, runId: legacySession.id })
        assert.equal(v1.report.runId, legacySession.id)
        assert.equal(await fs.readFile(effect, "utf8"), "ran")
        await fs.unlink(effect)
        const missing = await verifySdlc({ repoRoot: directory, runId: "ses_missing_sdlc_reference" }).then(
          () => undefined,
          (error) => error,
        )
        assert.ok(missing instanceof CapabilityActionDeniedError)
        assert.equal(missing.reasonCode, "authority_unreadable")
        assert.equal(
          await fs.stat(effect).then(
            () => true,
            (error) => {
              if (error.code === "ENOENT") return false
              throw error
            },
          ),
          false,
        )
        assert.equal(providerCalls, 0)
        assert.deepEqual(reduceRunState(after), await projectRunStateFromEvents(reviewed.runId))
        controls.push("compiled-SDLC-explicit-reviewed-reference-no-command-effects")
        controls.push("compiled-SDLC-unscoped-operator-real-command-compatibility")
        controls.push("compiled-SDLC-v1-bound-reference-real-command-compatibility")
        controls.push("compiled-SDLC-missing-session-reference-no-fallback-effects")
      } else if (phase === "kill-open") {
        const reviewed = await active()
        await GrantReview.claimStart(reviewed.runId, (await GrantReview.inspect(reviewed.runId)).expected)
        interruptedRunId = reviewed.runId
        await textPrompt(reviewed.runId, "PRODUCER_KILL_OPEN")
        assert.fail("The parent must kill the fixture before provider settlement")
      } else if (phase === "restart-open") {
        const ready = JSON.parse(await fs.readFile(path.join(home, "process-interruption-ready.json"), "utf8")) as {
          runId: string
          providerCalls: number
        }
        assert.ok(ready.providerCalls > 0)
        const before = await readRunEvents(ready.runId)
        const state = (await projectRunStateFromEvents(ready.runId))!
        assert.equal(state.status, "running")
        assert.equal(state.assistantHistory.unsettledMessageIds.length, 1)
        const messages = await Session.messages({ sessionID: ready.runId })
        const error = await SessionPrompt.loop({ sessionID: ready.runId, completionPolicy: "on_provider_stop" }).then(
          () => undefined,
          (error) => error,
        )
        assert.equal(error?.code, "assistant_provenance_recovery_required")
        assert.equal(providerCalls, 0)
        assert.deepEqual(await readRunEvents(ready.runId), before)
        assert.deepEqual(await Session.messages({ sessionID: ready.runId }), messages)
        assert.deepEqual(reduceRunState(before), state)
        assert.equal(
          before.some((event) => ["artifact_recorded", "run_completed", "workflow_completed"].includes(event.type)),
          false,
        )
        controls.push("compiled-OS-kill-open-message-recovery-no-provider-replay")
      } else if (phase === "mcp") {
        assert.ok(mcpFixtures)
        const families = ["tool", "resource", "prompt"] as const
        const reviewed = await createGrantReviewedRun(
          { request, availableTools: ["gamma_probe", "delta_probe"] },
          {
            acknowledgedExternal: families.map((family) => `mcp_source:${family}:gamma`),
            sourceSelections: families.map((family) => ({ server: "gamma", family })),
          },
        )
        await approve(reviewed)
        await publish(reviewed)
        await GrantReview.activate(reviewed.runId)
        await GrantReview.claimStart(reviewed.runId, (await GrantReview.inspect(reviewed.runId)).expected)
        const runId = reviewed.runId
        await textPrompt(runId, "PRODUCER_MCP_gamma_probe")
        assert.equal(mcpFixtures.gamma.calls.tool, 1)
        assert.ok(
          Object.values((await projectRunStateFromEvents(runId))!.invocations).some(
            (invocation) => invocation.status === "completed" && invocation.toolId === "gamma_probe",
          ),
        )
        controls.push("compiled-MCP-tool-actual-call")
        const resource = (clientName: string) =>
          SessionPrompt.prompt({
            sessionID: runId,
            model: modelSelection,
            completionPolicy: "explicit",
            parts: [
              { type: "text", text: "Inspect resource" },
              {
                type: "file",
                mime: "text/plain",
                filename: "fixture",
                url: "fixture://private-resource",
                source: {
                  type: "resource",
                  clientName,
                  uri: "fixture://private-resource",
                  text: { value: "@fixture", start: 0, end: 8 },
                },
              },
            ],
          })
        await resource("gamma")
        assert.equal(mcpFixtures.gamma.calls.resource, 1)
        controls.push("compiled-MCP-resource-actual-read")
        await SessionPrompt.command({
          sessionID: runId,
          command: "gamma:private-prompt",
          arguments: "",
          model: "stage4d/probe",
        })
        assert.equal(mcpFixtures.gamma.calls.prompt, 1)
        controls.push("compiled-MCP-prompt-actual-fetch")
        const deniedResource = await resource("delta").then(
          () => undefined,
          (error) => error,
        )
        assert.ok(deniedResource instanceof CapabilityActionDeniedError)
        const deniedPrompt = await SessionPrompt.command({
          sessionID: runId,
          command: "delta:private-prompt",
          arguments: "",
          model: "stage4d/probe",
        }).then(
          () => undefined,
          (error) => error,
        )
        assert.ok(deniedPrompt instanceof CapabilityActionDeniedError)
        await textPrompt(runId, "PRODUCER_MCP_delta_probe")
        assert.deepEqual(mcpFixtures.delta.calls, { tool: 0, resource: 0, prompt: 0 })
        const messages = await Session.messages({ sessionID: runId })
        assert.ok(
          messages.some((message) =>
            message.parts.some(
              (part) =>
                part.type === "tool" &&
                part.state.status === "completed" &&
                part.state.output.includes("MCP tool effect"),
            ),
          ),
        )
        for (const text of ["MCP resource effect", "MCP prompt effect"])
          assert.ok(
            messages.some((message) => message.parts.some((part) => part.type === "text" && part.text.includes(text))),
          )
        const events = await readRunEvents(runId)
        for (const actionPath of ["mcp_tool", "mcp_resource", "mcp_prompt"]) {
          assert.ok(
            events.some(
              (event) =>
                event.type === "capability_resolution_recorded" &&
                event.payload.path === actionPath &&
                event.payload.enforcement === "enforced" &&
                event.payload.decision === "allow",
            ),
          )
          assert.ok(
            events.some(
              (event) =>
                event.type === "capability_resolution_recorded" &&
                event.payload.path === actionPath &&
                event.payload.enforcement === "enforced" &&
                event.payload.decision === "deny",
            ),
          )
        }
        assert.equal(JSON.stringify(events).includes("fixture://private-resource"), false)
        assert.equal(JSON.stringify(events).includes("private-prompt"), false)
        assert.deepEqual(reduceRunState(events), await projectRunStateFromEvents(runId))
        controls.push("compiled-MCP-cross-server-zero-effects-and-replay")
      } else if (phase === "delegation") {
        const make = async (agent: string) => {
          const reviewed = await createGrantReviewedRun(
            { request, availableTools: ["read", "task"] },
            {
              writeScope: { roots: ["."], reviewed: true },
              delegations: [{ capabilityId: "native.tool.task", agents: [agent] }],
            },
          )
          await approve(reviewed)
          await publish(reviewed)
          await GrantReview.activate(reviewed.runId)
          await GrantReview.claimStart(reviewed.runId, (await GrantReview.inspect(reviewed.runId)).expected)
          return reviewed.runId
        }
        const runId = await make("general")
        await textPrompt(runId, "PRODUCER_TASK_FRESH")
        let state = (await projectRunStateFromEvents(runId))!
        assert.equal(
          state.delegationHistory.records.length,
          1,
          JSON.stringify(
            (await Session.messages({ sessionID: runId })).flatMap((message) =>
              message.parts.filter((part) => part.type === "tool"),
            ),
          ),
        )
        const delegation = state.delegationHistory.records[0]!
        assert.equal(delegation.agent, "general")
        assert.equal(delegation.mode, "created")
        const child = await Session.get(delegation.childSessionId)
        assert.equal(child.governingRunId, runId)
        assert.equal(delegation.parentSessionId, runId)
        assert.ok(
          Object.values(state.invocations).some(
            (invocation) => invocation.toolId === "read" && invocation.status === "completed",
          ),
          JSON.stringify({
            invocations: state.invocations,
            childMessages: await Session.messages({ sessionID: child.id }),
          }),
        )
        assert.ok(
          Object.values(state.invocations).some(
            (invocation) => invocation.toolId === "task" && invocation.status === "completed",
          ),
          JSON.stringify(
            (await Session.messages({ sessionID: runId })).flatMap((message) =>
              message.parts.filter((part) => part.type === "tool"),
            ),
          ),
        )
        assert.equal(SessionStatus.get(child.id).type, "idle")
        controls.push("compiled-TaskTool-fresh-child-real-read")
        await textPrompt(runId, `PRODUCER_TASK_RESUME ${child.id}`)
        state = (await projectRunStateFromEvents(runId))!
        assert.equal(state.delegationHistory.records.length, 2)
        assert.equal(state.delegationHistory.records[1]!.childSessionId, child.id)
        assert.equal(state.delegationHistory.records[1]!.mode, "resumed")
        assert.equal(
          Object.values(state.invocations).filter(
            (invocation) => invocation.toolId === "read" && invocation.status === "completed",
          ).length,
          2,
        )
        assert.deepEqual(reduceRunState(await readRunEvents(runId)), state)
        controls.push("compiled-TaskTool-same-child-resume")
        const unknown = await make("deliberately_missing_agent")
        const sessionsBefore = []
        for await (const session of Session.list()) sessionsBefore.push(session.id)
        await textPrompt(unknown, "PRODUCER_TASK_UNKNOWN")
        const denied = (await projectRunStateFromEvents(unknown))!
        assert.equal(denied.delegationHistory.records.length, 0)
        assert.ok(
          Object.values(denied.invocations).some(
            (invocation) => invocation.toolId === "task" && invocation.status === "failed",
          ),
        )
        assert.ok(
          (await Session.messages({ sessionID: unknown })).some((message) =>
            message.parts.some(
              (part) =>
                part.type === "tool" &&
                part.state.status === "error" &&
                part.state.error.includes("does not fall back"),
            ),
          ),
        )
        const sessionsAfter = []
        for await (const session of Session.list()) sessionsAfter.push(session.id)
        assert.deepEqual(sessionsAfter.sort(), sessionsBefore.sort())
        controls.push("compiled-TaskTool-granted-missing-agent-no-fallback-child")
      } else if (phase === "graph") {
        const reviewed = await active()
        await GrantReview.claimStart(reviewed.runId, (await GrantReview.inspect(reviewed.runId)).expected)
        const child = await Session.createNext({ directory, parentID: reviewed.runId, governingRunId: reviewed.runId })
        let effects = 0
        const router = new OperatorRouter()
        router.register({
          type: "controlled",
          async execute() {
            effects++
            return { success: true, output: {} }
          },
        })
        const run = async (sessionId: string) => {
          const graph = createTaskGraph("graph_authority")
          addTask(graph, {
            id: "effect",
            name: "Effect",
            description: "Controlled effect",
            operator_type: "controlled",
            dependencies: [],
            context: {},
          })
          return runGraph(graph, { cwd: directory, sessionId }, router)
        }
        for (const sessionId of [reviewed.runId, child.id]) {
          const before = await readRunEvents(reviewed.runId)
          assert.equal((await run(sessionId)).success, false)
          assert.equal(effects, 0)
          const after = await readRunEvents(reviewed.runId)
          assert.equal(after.length, before.length + 1)
          assert.equal(after.at(-1)!.type, "capability_resolution_recorded")
          assert.equal(after.at(-1)!.payload.path, "operator_graph")
          assert.equal(after.at(-1)!.payload.enforcement, "enforced")
          assert.equal(after.at(-1)!.payload.decision, "deny")
          assert.equal(after.at(-1)!.payload.reasonCode, "grant_absent")
          assert.deepEqual(reduceRunState(after), await projectRunStateFromEvents(reviewed.runId))
        }
        controls.push("compiled-graph-root-child-durable-denials")
        const legacy = await Session.create({ title: "Explicit no-contract graph" })
        assert.equal((await run(legacy.id)).success, true)
        assert.equal(effects, 1)
        assert.equal(providerCalls, 0)
        controls.push("compiled-graph-no-contract-compatibility")
      } else if (phase === "api") {
        const app = new Hono().route("/runs", RunRoutes())
        const api = async (url: string, body?: unknown, status = 200) => {
          const response = await app.request(
            `http://dax.internal/runs${url === "/" ? "" : url}`,
            body === undefined
              ? {}
              : {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(body),
                },
          )
          const raw = await response.text()
          assert.equal(response.status, status, `${url}: ${raw}`)
          const result = JSON.parse(raw)
          return result
        }
        const countSessions = async () => {
          const sessions = []
          for await (const session of Session.list()) sessions.push(session.id)
          return sessions.length
        }
        const beforeSessions = await countSessions()
        const beforeAuthority = await Storage.list(["run_authority", Instance.project.id])
        const strict = { ...request, capabilityReview: { mode: "reviewed_grants" } }
        for (const body of [
          { ...strict, capabilityReview: null },
          { ...strict, capabilityReview: { mode: "anything" } },
          { ...strict, capabilityReview: { mode: "reviewed_grants", contract: {} } },
          { ...strict, workflowHint: undefined },
          { ...strict, workflowHint: "repo_analyze" },
          { ...strict, metadata: { allowLegacyFallback: true } },
          { ...strict, workerConstraints: {} },
          { ...strict, personaPreset: { providerHint: "worker:fixture" } },
          { ...strict, intent: { input: "Change the application" } },
        ])
          await api("/", body, 400)
        assert.equal(await countSessions(), beforeSessions)
        assert.deepEqual(await Storage.list(["run_authority", Instance.project.id]), beforeAuthority)
        assert.equal(providerCalls, 0)
        controls.push("api-preflight-no-session-authority-provider")
        const created = CreateRunResponse.parse(await api("/", strict))
        assert.equal(created.status, "waiting_approval")
        assert.ok(created.grantReview)
        const runId = created.runId
        const approvals = await api(`/${runId}/approvals`)
        assert.equal(approvals.approvals[0].type, "capability_grant_review")
        assert.equal(approvals.approvals[0].contractGrantSubject.kind, "contract_grant_set")
        let review = RunGrantReview.parse(await api(`/${runId}/grant-review`))
        const { location: _location, ...createdPins } = created.grantReview
        assert.deepEqual(review.expected, createdPins)
        const journal = () => readRunEvents(runId)
        const original = await journal()
        const originalReview = await GrantReview.get(runId)
        for (const suffix of ["start", "revisions"] as const) {
          const invalid = await api(`/${runId}/grant-review/${suffix}`, {}, 400)
          assert.equal(RunBadRequestError.safeParse(invalid).success, true)
          const missing = await api(
            `/ses_missing/grant-review/${suffix}`,
            suffix === "start" ? { expected: review.expected } : { expected: review.expected, inputs: {} },
            404,
          )
          assert.equal(ReviewedRunRefusal.safeParse(missing).success, true)
          assert.equal(missing.code, "review_missing")
        }
        const missingSuccessor = await api(
          "/",
          {
            ...strict,
            capabilityReview: {
              mode: "reviewed_grants",
              successorOf: "ses_missing",
            },
          },
          404,
        )
        assert.equal(ReviewedRunRefusal.safeParse(missingSuccessor).success, true)
        assert.deepEqual(await journal(), original)
        assert.deepEqual(await GrantReview.get(runId), originalReview)
        assert.equal(providerCalls, 0)
        controls.push("api-actual-validator-and-missing-errors-no-effects")
        for (const changed of [
          { revision: review.expected.revision + 1 },
          { approvalId: "stale" },
          { proposalDigest: `sha256:${"0".repeat(64)}` },
          { contractDigest: `sha256:${"0".repeat(64)}` },
          { bindingManifestDigest: `sha256:${"0".repeat(64)}` },
        ]) {
          await api(
            `/${runId}/grant-review/revisions`,
            { expected: { ...review.expected, ...changed }, inputs: {} },
            409,
          )
          await api(`/${runId}/grant-review/start`, { expected: { ...review.expected, ...changed } }, 409)
          assert.deepEqual(await journal(), original)
          assert.deepEqual(await GrantReview.get(runId), originalReview)
        }
        controls.push("api-complete-stale-pins-no-append")
        const approval = `/${runId}/approvals/${review.expected.approvalId}`
        for (const body of [
          { decision: "approve" },
          { decision: "approve", actorId: " " },
          { decision: "approve", actorId: "fixture", remember: true },
          { decision: "deny", actorId: "fixture", remember: false },
        ]) {
          await api(approval, body, 400)
          assert.deepEqual(await journal(), original)
        }
        controls.push("api-grant-actor-remember-validation-before-append")
        await api(`/${runId}/grant-review/start`, { expected: review.expected }, 409)
        assert.deepEqual(await journal(), original)
        review = RunGrantReview.parse(
          await api(`/${runId}/grant-review/revisions`, {
            expected: review.expected,
            inputs: { writeScope: { roots: ["."], reviewed: true } },
          }),
        )
        assert.equal(review.expected.revision, 2)
        assert.equal(review.approvalStatus, "pending")
        assert.equal(providerCalls, 0)
        controls.push("api-server-produced-revision-fresh-approval")
        await api(`/${runId}/approvals/${review.expected.approvalId}`, {
          decision: "approve",
          actorId: "fixture-operator",
        })
        assert.equal(providerCalls, 0)
        assert.equal((await projectRunStateFromEvents(runId))?.status, "queued")
        controls.push("api-grant-approval-no-workflow-resume")
        await GrantReview.publish(runId, { approvalId: review.expected.approvalId, subject: review.approvalSubject! })
        await GrantReview.activate(runId)
        const queued = await journal()
        const messages = await Session.messages({ sessionID: runId })
        assert.equal((await readContract(runId))?.schemaVersion, "v2")
        for (const action of [
          () => textPrompt(runId),
          () =>
            SessionPrompt.prompt({ sessionID: runId, noReply: true, parts: [{ type: "text", text: "no effects" }] }),
          () => SessionPrompt.loop({ sessionID: runId }),
          () => SessionPrompt.command({ sessionID: runId, command: "pm", arguments: "list" }),
          () => SessionPrompt.shell({ sessionID: runId, agent: "build", command: `touch '${sentinel}'` }),
          () => SessionPrompt.ensureCanonicalRunBirth({ sessionID: runId, intent: "Inspect evidence" }),
        ]) {
          await assert.rejects(action())
          assert.deepEqual(await journal(), queued)
          assert.deepEqual(await Session.messages({ sessionID: runId }), messages)
          assert.equal(providerCalls, 0)
        }
        controls.push("api-activated-queued-all-session-entries-no-effects")
        const responses = await Promise.all(
          [1, 2].map(() =>
            app.request(`http://dax.internal/runs/${runId}/grant-review/start`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ expected: review.expected }),
            }),
          ),
        )
        assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])
        assert.equal((await journal()).filter((event) => event.type === "execution_started").length, 1)
        const completedR2 = await awaitRunCompletion(runId)
        assert.ok(providerCalls > 0)
        assert.equal(SessionStatus.get(runId).type, "idle")
        await api(`/${runId}/grant-review/start`, { expected: review.expected }, 409)
        assert.equal((await journal()).filter((event) => event.type === "execution_started").length, 1)
        assert.equal(completedR2.status, "completed")
        assert.equal(supersededReviewApprovals(completedR2, review.expected.approvalId).size, 1)
        assert.deepEqual(reduceRunState(await journal()), completedR2)
        controls.push("api-r2-completion-canonical-supersession")
        controls.push("api-genuine-start-at-most-one-dispatch")
        const multi = CreateRunResponse.parse(await api("/", strict))
        let multiReview = RunGrantReview.parse(await api(`/${multi.runId}/grant-review`))
        for (const revision of [2, 3]) {
          multiReview = RunGrantReview.parse(
            await api(`/${multi.runId}/grant-review/revisions`, {
              expected: multiReview.expected,
              inputs: { writeScope: { roots: ["."], reviewed: true } },
            }),
          )
          assert.equal(multiReview.expected.revision, revision)
        }
        await api(`/${multi.runId}/approvals/${multiReview.expected.approvalId}`, {
          decision: "approve",
          actorId: "fixture-operator",
        })
        await api(`/${multi.runId}/grant-review/start`, { expected: multiReview.expected })
        const multiState = await awaitRunCompletion(multi.runId)
        assert.equal(multiState.status, "completed")
        assert.equal(supersededReviewApprovals(multiState, multiReview.expected.approvalId).size, 2)
        assert.deepEqual(reduceRunState(await readRunEvents(multi.runId)), multiState)
        controls.push("api-r3-completion-multi-revision-proof")
        // Unrelated historical outcomes remain blockers before output artifacts.
        for (const decision of ["expired", "rejected", "ask-expired", "pending", "review-missing-proof"] as const) {
          let candidate = await create()
          if (decision === "review-missing-proof") {
            await resolveApprovalEvent(candidate.runId, candidate.revision.approvalId, "expired")
            const revised = await GrantReview.revise(candidate.runId, candidate.revision.proposal)
            candidate = { ...candidate, revision: revised }
          }
          await approve(candidate)
          // Select the actual current canonical subject for a revised candidate.
          const current = await GrantReview.inspect(candidate.runId)
          await GrantReview.publish(candidate.runId, {
            approvalId: current.expected.approvalId,
            subject: current.approvalSubject!,
          })
          await GrantReview.activate(candidate.runId)
          await GrantReview.claimStart(candidate.runId, current.expected)
          await textPrompt(candidate.runId)
          if (decision !== "review-missing-proof") {
            const id = `blocked_${decision}`
            const proof = (await projectRunStateFromEvents(candidate.runId))!.grantReview.published!
            const binding = proof.bindings.find(
              (item) => item.subject === subjectKey({ kind: "capability", capabilityId: "native.tool.read" }),
            )!
            await appendRunEventAtTail(candidate.runId, {
              type: "approval_requested",
              payload: {
                approvalId: id,
                approvalType: decision === "ask-expired" ? "capability_grant_ask" : "workflow_gate",
                risk: "high",
                ...(decision === "ask-expired"
                  ? {
                      expiresAt: new Date(Date.now() + 60000).toISOString(),
                      grantAskSubject: {
                        kind: "capability_grant_ask",
                        grantSubject: binding.subject,
                        capabilityId: "native.tool.read",
                        contractDigest: proof.contractDigest,
                        bindingDigest: binding.digest,
                      },
                    }
                  : {}),
              },
              ...(decision === "ask-expired" ? { correlationId: id } : {}),
            })
            if (decision !== "pending")
              await resolveApprovalEvent(
                candidate.runId,
                id,
                decision === "rejected" ? "rejected" : "expired",
                "fixture",
              )
          }
          const before = (await projectRunStateFromEvents(candidate.runId))!
          const assistant = (await Session.messages({ sessionID: candidate.runId }))
            .filter((m) => m.info.role === "assistant")
            .at(-1)!
          const result = await adjudicateNativeCompletionCandidate({
            sessionID: candidate.runId,
            assistantMessageID: assistant.info.id,
            finishReason: "stop",
          })
          assert.equal(result.accepted, false, decision)
          assert.ok(
            result.reasonCodes.some((code) => code.startsWith("approval_")),
            `${decision}: ${result.reasonCodes}`,
          )
          const after = (await projectRunStateFromEvents(candidate.runId))!
          assert.deepEqual(after.artifacts, before.artifacts)
          assert.notEqual(after.status, "completed")
        }
        controls.push("api-non-superseded-approvals-block-before-artifacts")
        // Neutral intent is not a read-only policy: explicit reviewed roots can
        // grant native writes while the unchanged compiler has no required proof.
        const neutral = CreateRunResponse.parse(
          await api("/", {
            intent: { input: "Consider this workspace" },
            workflowHint: "generic",
            capabilityReview: { mode: "reviewed_grants", writeScope: { roots: ["."], reviewed: true } },
          }),
        )
        const neutralReview = RunGrantReview.parse(await api(`/${neutral.runId}/grant-review`))
        const record = (await GrantReview.get(neutral.runId))!
        assert.equal(
          record.revisions.at(-1)!.proposal.candidate.runtimePolicy?.postconditions.verificationRequired,
          false,
        )
        assert.ok(
          neutralReview.grants.some(
            (grant) =>
              grant.subject.kind === "capability" &&
              grant.subject.capabilityId === "native.tool.write" &&
              grant.decision === "allow",
          ),
        )
        assert.equal((await projectRunStateFromEvents(neutral.runId))?.status, "waiting_approval")
        controls.push("api-neutral-intent-explicit-roots-consequential-grants-disclosed")
        const denied = CreateRunResponse.parse(await api("/", strict))
        const deniedReview = RunGrantReview.parse(await api(`/${denied.runId}/grant-review`))
        await api(`/${denied.runId}/approvals/${deniedReview.expected.approvalId}`, {
          decision: "deny",
          actorId: "fixture",
        })
        assert.equal(RunGrantReview.parse(await api(`/${denied.runId}/grant-review`)).approvalStatus, "denied")
        const deniedJournal = await readRunEvents(denied.runId)
        await api(`/${denied.runId}/grant-review/start`, { expected: deniedReview.expected }, 409)
        assert.deepEqual(await readRunEvents(denied.runId), deniedJournal)
        controls.push("api-denied-review-readable-no-start")
        const fresh = async () => {
          const created = CreateRunResponse.parse(
            await api("/", {
              ...strict,
              capabilityReview: {
                ...strict.capabilityReview,
                writeScope: { roots: ["."], reviewed: true },
              },
            }),
          )
          const review = RunGrantReview.parse(await api(`/${created.runId}/grant-review`))
          await api(`/${created.runId}/approvals/${review.expected.approvalId}`, {
            decision: "approve",
            actorId: "fixture",
          })
          return { runId: created.runId, expected: review.expected, subject: review.approvalSubject! }
        }
        const cross = await fresh()
        const runChild = async () => {
          const child = Bun.spawn([process.execPath, home, "api-start-child", JSON.stringify(cross)], {
            stdout: "pipe",
            stderr: "pipe",
            env: process.env,
          })
          const timer = setTimeout(() => child.kill(), 30_000)
          const [status, output, errors] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
          ])
          clearTimeout(timer)
          assert.equal(status, 0, `${output}\n${errors}`)
          console.error("cross-process child", output.trim(), errors)
          return JSON.parse(output.trim().split("\n").at(-1)!).controls[0]
        }
        const crossResults = await Promise.all([runChild(), runChild()])
        assert.deepEqual(crossResults.sort(), ["api-cross-process-start-200", "api-cross-process-start-409"])
        assert.equal((await readRunEvents(cross.runId)).filter((event) => event.type === "execution_started").length, 1)
        assert.equal(
          (await Session.messages({ sessionID: cross.runId })).filter((message) => message.info.role === "user").length,
          1,
        )
        controls.push("api-cross-process-one-initial-model-dispatch")
        const neverStarted = await fresh()
        const neverPublished = await GrantReview.publish(neverStarted.runId, {
          approvalId: neverStarted.expected.approvalId,
          subject: neverStarted.subject,
        })
        await GrantReview.activate(neverStarted.runId)
        const neverBinding = neverStarted.subject.bindings!.find((binding) => binding.subject === "native.tool.read")!
        const neverCapability = neverBinding.subject
        await appendRunEventAtTail(neverStarted.runId, {
          type: "approval_requested",
          correlationId: "api_unstarted_ask_action",
          payload: {
            approvalId: "api_unstarted_ask",
            approvalType: "capability_grant_ask",
            risk: "high",
            title: "Unstarted ask",
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            grantAskSubject: {
              kind: "capability_grant_ask",
              grantSubject: neverBinding.subject,
              capabilityId: neverCapability,
              contractDigest: neverPublished.published.contractDigest,
              bindingDigest: neverBinding.digest,
            },
          },
        })
        const neverJournal = await readRunEvents(neverStarted.runId)
        assert.equal((await projectRunStateFromEvents(neverStarted.runId))?.startedAt, null)
        assert.equal((await readContract(neverStarted.runId))?.schemaVersion, "v2")
        const callsBeforeUnstarted = providerCalls
        await assert.rejects(GrantReview.dispatchAuthority(neverStarted.runId))
        await assert.rejects(
          SessionPrompt.prompt({
            sessionID: neverStarted.runId,
            noReply: true,
            parts: [{ type: "text", text: "No effect" }],
          }),
        )
        await assert.rejects(textPrompt(neverStarted.runId))
        await assert.rejects(
          SessionPrompt.ensureCanonicalRunBirth({ sessionID: neverStarted.runId, intent: "No effect" }),
        )
        await assert.rejects(
          recordActionResolution({
            governedBy: { runId: neverStarted.runId },
            subject: "Unstarted action",
            path: "mcp_resource",
            initiator: "operator",
            executor: { kind: "mcp", descriptor: mcpReadDescriptor("resource", "gamma", "file:///notes") },
            source: { server: "gamma", name: "file:///notes" },
          }),
        )
        assert.equal(providerCalls, callsBeforeUnstarted)
        assert.equal((await Session.messages({ sessionID: neverStarted.runId })).length, 0)
        assert.deepEqual(await readRunEvents(neverStarted.runId), neverJournal)
        controls.push("api-activated-unstarted-waiting-no-dispatch-effects")
        const crashed = await fresh()
        const callsBeforeClaim = providerCalls
        await GrantReview.claimStart(crashed.runId, crashed.expected) // Actual crash boundary: durable claim, no prompt.
        assert.equal(providerCalls, callsBeforeClaim)
        assert.equal((await Session.messages({ sessionID: crashed.runId })).length, 0)
        await api(`/${crashed.runId}/grant-review/start`, { expected: crashed.expected }, 409)
        assert.equal(
          (await readRunEvents(crashed.runId)).filter((event) => event.type === "execution_started").length,
          1,
        )
        assert.equal(providerCalls, callsBeforeClaim)
        controls.push("api-claim-before-dispatch-never-retried")
        const resume = await fresh()
        await GrantReview.publish(
          resume.runId,
          { approvalId: resume.expected.approvalId, subject: resume.subject },
          {
            afterProof: async () => {
              throw new Error("fixture publication completion crash")
            },
          },
        ).catch((error) => assert.equal(error.message, "fixture publication completion crash"))
        const resumed = await api(`/${resume.runId}/grant-review/start`, { expected: resume.expected })
        assert.equal(resumed.claimed, true)
        assert.equal(
          (await readRunEvents(resume.runId)).filter((event) => event.type === "grant_review_activated").length,
          1,
        )
        controls.push("api-publication-proof-crash-roll-forward")
        // Ask routing is exercised on a genuinely activated/claimed contract.
        // D3 separately must exercise the complete tool->wait->recheck producer.
        const nativeGrant = neutralReview.grants.find(
          (grant) => grant.subject.kind === "capability" && grant.subject.capabilityId === "native.tool.read",
        )!
        assert.ok(nativeGrant)
        const nativeSubject = subjectKey(nativeGrant.subject)
        const askReview = RunGrantReview.parse(
          await api(`/${neutral.runId}/grant-review/revisions`, {
            expected: neutralReview.expected,
            inputs: { writeScope: { roots: ["."], reviewed: true }, askSubjects: [nativeSubject] },
          }),
        )
        await api(`/${neutral.runId}/approvals/${askReview.expected.approvalId}`, {
          decision: "approve",
          actorId: "fixture",
        })
        const askPublished = await GrantReview.claimStart(neutral.runId, askReview.expected)
        const binding = askReview.bindings.find((binding) => binding.subject === nativeSubject)!
        const askSubject = {
          kind: "capability_grant_ask" as const,
          grantSubject: nativeSubject,
          capabilityId: "native.tool.read",
          contractDigest: askPublished.contractDigest,
          bindingDigest: binding.digest,
        }
        await appendRunEventAtTail(neutral.runId, {
          type: "approval_requested",
          payload: {
            approvalId: "api_fixture_ask",
            approvalType: "capability_grant_ask",
            risk: "high",
            title: "Ask fixture",
            grantAskSubject: askSubject,
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          },
          correlationId: "api_fixture_ask_action",
        })
        const askOriginal = await readRunEvents(neutral.runId)
        await api(
          `/${neutral.runId}/approvals/api_fixture_ask`,
          { decision: "deny", actorId: "fixture", remember: true },
          400,
        )
        await api(
          `/${neutral.runId}/approvals/api_fixture_ask`,
          { decision: "approve", actorId: " ", remember: true },
          400,
        )
        assert.deepEqual(await readRunEvents(neutral.runId), askOriginal)
        await api(`/${neutral.runId}/approvals/api_fixture_ask`, {
          decision: "approve",
          actorId: "fixture",
          remember: true,
        })
        const askState = (await projectRunStateFromEvents(neutral.runId))!
        assert.deepEqual(askState.grantReview.remembered.api_fixture_ask, askSubject)
        assert.equal((await Session.messages({ sessionID: neutral.runId })).length, 0)
        controls.push("api-ask-remember-validation-routing-no-workflow-resume")
        await appendRunEventAtTail(neutral.runId, {
          type: "approval_requested",
          payload: {
            approvalId: "api_fixture_wrong_type",
            approvalType: "tool_use",
            risk: "high",
            title: "Ordinary approval",
          },
        })
        const wrongTypeOriginal = await readRunEvents(neutral.runId)
        await api(
          `/${neutral.runId}/approvals/api_fixture_wrong_type`,
          { decision: "approve", actorId: "fixture", remember: true },
          400,
        )
        assert.deepEqual(await readRunEvents(neutral.runId), wrongTypeOriginal)
        controls.push("api-wrong-approval-type-remember-no-append")
        // Fresh successor metadata cannot copy authority or approval history.
        const old = await Session.create({ title: "Legacy consequential session" })
        const oldInfo = await Session.get(old.id)
        const successor = CreateRunResponse.parse(
          await api("/", { ...strict, capabilityReview: { mode: "reviewed_grants", successorOf: old.id } }),
        )
        assert.notEqual(successor.runId, old.id)
        assert.deepEqual(await Session.get(old.id), oldInfo)
        assert.equal((await projectRunStateFromEvents(successor.runId))?.approvals.length, 1)
        assert.equal((await Session.get(successor.runId)).governingRunId, successor.runId)
        controls.push("api-successor-fresh-authority-no-copy")
        for (let index = 0; index < 400 && SessionStatus.get(resume.runId).type !== "idle"; index++) {
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        assert.equal(SessionStatus.get(resume.runId).type, "idle")
        assert.ok(
          (await Session.messages({ sessionID: resume.runId })).some((message) => message.info.role === "assistant"),
        )
      } else if (phase === "matrix") {
        assert.equal(daxExecutable().form, "compiled")
        const pending = await create()
        await blocked(pending.runId, "pending")
        const reserved = await create()
        const reservedRecord = await GrantReview.get(reserved.runId)
        reservedRecord!.revisions = []
        await Storage.write(["grant_review", Instance.project.id, reserved.runId], reservedRecord)
        await blocked(reserved.runId, "reserved")
        const denied = await create()
        await resolveApprovalEvent(denied.runId, denied.revision.approvalId, "rejected", "fixture-operator")
        await blocked(denied.runId, "denied")
        const expired = await create()
        await resolveApprovalEvent(expired.runId, expired.revision.approvalId, "expired", null)
        await blocked(expired.runId, "expired")
        const superseded = await create()
        await GrantReview.revise(superseded.runId, superseded.revision.proposal)
        await blocked(superseded.runId, "superseded")
        const approved = await create()
        await approve(approved)
        await blocked(approved.runId, "approved-unpublished")
        const unactivated = await create()
        await approve(unactivated)
        await publish(unactivated)
        await blocked(unactivated.runId, "unactivated")
        const interrupted = await create()
        await approve(interrupted)
        const subject = (await readRunEvents(interrupted.runId)).find((e) => e.type === "approval_requested")!
          .payload as { contractGrantSubject: unknown }
        await assert.rejects(
          GrantReview.publish(
            interrupted.runId,
            { approvalId: interrupted.revision.approvalId, subject: subject.contractGrantSubject },
            {
              afterArtifact: async () => {
                throw Error("interrupted")
              },
            },
          ),
        )
        await blocked(interrupted.runId, "publication-intent-no-proof")
        await checkArtifactMutation((a) => {
          a.contract.intent = "changed"
        }, "stale-artifact")
        await checkArtifactMutation((a) => {
          a.runId = "ses_wrong"
        }, "artifact-run-mismatch")
        await checkArtifactMutation((a) => {
          a.contract.schemaVersion = "v1"
        }, "artifact-schema-mismatch")
        const missing = await active()
        await Storage.remove(["grant_review_published", Instance.project.id, missing.runId])
        await blocked(missing.runId, "missing-artifact")
        const removed = await active()
        await Storage.remove(["grant_review", Instance.project.id, removed.runId])
        await blocked(removed.runId, "missing-review-with-journal-authority")
        const oldArtifact = await active()
        const { compileWithRunId: compileLegacy } = await import("@/execution/compiler")
        await Storage.write(
          ["execution_contract", Instance.project.id, oldArtifact.runId],
          compileLegacy({ request }, oldArtifact.runId).contract,
        )
        await Storage.remove(["grant_review", Instance.project.id, oldArtifact.runId])
        await blocked(oldArtifact.runId, "missing-review-old-v1-artifact-denied")
        const oldPending = await create()
        await Storage.write(
          ["execution_contract", Instance.project.id, oldPending.runId],
          compileLegacy({ request }, oldPending.runId).contract,
        )
        await Storage.remove(["grant_review", Instance.project.id, oldPending.runId])
        await blocked(oldPending.runId, "missing-pending-review-old-v1-artifact-denied")
        const missingWithMarkerFailure = await active()
        await Storage.write(
          ["execution_contract", Instance.project.id, missingWithMarkerFailure.runId],
          compileLegacy({ request }, missingWithMarkerFailure.runId).contract,
        )
        await Storage.remove(["grant_review", Instance.project.id, missingWithMarkerFailure.runId])
        await fs.writeFile(
          path.join(
            Global.Path.data,
            "storage",
            "run_authority",
            Instance.project.id,
            missingWithMarkerFailure.runId,
            "authority.json.json",
          ),
          "{broken-json",
        )
        await blocked(missingWithMarkerFailure.runId, "missing-review-unreadable-marker-old-v1-denied")
        const corruptJournal = await active()
        await Storage.remove(["grant_review", Instance.project.id, corruptJournal.runId])
        await Storage.write(
          ["execution_contract", Instance.project.id, corruptJournal.runId],
          compileLegacy({ request }, corruptJournal.runId).contract,
        )
        await Storage.write(["run_events", Instance.project.id, corruptJournal.runId, "events.json"], {
          malformed: true,
        })
        await blocked(corruptJournal.runId, "missing-review-corrupt-journal-old-v1-denied")
        const badMarker = await active()
        await Storage.write(["run_authority", Instance.project.id, badMarker.runId, "authority.json"], {})
        await blocked(badMarker.runId, "malformed-authority-marker")
        const corrupted = await active()
        const record = await GrantReview.get(corrupted.runId)
        record!.runId = "ses_wrong"
        await Storage.write(["grant_review", Instance.project.id, corrupted.runId], record)
        await blocked(corrupted.runId, "corrupt-review")
        const edited = await active()
        const rev = await GrantReview.get(edited.runId)
        rev!.revisions[0]!.proposal.candidate.intent = "changed"
        await Storage.write(["grant_review", Instance.project.id, edited.runId], rev)
        await blocked(edited.runId, "corrupt-review-proposal")
        await checkJournalMutation((events) => {
          const a = events.find((e) => e.type === "grant_review_activated")
          a.payload.bindings[0].digest = `sha256:${"e".repeat(64)}`
        }, "altered-activation-manifest")
        await checkJournalMutation((events) => {
          events.find((e) => e.type === "grant_review_activated").payload.bindings.reverse()
        }, "reordered-activation-manifest")
        await checkJournalMutation((events) => {
          events.find((e) => e.type === "grant_review_activated").payload.revision++
        }, "activation-revision-mismatch")
        await checkJournalMutation(
          (events) => {
            events.find((e) => e.type === "grant_review_activated").payload.bindings[0].subject =
              "mcp_source:resource:wrong"
          },
          "altered-remote-activation-manifest",
          false,
        )
        await checkJournalMutation(
          (events) => {
            events.find((e) => e.type === "grant_review_activated").payload.bindings.reverse()
          },
          "reordered-remote-activation-manifest",
          false,
        )
        await checkJournalMutation(
          (events) => {
            events.find((e) => e.type === "grant_review_activated").payload.bindings[0].subject = {
              kind: "mcp_source",
              family: "resource",
              server: "*",
            }
          },
          "malformed-source-selector",
          false,
        )
        await checkJournalMutation((events) => {
          events.find((e) => e.type === "grant_review_activated").payload.bindings = null
        }, "malformed-activation")
        const raw = await active()
        await fs.writeFile(
          path.join(Global.Path.data, "storage", "grant_review", Instance.project.id, `${raw.runId}.json`),
          "{broken-json",
        )
        await blocked(raw.runId, "raw-review-storage-failure")
        const unreadable = await active()
        const key = ["grant_review", Instance.project.id, unreadable.runId]
        await Storage.write(key, { publication: { state: "complete" }, revisions: null })
        await blocked(unreadable.runId, "unreadable-review-structure")
        const native = await active()
        const publishedContract = ExecutionContractV2.parse(await readContract(native.runId))
        assert.ok(publishedContract.capabilityGrants.length > 0)
        assert.equal(publishedContract.runId, native.runId)
        controls.push("operator-reviewed-published-v2-contract-grants")
        // Guardian writes retain the strict presence barrier, even with a valid published contract.
        const { compileWithRunId } = await import("@/execution/compiler")
        const v1 = compileWithRunId({ request }, native.runId).contract
        await assert.rejects(ContractGuardian.create(native.runId, v1))
        controls.push("activated-v1-write-refused")
        await GrantReview.claimStart(native.runId, (await GrantReview.inspect(native.runId)).expected)
        console.error("starting native prompt")
        await textPrompt(native.runId, "PRODUCER_READ: read the evidence file.")
        const state = (await projectRunStateFromEvents(native.runId))!
        assert.equal(state.status, "running")
        assert.equal(SessionStatus.get(native.runId).type, "idle")
        const invocation = Object.values(state.invocations).find((i) => i.toolId === "read")
        assert.equal(invocation?.status, "completed")
        assert.equal(
          state.capabilityResolutions.find((r) => r.capabilityId === "native.tool.read")?.enforcement,
          "enforced",
        )
        assert.ok(
          state.capabilityResolutions.some(
            (item) =>
              item.capabilityId === "native.tool.read" &&
              item.basis === "v2_grant" &&
              item.decision === "allow" &&
              item.enforcement === "enforced",
          ),
        )
        controls.push("production-native-shared-v2-grant-resolution")
        assert.deepEqual(reduceRunState(await readRunEvents(native.runId)), state)
        assert.ok(
          (await Session.messages({ sessionID: native.runId })).some((m) =>
            m.parts.some(
              (p) =>
                p.type === "tool" &&
                p.state.status === "completed" &&
                p.state.output.includes("D1 compiled producer evidence"),
            ),
          ),
        )
        controls.push("genuine-native-SessionPrompt-read", "idle-does-not-complete", "journal-replay")
        const remote = await active(false)
        assert.ok(remote.revision.proposal.bindings.every((b) => b.attestation === "external"))
        await GrantReview.claimStart(remote.runId, (await GrantReview.inspect(remote.runId)).expected)
        await textPrompt(remote.runId)
        controls.push("genuine-remote-only-SessionPrompt")
        const terminal = await active()
        await transitionEventAuthority(terminal.runId, "failed", "run_failed", {
          error: { code: "fixture", message: "fixture", retryable: false },
        })
        assert.equal((await readContract(terminal.runId))?.schemaVersion, "v2")
        const before = providerCalls
        await assert.rejects(textPrompt(terminal.runId))
        await assert.rejects(GrantReview.dispatchAuthority(terminal.runId))
        await assert.rejects(SessionPrompt.loop({ sessionID: terminal.runId }))
        await assert.rejects(SessionPrompt.command({ sessionID: terminal.runId, command: "pm", arguments: "list" }))
        await assert.rejects(
          SessionPrompt.shell({ sessionID: terminal.runId, agent: "build", command: `touch '${sentinel}'` }),
        )
        assert.equal(providerCalls, before)
        controls.push("terminal-readable-no-dispatch")
        await fs.writeFile(
          path.join(home, "saved.json"),
          JSON.stringify({ nativeRunId: native.runId, remoteRunId: remote.runId }),
        )
      } else {
        const saved = JSON.parse(await fs.readFile(path.join(home, "saved.json"), "utf8"))
        if (phase === "other-image") {
          assert.equal(daxExecutable().form, "compiled")
          await blocked(saved.nativeRunId, "changed-image-native-binding-denied")
          assert.equal((await readContract(saved.remoteRunId))?.schemaVersion, "v2")
          await textPrompt(saved.remoteRunId)
          controls.push("remote-only-second-compiled-image-allowed")
        } else if (phase === "source") {
          const app = new Hono().route("/runs", RunRoutes())
          const original = await readRunEvents(saved.remoteRunId)
          const sessions = await Storage.list(["session", Instance.project.id])
          const sourceCreate = await app.request("/runs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...request, capabilityReview: { mode: "reviewed_grants" } }),
          })
          assert.equal(sourceCreate.status, 400)
          assert.equal((await sourceCreate.json()).code, "enforcing_image_required")
          assert.deepEqual(await Storage.list(["session", Instance.project.id]), sessions)
          const sourceStart = await app.request(`http://dax.internal/runs/${saved.remoteRunId}/grant-review/start`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ expected: (await GrantReview.inspect(saved.remoteRunId)).expected }),
          })
          assert.equal(sourceStart.status, 409)
          assert.deepEqual(await readRunEvents(saved.remoteRunId), original)
          controls.push("source-api-create-start-no-effects")

          assert.equal(daxExecutable().form, "development")
          await blocked(saved.nativeRunId, "source-native-denied")
          await blocked(saved.remoteRunId, "source-remote-only-denied")
          await assert.rejects(
            recordActionResolution({
              governedBy: { runId: saved.remoteRunId },
              subject: "source-read",
              path: "mcp_resource",
              initiator: "operator",
              executor: {
                kind: "mcp",
                alias: "resource",
                descriptor: mcpReadDescriptor("resource", "gamma", "file:///private"),
              },
              source: { server: "gamma", name: "file:///private" },
            }),
          )
          controls.push("source-direct-action-denied")
        } else if (phase === "unknown") {
          assert.equal(daxExecutable().form, "unknown")
          await blocked(saved.remoteRunId, "unknown-image-remote-only-denied")
        }
      }
    },
  })
  console.log(
    JSON.stringify({
      variant: typeof DAX_PRODUCER_VARIANT === "string" ? DAX_PRODUCER_VARIANT : "source",
      controls,
      providerCalls,
      ...(mcpFixtures ? { mcpCalls: { gamma: mcpFixtures.gamma.calls, delta: mcpFixtures.delta.calls } } : {}),
    }),
  )
} finally {
  model.stop(true)
  await Instance.disposeAll()
  if (mcpFixtures) await Promise.all(Object.values(mcpFixtures).map((fixture) => fixture.close()))
}

// Production modules keep this one-shot fixture alive after disposal (specific handle unestablished).
// Exit only after all assertions, result publication and awaited disposal succeed.
process.exit(0)
