import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionRoutes } from "@/server/routes/session"
import { Server } from "@/server/server"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian } from "@/execution/contract-guardian"
import { createEventAuthorityRun, transitionEventAuthority } from "@/state/events/event-transitions"
import { getProjectedRunState, readRunEvents } from "@/state/events/run-event-store"
import { WorkerRunEffects, WorkerRunWorkflow } from "@/workflows/worker-run"
import { acquireRunLock } from "@/util/fs-lock"
import type { CheckDefinition, CheckResult } from "@/sdlc/check-types"
import { AntigravityConversation } from "./antigravity-conversation"
import { AntigravityStop } from "./antigravity-stream"

// AGY conversations need POSIX process groups; Windows refuses them before spawning.
const supported = process.platform !== "win32"
const home = mkdtempSync(path.join(os.tmpdir(), "dax-agy-conversation-"))
const previousHome = process.env.DAX_TEST_HOME
process.env.DAX_TEST_HOME = home
// AGY preflight refuses repositories overlapping writable temporary storage (/tmp, TMPDIR).
const repository = supported ? realpathSync(mkdtempSync("/var/tmp/dax-agy-conversation-")) : home
const bin = path.join(home, "bin")
const fakeAgy = path.join(home, "fake-agy.js")
const spawns = path.join(home, "spawns.log")
const model = { providerID: "worker:antigravity", modelID: "fake-model" }

// Speaks the official stream-json protocol. Message markers: TOOLS emits eight
// tool steps, FAILTOOL fails one, DENY reports a soft denial, CRASH_NOW exits.
const fakeAgySource = `#!${process.execPath}
require("node:fs").appendFileSync(process.env.FAKE_AGY_LOG, process.pid + "\\n")
const args = process.argv.slice(2)
const arg = (name) => args[args.indexOf(name) + 1]
const conversation = "fake-" + process.pid
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\\n")
emit({ event: "init", conversation_id: conversation, init: { cwd: arg("--add-dir"), model: arg("--model"), tools: [], permission_mode: "accept-edits" } })
const names = ["run_command", "view_file", "grep_search", "run_command", "grep_search", "view_file", "run_command", "grep_search"]
let turns = 0, step = 0
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const content = JSON.parse(line).message.content
  turns++
  if (content.includes("CRASH_NOW")) process.exit(7)
  for (const [position, name] of (content.includes("TOOLS") ? names : []).entries()) {
    const index = ++step
    emit({ event: "step_update", step_update: { conversation_id: conversation, step_index: index, state: "ACTIVE", step_type: "tool", tool_name: name } })
    emit({ event: "step_update", step_update: content.includes("FAILTOOL") && position === 1
      ? { conversation_id: conversation, step_index: index, state: "ERROR", step_type: "tool", tool_name: name, tool_info: { name, error: { type: "TOOL_ERROR", message: "boom" } } }
      : { conversation_id: conversation, step_index: index, state: "DONE", step_type: "tool", tool_name: name } })
  }
  const reply = (content.match(/REPLY:(\\w+)/) ?? [])[1] ?? "OK"
  const index = ++step
  emit({ event: "step_update", step_update: { conversation_id: conversation, step_index: index, state: "ACTIVE", step_type: "agent_response", text_delta: reply } })
  emit({ event: "result", result: { conversation_id: conversation, status: "SUCCESS", response: reply, duration_seconds: turns, num_turns: turns,
    usage: { input_tokens: turns, output_tokens: turns, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 2 * turns },
    ...(content.includes("DENY") ? { denied_actions: [{ action: "command", display_name: "RunCommand" }] } : {}) } })
}).on("close", () => process.exit(0))
`

function passed(check: CheckDefinition): CheckResult {
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

const within = <T>(fn: () => Promise<T>) => Instance.provide({ directory: repository, fn })
const spawned = () => (existsSync(spawns) ? readFileSync(spawns, "utf8").split("\n").filter(Boolean) : [])
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function govern(task: string) {
  const session = await Session.create({ title: "AGY conversation lifecycle" })
  const { contract } = compileWithRunId(
    {
      request: {
        intent: { input: task, repoPath: repository },
        workflowHint: "worker_run",
        personaPreset: { personaId: "governed-worker", providerHint: "worker:antigravity", modelHint: model.modelID },
        workerConstraints: {
          conversation: {},
          writeScope: ["**"],
          verification: ["bun test"],
          egress: { filter: false, allowHosts: [] },
        },
      },
    },
    session.id,
  )
  await ContractGuardian.create(session.id, contract)
  await createEventAuthorityRun(session.id, contract.contractId, true)
  await transitionEventAuthority(session.id, "queued", "execution_queued", {})
  await transitionEventAuthority(session.id, "running", "workflow_started", {})
  await Session.bindGoverningRun(session.id, session.id)
  return { id: session.id, contract }
}

async function until(id: string, settled: (state: { phase?: string; status?: string }) => boolean) {
  const deadline = Date.now() + 15_000
  for (;;) {
    const state = {
      phase: (await Session.get(id)).externalAgent?.phase,
      status: (await getProjectedRunState(id))?.status,
    }
    if (settled(state)) return state
    if (Date.now() > deadline) throw new Error(`AGY state did not settle: ${JSON.stringify(state)}`)
    await Bun.sleep(20)
  }
}

async function start(task: string) {
  const { id, contract } = await govern(task)
  const execution = new WorkerRunWorkflow({ runId: id, contract }).execute()
  await until(id, ({ phase, status }) => phase === "ready" || status === "failed")
  expect((await Session.get(id)).externalAgent?.phase).toBe("ready")
  return { id, execution, pid: Number(spawned().at(-1)) }
}

async function send(id: string, text: string) {
  const response = await SessionRoutes().request(`/${id}/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, parts: [{ type: "text", text }] }),
  })
  const body = await response.json()
  return { status: response.status, body, message: body?.data?.message as string | undefined }
}

async function stop(id: string) {
  AntigravityConversation.cancel(id)
  await until(id, ({ status }) => status === "failed")
}

describe.skipIf(!supported)("AGY governed conversation lifecycle", () => {
  beforeAll(() => {
    mkdirSync(bin, { recursive: true })
    writeFileSync(fakeAgy, fakeAgySource)
    // Isolation is covered by worker-sandbox tests. DAX still builds the real
    // sandbox argv; these stand-ins exec the worker so lifecycle tests behave
    // the same on hosts without a usable sandbox.
    writeFileSync(path.join(bin, "sandbox-exec"), '#!/bin/sh\nshift 2\nexec "$@"\n')
    writeFileSync(path.join(bin, "bwrap"), '#!/bin/sh\nwhile [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n')
    for (const file of [fakeAgy, path.join(bin, "sandbox-exec"), path.join(bin, "bwrap")]) chmodSync(file, 0o755)
    WorkerRunEffects.set({
      async createCheckout(repoPath, runId) {
        const checkout = path.join(repoPath, ".dax", "worker-checkouts", runId)
        mkdirSync(checkout, { recursive: true })
        return { path: checkout, cleanup: async () => rmSync(checkout, { recursive: true, force: true }) }
      },
      async runConversation(invocation, cwd, contract, effort) {
        return AntigravityConversation.run({
          invocation: {
            ...invocation,
            command: [fakeAgy],
            env: { ...invocation.env, FAKE_AGY_LOG: spawns },
            writableStatePaths: [],
            egress: { mode: "unconfined" },
          },
          cwd,
          contract,
          effort,
          which: (binary) => path.join(bin, binary),
        })
      },
      async computeDiff() {
        return { content: "diff --git a/x.txt b/x.txt\n+x\n", changedPaths: ["x.txt"] }
      },
      async runVerification(check) {
        return passed(check)
      },
    })
  })

  afterAll(async () => {
    WorkerRunEffects.reset()
    await Instance.disposeAll()
    if (previousHome === undefined) delete process.env.DAX_TEST_HOME
    else process.env.DAX_TEST_HOME = previousHome
    rmSync(repository, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  test("tool-heavy turns add one activity observation per turn in one live conversation", async () => {
    await within(async () => {
      const { id } = await start("REPLY:FIRST TOOLS")
      const first = (await Session.get(id)).externalAgent!
      expect(await send(id, "REPLY:SECOND TOOLS FAILTOOL DENY")).toMatchObject({ status: 200 })
      expect((await Session.get(id)).externalAgent).toMatchObject({
        phase: "ready",
        conversationID: first.conversationID,
        generationID: first.generationID,
      })
      expect((await getProjectedRunState(id))?.status).toBe("running")

      const turns = (await Session.messages({ sessionID: id }))
        .filter((message) => message.info.role === "assistant")
        .map((message) => message.parts.flatMap((part) => (part.type === "text" ? [part] : [])))
      expect(turns).toHaveLength(2)
      // One compact report above the reply; the AGY result stays the assistant response.
      expect(turns[0].map((part) => [part.metadata?.origin, part.text])).toEqual([
        [
          "external-agent-report",
          "AGY reported 8 actions · latest: grep_search · observation only, not DAX verification evidence",
        ],
        ["external-agent", "FIRST"],
      ])
      expect(turns[1].map((part) => part.metadata?.origin)).toEqual(["external-agent-report", "external-agent"])
      expect(turns[1][0].metadata?.activity).toMatchObject({
        actions: 8,
        failures: 1,
        failed: ["view_file"],
        denied: ["RunCommand (command)"],
      })
      expect(turns[1][0].metadata?.activity.steps).toHaveLength(8)
      expect(turns[1][0].text).toContain("denied: RunCommand (command); DAX permissions were not expanded")
      expect(turns[1][1].text).toBe("SECOND")
      // AGY tool observations never become canonical evidence.
      const events = (await readRunEvents(id)).map((event) => event.type)
      for (const evidence of ["tool_result_recorded", "mutation_recorded", "verification_recorded"])
        expect(events).not.toContain(evidence)
      await stop(id)
    })
  }, 30_000)

  test("a client disconnect or re-render leaves the backend-owned AGY process live", async () => {
    await within(async () => {
      const { id, pid } = await start("REPLY:FIRST")
      const controller = new AbortController()
      const events = await Server.App().fetch(
        new Request(`http://dax.internal/event?directory=${encodeURIComponent(repository)}`, {
          signal: controller.signal,
        }),
      )
      const reader = events.body!.getReader()
      await reader.read()
      controller.abort()
      await reader.cancel().catch(() => {})
      // A re-rendering client only re-reads state.
      expect((await SessionRoutes().request(`/${id}`)).status).toBe(200)
      await Bun.sleep(100)
      expect(await AntigravityConversation.status(id)).toMatchObject({
        live: true,
        phase: "ready",
        canonicalStatus: "running",
      })
      expect(alive(pid)).toBe(true)
      expect(await send(id, "REPLY:AFTER")).toMatchObject({ status: 200, body: { parts: [{ text: "AFTER" }] } })
      await stop(id)
    })
  }, 30_000)

  test("finish and review seals AGY, then DAX verifies independently and waits for approval", async () => {
    await within(async () => {
      const { id, execution } = await start("REPLY:FIRST TOOLS")
      await AntigravityConversation.finish(id)
      expect((await execution).success).toBe(true)
      expect((await getProjectedRunState(id))?.status).toBe("waiting_approval")
      expect((await Session.get(id)).externalAgent?.phase).toBe("closed")
      const events = await readRunEvents(id)
      const verification = events.find((event) => event.type === "verification_recorded")?.payload as
        | { checks: { command: string }[] }
        | undefined
      // DAX ran the contract's verification; AGY's reported tool actions are not part of it.
      expect(verification?.checks.map((check) => check.command)).toEqual(["bun test"])
      expect(events.map((event) => event.type)).toContain("approval_requested")
      const refused = await send(id, "REPLY:MORE")
      expect(refused.status).toBe(409)
      expect(refused.message).toContain("finished for review")
    })
  }, 30_000)

  test("operator cancellation records its reason, reaps AGY, and refuses later prompts without replay", async () => {
    await within(async () => {
      const { id, pid } = await start("REPLY:FIRST")
      const launches = spawned().length
      expect((await SessionRoutes().request(`/${id}/abort`, { method: "POST" })).status).toBe(200)
      await until(id, ({ phase, status }) => phase === "failed" && status === "failed")
      expect((await getProjectedRunState(id))?.error?.message).toBe(AntigravityStop.operator)
      expect(alive(pid)).toBe(false)
      const messages = (await Session.messages({ sessionID: id })).length
      const refused = await send(id, "REPLY:AGAIN")
      expect(refused.status).toBe(409)
      expect(refused.message).toContain(`Attempt ended: ${AntigravityStop.operator}`)
      expect(refused.message).toContain("sealed")
      expect(spawned()).toHaveLength(launches)
      expect((await Session.messages({ sessionID: id })).length).toBe(messages)
      expect((await getProjectedRunState(id))?.status).toBe("failed")
      expect(await AntigravityConversation.status(id)).toMatchObject({ live: false, stop: { reason: "operator_cancelled" } })
    })
  }, 30_000)

  test("AGY process death seals the attempt with its exit reason and is never replayed", async () => {
    await within(async () => {
      const { id } = await start("REPLY:FIRST")
      const launches = spawned().length
      const crashed = await send(id, "CRASH_NOW")
      expect(crashed.status).toBe(409)
      expect(crashed.message).toBe(`${AntigravityStop.exit} (7).`)
      await until(id, ({ phase, status }) => phase === "failed" && status === "failed")
      expect((await getProjectedRunState(id))?.error?.message).toStartWith(`${AntigravityStop.exit} (7).`)
      const refused = await send(id, "REPLY:AGAIN")
      expect(refused.status).toBe(409)
      expect(refused.message).toContain(`Attempt ended: ${AntigravityStop.exit} (7).`)
      expect(spawned()).toHaveLength(launches)
      expect(await AntigravityConversation.status(id)).toMatchObject({ live: false, stop: { reason: "unexpected_exit" } })
    })
  }, 30_000)

  test("backend instance disposal records ownership release and seals canonical state before returning", async () => {
    const { id, pid } = await within(() => start("REPLY:FIRST"))
    await Instance.disposeAll()
    await within(async () => {
      expect(await getProjectedRunState(id)).toMatchObject({
        status: "failed",
        error: { message: AntigravityStop.released },
      })
      expect((await Session.get(id)).externalAgent?.phase).toBe("failed")
      expect(alive(pid)).toBe(false)
    })
  }, 30_000)

  test("an attempt stranded by a stopped backend is sealed as lost, unless a live process still owns it", async () => {
    await within(async () => {
      const { id } = await govern("REPLY:FIRST")
      await Session.update(id, (draft) => {
        draft.externalAgent = {
          kind: "antigravity",
          model: model.modelID,
          generationID: "previous-backend",
          conversationID: "previous",
          phase: "ready",
        }
      })
      const launches = spawned().length
      const owner = await acquireRunLock(`agy-${id}`)
      try {
        const owned = await send(id, "REPLY:HELLO")
        expect(owned.status).toBe(409)
        expect(owned.message).toContain("another DAX process owns it")
        expect((await getProjectedRunState(id))?.status).toBe("running")
      } finally {
        await owner.dispose()
      }
      const refused = await send(id, "REPLY:HELLO")
      expect(refused.status).toBe(409)
      expect(refused.message).toContain(`Attempt ended: ${AntigravityStop.lost}`)
      expect(await getProjectedRunState(id)).toMatchObject({ status: "failed", error: { message: AntigravityStop.lost } })
      expect((await Session.get(id)).externalAgent?.phase).toBe("failed")
      expect(spawned()).toHaveLength(launches)
    })
  }, 30_000)
})
