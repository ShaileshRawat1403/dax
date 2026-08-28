import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import z from "zod"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { LLM } from "@/session/llm"
import { Provider } from "@/provider/provider"
import { ContractGuardian } from "@/execution/contract-guardian"
import { compileWithRunId } from "@/execution/compiler"
import { Tool } from "@/tool/tool"
import { ToolRegistry } from "@/tool/registry"
import { MCP } from "@/mcp"
import { RunStore } from "@/state/run-store"
import {
  appendRunEvent,
  getRunAuthority,
  projectRunStateFromEvents,
  readRunEvents,
  setRunAuthority,
} from "@/state/events/run-event-store"

let testHome = ""
let previousTestHome: string | undefined
let testProject = ""

const testModel = Provider.Model.parse({
  id: "gpt-4o",
  providerID: "openai",
  name: "Native run birth test model",
  api: { id: "gpt-4o", url: "https://example.invalid", npm: "@ai-sdk/openai" },
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

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  testHome = path.join(os.tmpdir(), `dax-native-birth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
  testProject = path.join(testHome, "project")
  process.env.DAX_TEST_HOME = testHome
  await fs.mkdir(testProject, { recursive: true })
  await fs.mkdir(path.join(testHome, ".config", "dax"), { recursive: true })
  await Instance.disposeAll()
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousTestHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousTestHome
  await fs.rm(testHome, { recursive: true, force: true })
})

async function existingContract(session: Session.Info) {
  const { contract } = compileWithRunId(
    { request: { intent: { input: "Continue this native execution." }, workflowHint: "generic" } },
    session.id,
  )
  await ContractGuardian.create(session.id, contract)
  await Session.bindGoverningRun(session.id, session.id)
  return contract
}

describe("canonical native run birth", () => {
  test("an unbound root becomes a running event-authority run before the model executes", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Native root" })
        let observedAtModelBoundary = false
        const originalGetModel = Provider.getModel
        const getModel = spyOn(Provider, "getModel").mockImplementation(async (providerID, modelID) => {
          if (providerID === "openai" && modelID === "gpt-4o") return testModel
          return originalGetModel(providerID, modelID)
        })
        const stream = spyOn(LLM, "stream").mockImplementation(async () => {
          const persisted = await Session.get(session.id)
          const contract = await ContractGuardian.get(session.id)
          const events = await readRunEvents(session.id)
          const projected = await projectRunStateFromEvents(session.id)
          observedAtModelBoundary =
            persisted.governingRunId === session.id &&
            contract?.workflowClass === "generic" &&
            contract.runtimePolicy?.postconditions?.verificationRequired === true &&
            events.map((event) => event.type).join(",") ===
              "contract_compiled,execution_queued,execution_started" &&
            projected?.status === "running"
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "error", error: new Error("stop after run-birth observation") }
              yield { type: "finish" }
            })(),
          } as unknown as Awaited<ReturnType<typeof LLM.stream>>
        })

        try {
          await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Write a verified report to report.md." }],
          })
          expect(observedAtModelBoundary).toBe(true)
        } finally {
          getModel.mockRestore()
          stream.mockRestore()
        }
      },
    })
  })

  test("noReply remains message-only and does not manufacture execution authority", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Message-only session" })
        await SessionPrompt.prompt({
          sessionID: session.id,
          model: { providerID: "openai", modelID: "gpt-4o" },
          parts: [{ type: "text", text: "Store this message without executing it." }],
          noReply: true,
        })

        expect((await Session.get(session.id)).governingRunId).toBeUndefined()
        expect((await Session.get(session.id)).state_v2?.intent).toBeUndefined()
        expect(await ContractGuardian.get(session.id)).toBeNull()
        expect(await getRunAuthority(session.id)).toBeNull()
        expect(await readRunEvents(session.id)).toEqual([])
      },
    })
  })

  test("a direct loop caller establishes authority before invoking the model", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Direct loop" })
        await SessionPrompt.prompt({
          sessionID: session.id,
          model: { providerID: "openai", modelID: "gpt-4o" },
          parts: [{ type: "text", text: "Inspect this repository." }],
          noReply: true,
        })

        let observedAtModelBoundary = false
        const originalGetModel = Provider.getModel
        const getModel = spyOn(Provider, "getModel").mockImplementation(async (providerID, modelID) => {
          if (providerID === "openai" && modelID === "gpt-4o") return testModel
          return originalGetModel(providerID, modelID)
        })
        const stream = spyOn(LLM, "stream").mockImplementation(async () => {
          observedAtModelBoundary =
            (await getRunAuthority(session.id)) === "event-log" &&
            (await projectRunStateFromEvents(session.id))?.status === "running"
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "error", error: new Error("stop after direct-loop observation") }
              yield { type: "finish" }
            })(),
          } as unknown as Awaited<ReturnType<typeof LLM.stream>>
        })

        try {
          await SessionPrompt.loop({ sessionID: session.id })
          expect(observedAtModelBoundary).toBe(true)
        } finally {
          getModel.mockRestore()
          stream.mockRestore()
        }
      },
    })
  })

  test("native contract birth captures registered and MCP tool identities", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Dynamic tools" })
        await ToolRegistry.register(
          Tool.define("native-plugin-probe", {
            description: "Native contract capability probe",
            parameters: z.object({}).strict(),
            result: Tool.result(z.object({}).strict()),
            async execute() {
              return { title: "probe", output: "probe", metadata: {} }
            },
          }),
        )
        const mcp = spyOn(MCP, "tools").mockResolvedValue({
          native_mcp_probe: {} as Awaited<ReturnType<typeof MCP.tools>>[string],
        })

        try {
          await SessionPrompt.ensureCanonicalRunBirth({ sessionID: session.id, intent: "Use the requested tools." })
          const contract = await ContractGuardian.get(session.id)
          expect(contract?.toolAllowlist).toContain("native-plugin-probe")
          expect(contract?.toolAllowlist).toContain("native_mcp_probe")
        } finally {
          mcp.mockRestore()
        }
      },
    })
  })

  test("concurrent and repeated birth attempts settle one canonical birth sequence", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Concurrent native root" })
        await Promise.all([
          SessionPrompt.ensureCanonicalRunBirth({ sessionID: session.id, intent: "Inspect the repository." }),
          SessionPrompt.ensureCanonicalRunBirth({ sessionID: session.id, intent: "Inspect the repository." }),
        ])
        await SessionPrompt.ensureCanonicalRunBirth({ sessionID: session.id, intent: "Inspect the repository." })

        const events = await readRunEvents(session.id)
        expect(events.map((event) => event.type)).toEqual([
          "contract_compiled",
          "execution_queued",
          "execution_started",
        ])
        expect(events.map((event) => event.seq)).toEqual([0, 1, 2])
      },
    })
  })

  test("a governed child reuses the parent canonical run instead of birthing a child run", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const parent = await Session.create({ title: "Governed parent" })
        await existingContract(parent)
        await SessionPrompt.ensureCanonicalRunBirth({ sessionID: parent.id, intent: "Continue this native execution." })
        const child = await Session.fork({ sessionID: parent.id })

        await SessionPrompt.ensureCanonicalRunBirth({ sessionID: child.id, intent: "Inspect from the child." })

        expect((await Session.get(child.id)).governingRunId).toBe(parent.id)
        expect(await ContractGuardian.get(child.id)).toBeNull()
        expect(await getRunAuthority(child.id)).toBeNull()
        expect(await readRunEvents(child.id)).toEqual([])
        expect((await readRunEvents(parent.id)).map((event) => event.type)).toEqual([
          "contract_compiled",
          "execution_queued",
          "execution_started",
        ])
      },
    })
  })

  test("canonical authority uncertainty and legacy authority fail closed", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const partial = await Session.create({ title: "Partial authority" })
        await existingContract(partial)
        await setRunAuthority(partial.id, "event-log")
        await expect(
          SessionPrompt.ensureCanonicalRunBirth({ sessionID: partial.id, intent: "Do not execute." }),
        ).rejects.toThrow(/no canonical birth event/i)

        const unmarked = await Session.create({ title: "Unmarked events" })
        const unmarkedContract = await existingContract(unmarked)
        await appendRunEvent(unmarked.id, 0, {
          type: "contract_compiled",
          payload: { contractId: unmarkedContract.contractId },
        })
        await expect(
          SessionPrompt.ensureCanonicalRunBirth({ sessionID: unmarked.id, intent: "Do not execute." }),
        ).rejects.toThrow(/events without an authority marker/i)

        const legacy = await Session.create({ title: "Legacy authority" })
        await existingContract(legacy)
        await setRunAuthority(legacy.id, "legacy")
        await expect(
          SessionPrompt.ensureCanonicalRunBirth({ sessionID: legacy.id, intent: "Do not execute." }),
        ).rejects.toThrow(/legacy authority/i)

        const markerlessLegacy = await Session.create({ title: "Markerless legacy state" })
        const markerlessContract = await existingContract(markerlessLegacy)
        await RunStore.create(markerlessLegacy.id, markerlessContract.contractId)
        await expect(
          SessionPrompt.ensureCanonicalRunBirth({ sessionID: markerlessLegacy.id, intent: "Do not execute." }),
        ).rejects.toThrow(/legacy persisted lifecycle state/i)
      },
    })
  })
})
