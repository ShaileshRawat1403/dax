import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { Permission } from "@/governance"
import { resolveExecutionAuthority } from "@/execution/contract-guardian"

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z
    .string()
    .describe(
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    )
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})

export const TaskTool = Tool.define("task", async (initCtx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // Filter agents by permissions if agent provided
  return {
    description: DESCRIPTION,
    parameters,
    result: Tool.result(
      z
        .object({
          sessionId: z.string(),
          model: z.union([z.object({ providerID: z.string(), modelID: z.string() }).strict(), z.literal(false)]).optional(),
        })
        .strict(),
    ),
    execute: async (params: z.infer<typeof parameters>, ctx: Tool.Context) => {
      const config = await Config.get()
      const agent = agents.find((a) => a.name === params.subagent_type) || (await Agent.get("general"))
      const model = (agent && typeof agent !== 'string' && agent.model) || (await Agent.get("general").then(a => a!.model))

      const messageID = Identifier.ascending("message")
      const session = params.task_id ? await Session.get(params.task_id) : await Session.fork({ sessionID: ctx.sessionID })

      const parentSession = await Session.get(ctx.sessionID)
      const parentAuthority = await resolveExecutionAuthority(parentSession.id, parentSession.governingRunId)

      // A governed parent may resume only a child already bound to the same
      // immutable contract. Ambiguous historical children are not adopted.
      if (parentAuthority.governingRunId) {
        const childAuthority = await resolveExecutionAuthority(session.id, session.governingRunId)
        if (childAuthority.governingRunId !== parentAuthority.governingRunId) {
          throw new Error(
            `Task session ${session.id} is not governed by parent run ${parentAuthority.governingRunId}`,
          )
        }
      }

      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)

      // Gate subagent spawning behind an explicit permission request so the
      // operator can review the task description and prompt before a new
      // execution context is created.
      await ctx.ask({
        permission: "task",
        patterns: [params.subagent_type],
        always: [params.subagent_type],
        metadata: {
          description: params.description,
          subagent_type: params.subagent_type,
          prompt: params.prompt,
        },
      })

      const approved = await Permission.getApproved()
      const hasTaskPermission = approved.some((p) => p.permission === "task" && p.action === "allow")

      const result = await SessionPrompt.prompt({
        messageID,
        sessionID: session.id,
        model: model ? model : undefined,
        agent: typeof agent === 'string' ? agent : agent!.name,

        tools: {
          todowrite: false,
          todoread: false,
          ...(hasTaskPermission ? {} : { task: false }),
          ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
        },
        parts: promptParts,
      })

      const text = result.parts.findLast((x: MessageV2.Part) => x.type === "text")?.text ?? ""

      const output = [
        `task_id: ${session.id} (for resuming to continue this task if needed)`,
        "",
        "<task_result>",
        text,
        "</task_result>",
      ].join("\n")

      return {
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
        },
        output,
      }
    },
  }
})
