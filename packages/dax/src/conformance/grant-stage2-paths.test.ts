import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian } from "@/execution/contract-guardian"
import type { ExecutionContract } from "@/execution/execution-contract"
import { Permission } from "@/governance"
import { Instance } from "@/project/instance"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { LLM } from "@/session/llm"
import { SessionPrompt } from "@/session/prompt"
import { SessionSummary } from "@/session/summary"
import { Sandbox } from "@/shell/sandbox"
import { createEventAuthorityRun } from "@/state/events/event-transitions"
import { readRunEvents } from "@/state/events/run-event-store"
import { Storage } from "@/storage/storage"
import { runCheck } from "@/sdlc/check-runner"
import { verifyWorkerPatch } from "@/worker/worker-verification"
import { Config } from "@/config/config"

/**
 * Grant stage 2, remaining paths. Each records what the shared lookup concludes,
 * record only, in the governing run's journal: command-template shell, prompt
 * attachments, template references and verification commands here; MCP
 * resources and prompts, workflows and workers beside their own harnesses.
 */

let home = ""
let directory = ""
let previousHome: string | undefined
const toolModel = { modelID: "gpt-4o", providerID: "openai" }
const model = Provider.Model.parse({
  id: toolModel.modelID,
  providerID: toolModel.providerID,
  name: "Stage 2 paths",
  api: { id: toolModel.modelID, url: "https://example.invalid", npm: "@ai-sdk/openai" },
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
  limit: { context: 128000, output: 4096 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
})

beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-stage2-paths-"))
  process.env.DAX_TEST_HOME = home
  directory = path.join(home, "project")
  await fs.mkdir(directory, { recursive: true })
  await fs.mkdir(path.join(home, ".config", "dax"), { recursive: true })
  await fs.writeFile(path.join(directory, "seed.txt"), "seed content\n")
  const result = Bun.spawnSync(["git", "init"], { cwd: directory })
  if (result.exitCode) throw new Error(result.stderr.toString())
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

const allowAll: Permission.Ruleset = [{ permission: "*", pattern: "*", action: "allow" }]

/** A session with a stored contract and a canonical run journal. */
async function born(configure: (contract: ExecutionContract) => void = () => {}) {
  const session = await Session.create({ title: "Stage 2 paths" })
  await Session.update(session.id, (draft) => {
    draft.permission = allowAll
  })
  const { contract } = compileWithRunId({ request: { intent: { input: "Work on one file." } } }, session.id)
  contract.toolAllowlist = []
  contract.toolBlocklist = []
  configure(contract)
  await ContractGuardian.create(session.id, contract)
  await createEventAuthorityRun(session.id, contract.contractId)
  return { sessionID: session.id, contractId: contract.contractId }
}

async function shadows(runId: string) {
  return (await readRunEvents(runId))
    .filter((event) => event.type === "capability_resolution_recorded")
    .map((event) => event.payload as Record<string, unknown>)
}

/** A real prompt whose provider turn stops at once; only the user message is produced. */
async function promptWith(sessionID: string, parts: SessionPrompt.PromptInput["parts"]) {
  const getModel = spyOn(Provider, "getModel").mockResolvedValue(model)
  const summary = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
  const stream = spyOn(LLM, "stream").mockImplementation(
    async () =>
      ({
        fullStream: (async function* () {
          yield { type: "start" }
          yield { type: "error", error: new Error("controlled provider stop") }
          yield { type: "finish" }
        })(),
      }) as unknown as Awaited<ReturnType<typeof LLM.stream>>,
  )
  try {
    await SessionPrompt.prompt({ sessionID, agent: "build", model: toolModel, parts })
  } finally {
    stream.mockRestore()
    summary.mockRestore()
    getModel.mockRestore()
  }
}

const attachment = (file: string) => ({
  type: "file" as const,
  mime: "text/plain",
  url: pathToFileURL(file).href,
  filename: path.basename(file),
})

describe("prompt-time reads are recorded, record only", () => {
  test("an attached file records its stat and its read under their own identities", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const { sessionID, contractId } = await born()
        await promptWith(sessionID, [{ type: "text", text: "Look at this." }, attachment(path.join(directory, "seed.txt"))])
        const recorded = (await shadows(sessionID)).filter((item) => item.path === "context_attachment")
        expect(recorded).toEqual([
          {
            subjectId: expect.stringMatching(/^context_attachment_/),
            enforcement: "record_only",
            path: "context_attachment",
            initiator: "operator",
            capabilityId: "session.context.attachment.stat",
            enrolled: true,
            basis: "v1_contract",
            contractId,
            decision: "allow",
            reasonCode: "v1_contract_has_no_selector",
          },
          {
            subjectId: expect.stringMatching(/^context_attachment_/),
            enforcement: "record_only",
            path: "context_attachment",
            initiator: "operator",
            capabilityId: "session.context.attachment.read",
            enrolled: true,
            basis: "v1_contract",
            contractId,
            decision: "allow",
          },
        ])
      },
    })
  })

  test("a shadow denial does not stop the read: the contract was never consulted here, and still is not", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const { sessionID } = await born((contract) => {
          contract.toolBlocklist = ["read"]
        })
        await promptWith(sessionID, [{ type: "text", text: "Look." }, attachment(path.join(directory, "seed.txt"))])
        const read = (await shadows(sessionID)).find((item) => item.capabilityId === "session.context.attachment.read")
        expect(read).toMatchObject({ decision: "deny", reasonCode: "contract_tool_denied" })
        // The attachment was read regardless: its content is in the user message.
        const messages = await Session.messages({ sessionID })
        expect(JSON.stringify(messages)).toContain("seed content")
      },
    })
  })

  test("template references record a stat, attributed to whoever wrote the template", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const { sessionID } = await born()
        await SessionPrompt.resolvePromptParts("Read @seed.txt", { sessionID, initiator: "operator" })
        await SessionPrompt.resolvePromptParts("Read @seed.txt", { sessionID, initiator: "model" })
        const recorded = (await shadows(sessionID)).filter((item) => item.path === "template_reference")
        expect(recorded).toMatchObject([
          { initiator: "operator", capabilityId: "session.context.template.stat", decision: "allow" },
          { initiator: "model", capabilityId: "session.context.template.stat", decision: "allow" },
        ])
        // Without a session to record for, nothing is written and parts still resolve.
        const parts = await SessionPrompt.resolvePromptParts("Read @seed.txt")
        expect(parts.some((part) => part.type === "file")).toBe(true)
        expect((await shadows(sessionID)).filter((item) => item.path === "template_reference")).toHaveLength(2)
      },
    })
  })
})

describe("command-template shell is recorded before any snippet runs", () => {
  test("the shadow names the command-shell identity and the permission ask still decides", async () => {
    await fs.writeFile(
      path.join(directory, "dax.json"),
      JSON.stringify({ command: { "stage-two": { template: "!`echo controlled`" } } }),
    )
    await Instance.provide({
      directory,
      async fn() {
        // The shadow concludes a denial: the contract blocks the shell alias.
        const { sessionID } = await born((contract) => {
          contract.toolBlocklist = ["shell"]
        })
        const marker = path.join(home, "command-ran.txt")
        let recordedBeforeRun = false
        const ask = spyOn(Permission, "ask").mockResolvedValue(undefined as never)
        const wrap = spyOn(Sandbox, "wrap").mockImplementation(async () => {
          recordedBeforeRun = (await shadows(sessionID)).some((item) => item.path === "command_shell")
          return [process.execPath, "-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`]
        })
        const getModel = spyOn(Provider, "getModel").mockRejectedValue(new Error("controlled model boundary"))
        try {
          await SessionPrompt.command({ sessionID, command: "stage-two", arguments: "", model: "openai/gpt-4o" }).catch(
            () => undefined,
          )
        } finally {
          ask.mockRestore()
          wrap.mockRestore()
          getModel.mockRestore()
        }
        expect(recordedBeforeRun).toBe(true)
        expect((await shadows(sessionID)).filter((item) => item.path === "command_shell")).toMatchObject([
          {
            enforcement: "record_only",
            initiator: "operator",
            capabilityId: "session.command.shell",
            basis: "v1_contract",
            decision: "deny",
            reasonCode: "contract_tool_denied",
          },
        ])
        // Record only: the approved command still ran.
        expect(await Bun.file(marker).text()).toBe("ran")
      },
    })
  })
})

describe("verification commands are recorded per check", () => {
  test("the production runner's identity is recorded before each check runs", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const { sessionID } = await born()
        const marker = path.join(directory, "checked.txt")
        await fs.writeFile(path.join(directory, "check.js"), `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`)
        const result = await verifyWorkerPatch({ runId: sessionID, cwd: directory, commands: ["bun run check.js"] })
        expect(result.passed).toBe(true)
        expect((await shadows(sessionID)).filter((item) => item.path === "verification_command")).toMatchObject([
          {
            subjectId: expect.stringMatching(/^verification_worker-verification-1_/),
            initiator: "system",
            capabilityId: "verification.command.direct",
            enrolled: true,
            decision: "allow",
            reasonCode: "v1_contract_has_no_selector",
          },
        ])
      },
    })
  })

  test("a runner injected in place of the production ones is recorded as unenrolled", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const { sessionID } = await born()
        await fs.writeFile(path.join(directory, "check.js"), "")
        await verifyWorkerPatch({
          runId: sessionID,
          cwd: directory,
          commands: ["bun run check.js"],
          run: (check) => runCheck(check),
        })
        const [recorded] = (await shadows(sessionID)).filter((item) => item.path === "verification_command")
        expect(recorded).toMatchObject({ enrolled: false, decision: "allow" })
        expect("capabilityId" in recorded).toBe(false)
      },
    })
  })
})

describe("uncovered and failing journals change nothing", () => {
  test("a session with no canonical journal records nothing, and its reads proceed", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const session = await Session.create({ title: "No journal" })
        const parts = await SessionPrompt.resolvePromptParts("Read @seed.txt", { sessionID: session.id, initiator: "operator" })
        expect(parts.some((part) => part.type === "file")).toBe(true)
        expect(await readRunEvents(session.id).catch(() => [])).toEqual([])
      },
    })
  })

  test("a journal that cannot be read leaves the action as it was, unrecorded", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const { sessionID } = await born()
        const original = Storage.read
        const read = spyOn(Storage, "read").mockImplementation((async (key: string[]) => {
          if (key[0] === "run_authority") throw new Error("injected journal failure")
          return original(key)
        }) as typeof Storage.read)
        const parts = await SessionPrompt.resolvePromptParts("Read @seed.txt", { sessionID, initiator: "operator" }).finally(
          () => read.mockRestore(),
        )
        expect(parts.some((part) => part.type === "file")).toBe(true)
        expect(await shadows(sessionID)).toEqual([])
      },
    })
  })
})
