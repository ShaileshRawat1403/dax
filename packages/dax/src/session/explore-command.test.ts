import { describe, expect, spyOn, test } from "bun:test"
import os from "os"
import path from "path"
import { rmSync } from "fs"
import { bootstrap } from "../cli/bootstrap"
import * as Intent from "../intent/interpret"
import * as Planner from "../planner/planner"
import * as RunGraph from "../execution/run-graph"
import { addTask, createTaskGraph } from "../planner/task-graph"
import { Provider } from "../provider/provider"
import type { OperatorContext } from "../operators/base"

describe("session /explore command", () => {
  test("streams milestone parts into a single assistant message before the final report", async () => {
    const root = await mkdtemp()

    try {
      await bootstrap(root, async () => {
        const interpretIntentMock = spyOn(Intent, "interpretIntent").mockImplementation(async () => ({
          intentType: "explore_repo",
        }) as any)

        const createPlanMock = spyOn(Planner, "createPlan").mockImplementation(async () => {
          const graph = createTaskGraph("plan_test")
          addTask(graph, {
            id: "task_detect_boundaries",
            name: "Detect Boundaries",
            description: "",
            operator_type: "explore",
            dependencies: [],
            context: {},
          })
          addTask(graph, {
            id: "task_detect_entrypoints",
            name: "Detect Entry Points",
            description: "",
            operator_type: "explore",
            dependencies: ["task_detect_boundaries"],
            context: {},
          })
          addTask(graph, {
            id: "task_trace_execution_flow",
            name: "Trace Execution Flow",
            description: "",
            operator_type: "explore",
            dependencies: ["task_detect_entrypoints"],
            context: {},
          })
          addTask(graph, {
            id: "task_detect_integrations",
            name: "Detect Integrations",
            description: "",
            operator_type: "explore",
            dependencies: ["task_detect_entrypoints"],
            context: {},
          })
          addTask(graph, {
            id: "task_generate_report",
            name: "Generate Report",
            description: "",
            operator_type: "explore",
            dependencies: ["task_trace_execution_flow", "task_detect_integrations"],
            context: {},
          })
          return graph
        })

        const runGraphMock = spyOn(RunGraph, "runGraph").mockImplementation(
          async (
            _graph: any,
            ctx: Pick<OperatorContext, "reportMilestone">,
          ) => {
            await ctx.reportMilestone?.({
              taskID: "task_detect_boundaries",
              label: "Boundary pass completed",
            })
            await ctx.reportMilestone?.({
              taskID: "task_detect_entrypoints",
              label: "Entry-point pass completed",
            })
            await ctx.reportMilestone?.({
              taskID: "task_trace_execution_flow",
              label: "Execution-flow pass completed",
            })
            await ctx.reportMilestone?.({
              taskID: "task_detect_integrations",
              label: "Integrations pass completed",
            })
            return {
              success: false,
              blockedTasks: [],
              failedTasks: ["task_generate_report"],
              warnings: [],
            }
          },
        )

        const { Session } = await import("@/session")
        const { SessionPrompt } = await import("@/session/prompt")
        const { Command } = await import("@/command")

        // BEST PRACTICE: Mock the Provider layer to ensure deterministic results 
        // without hitting live LLM APIs. This validates the orchestration logic.
        const originalGetModel = Provider.getModel
        const originalGetSmallModel = Provider.getSmallModel
        const mockModel = {
          id: "gpt-4o",
          providerID: "openai",
          name: "GPT-4o Mock",
          family: "gpt",
          modalities: { input: ["text"], output: ["text"] },
          cost: { input: 0, output: 0 },
          limit: { context: 128000, output: 4096 },
        } as any

        Provider.getModel = async (providerID, modelID) => {
          if (providerID === "openai" && modelID === "gpt-4o") return mockModel
          return originalGetModel(providerID, modelID)
        }
        Provider.getSmallModel = async (providerID) => {
          if (providerID === "openai") return mockModel
          return originalGetSmallModel(providerID)
        }

        try {
          const session = await Session.create({
            title: "Explore command test",
          })
          const result = await SessionPrompt.command({
            sessionID: session.id,
            command: Command.Default.EXPLORE,
            arguments: ".",
            model: "openai/gpt-4o",
          })

          const messages = await Session.messages({ sessionID: session.id })
          const assistant = messages.find((msg) => msg.info.id === result.info.id)

          expect(assistant).toBeDefined()
          expect(messages.filter((msg) => msg.info.role === "assistant")).toHaveLength(1)

          const textParts = assistant!.parts.filter((part) => part.type === "text")
          const milestoneTexts = textParts.map((part) => part.text)

          expect(milestoneTexts.slice(0, 7)).toEqual([
            "Intent interpreted",
            "Plan created",
            "Boundary pass completed",
            "Entry-point pass completed",
            "Execution-flow pass completed",
            "Integrations pass completed",
            "Explore execution failed. Failed tasks: task_generate_report",
          ])

          expect(textParts.slice(0, 6).every((part) => part.synthetic === true)).toBe(true)
          expect("completed" in assistant!.info.time && assistant!.info.time.completed).toBeDefined()
        } finally {
          interpretIntentMock.mockRestore()
          createPlanMock.mockRestore()
          runGraphMock.mockRestore()
          Provider.getModel = originalGetModel
          Provider.getSmallModel = originalGetSmallModel
        }
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 40000)
})

async function mkdtemp() {
  const root = await Bun.$`mktemp -d ${path.join(os.tmpdir(), "dax-explore-session-XXXXXX")}`.text()
  const dir = root.trim()
  await Bun.$`mkdir -p ${path.join(dir, "src")}`.quiet()
  await Bun.$`mkdir -p ${path.join(dir, "bin")}`.quiet()

  await Bun.write(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "repo",
      bin: { repo: "./bin/repo" },
      dependencies: {
        "@ai-sdk/openai": "1.0.0",
        "@modelcontextprotocol/sdk": "1.0.0",
      },
    }),
  )
  await Bun.write(path.join(dir, "src", "index.ts"), `import yargs from "yargs"\nyargs([]).scriptName("repo")\n`)
  await Bun.write(
    path.join(dir, "src", "session.ts"),
    `while (true) { SessionStatus.set("s", { type: "busy" }); const stream = await LLM.stream({}); }\n`,
  )
  await Bun.write(path.join(dir, "src", "integrations.ts"), `await fetch("https://api.example.com/status")\n`)
  await Bun.write(path.join(dir, "bin", "repo"), "#!/usr/bin/env bun\n")
  return dir
}
