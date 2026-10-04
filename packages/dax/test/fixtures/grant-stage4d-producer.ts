/** Genuine compiled production modules; no image, authority, dispatch or provider spies. */
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@/global"
import { GrantReviewBarrierError } from "@/execution/grant-review-barrier"
import { Config } from "@/config/config"
import { GrantReview } from "@/capability/grant-review"
import { daxExecutable } from "@/capability/implementation-binding"
import { CapabilityActionDeniedError, recordActionResolution } from "@/capability/record-resolution"
import { mcpReadDescriptor } from "@/mcp/resource-identity"
import { ContractGuardian, readContract } from "@/execution/contract-guardian"
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
import { RunGrantReview } from "@/capability/reviewed-run-contract"

declare const DAX_PRODUCER_VARIANT: string
const home = process.argv[2]!
const phase = process.argv[3]!
const directory = path.join(home, "project")
const evidence = path.join(directory, "evidence.txt")
const sentinel = path.join(directory, "shell-effect")
let providerCalls = 0
const model = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const input = (await request.json()) as { messages: { role: string; content: unknown }[] }
    providerCalls++
    console.error(
      "model request",
      providerCalls,
      input.messages.map((m) => m.role),
    )
    const wantsRead =
      input.messages.some((m) => m.role === "user" && JSON.stringify(m.content).includes("PRODUCER_READ")) &&
      !input.messages.some((m) => m.role === "tool")
    const choice = wantsRead
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
    const finish = wantsRead ? "tool_calls" : "stop"
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
      mcp: { gamma: { type: "remote", url: "http://127.0.0.1:9/fixture", enabled: false } },
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
        const response = await app.request(`/runs/${runId}/grant-review/start`, {
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
      } else if (phase === "api") {
        const app = new Hono().route("/runs", RunRoutes())
        const api = async (url: string, body?: unknown, status = 200) => {
          const response = await app.request(
            `/runs${url === "/" ? "" : url}`,
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
            app.request(`/runs/${runId}/grant-review/start`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ expected: review.expected }),
            }),
          ),
        )
        assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])
        assert.equal((await journal()).filter((event) => event.type === "execution_started").length, 1)
        for (let index = 0; index < 200 && (providerCalls === 0 || SessionStatus.get(runId).type !== "idle"); index++) {
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        assert.ok(providerCalls > 0)
        assert.equal(SessionStatus.get(runId).type, "idle")
        await api(`/${runId}/grant-review/start`, { expected: review.expected }, 409)
        assert.equal((await journal()).filter((event) => event.type === "execution_started").length, 1)
        controls.push("api-genuine-start-at-most-one-dispatch")
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
          const created = CreateRunResponse.parse(await api("/", { ...strict, capabilityReview: {
            ...strict.capabilityReview, writeScope: { roots: ["."], reviewed: true },
          } }))
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
        const neverBinding = neverStarted.subject.bindings!.find((binding) =>
          binding.subject === "native.tool.read",
        )!
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
        assert.equal((await readContract(native.runId))?.schemaVersion, "v2")
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
          const sourceStart = await app.request(`/runs/${saved.remoteRunId}/grant-review/start`, {
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
    }),
  )
} finally {
  model.stop(true)
  await Instance.disposeAll()
}

// Production modules keep this one-shot fixture alive after disposal (specific handle unestablished).
// Exit only after all assertions, result publication and awaited disposal succeed.
process.exit(0)
