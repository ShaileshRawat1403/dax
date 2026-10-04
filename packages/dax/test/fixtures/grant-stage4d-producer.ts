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
import { projectRunStateFromEvents, readRunEvents } from "@/state/events/run-event-store"
import { reduceRunState } from "@/state/events/run-reducer"
import { Storage } from "@/storage/storage"

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
      if (phase === "matrix") {
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
