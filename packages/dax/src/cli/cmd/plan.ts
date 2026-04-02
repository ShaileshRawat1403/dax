import type { Argv } from "yargs"
import path from "path"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { EOL } from "os"
import { Provider } from "../../provider/provider"
import { Permission } from "../../governance"
import { Session } from "../../session"
import { SessionPrompt } from "../../session/prompt"

type PlanArgs = {
  intent: string[]
  prompt?: string
  format: "table" | "json"
  model?: string
  title?: string
}

type PlanReadiness = "ready" | "incomplete" | "blocked"

type PlanPreview = {
  type: "plan_preview"
  session_id: string
  intent: string
  plan_path?: string
  readiness: PlanReadiness
  summary: string
  steps: string[]
  content_source: "plan_file" | "assistant_output" | "none"
  note?: string
  error?: string
}

function isTerminalStepReason(reason: string) {
  return !["tool-calls", "unknown"].includes(reason)
}

const INTERACTIVE_RULES: Permission.Ruleset = [
  {
    permission: "question",
    action: "deny",
    pattern: "*",
  },
  {
    permission: "plan_enter",
    action: "deny",
    pattern: "*",
  },
  {
    permission: "plan_exit",
    action: "deny",
    pattern: "*",
  },
]

const NON_INTERACTIVE_PLAN_SYSTEM = [
  "You are running inside the non-interactive dax plan command.",
  "Do not call question, plan_enter, or plan_exit in this flow.",
  "Write the best possible canonical plan file directly.",
  "Assistant prose alone is incomplete. Success means the canonical plan artifact exists on disk at the instructed path.",
  "If information is missing, record assumptions and open questions inside the plan instead of stalling.",
  "Finish by producing a usable plan artifact and concise summary.",
].join(" ")

export const PlanCommand = cmd({
  command: "plan [intent..]",
  describe: "define work before execution using the canonical planning workflow",
  builder: (yargs: Argv) =>
    yargs
      .positional("intent", {
        describe: "execution intent to convert into a structured plan",
        type: "string",
        array: true,
        default: [],
      })
      .option("prompt", {
        describe: "explicit planning intent",
        type: "string",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("title", {
        type: "string",
        describe: "title for the planning session",
      }),
  handler: async (args) => {
    process.env.DAX_FORCE_EXIT = "1"
    const intent = resolveIntent(args as PlanArgs)
    if (!intent) {
      UI.error("You must provide planning intent via positional input or --prompt")
      process.exit(1)
    }

    await bootstrap(process.cwd(), async () => {
      const session = await Session.create({
        title: resolveTitle(args as PlanArgs, intent),
        permission: INTERACTIVE_RULES,
      })
      const sessionID = session.id
      let unexpectedError: string | undefined

      const model = args.model ? Provider.parseModel(args.model) : undefined
      try {
        await SessionPrompt.prompt({
          sessionID,
          agent: "plan",
          model,
          system: NON_INTERACTIVE_PLAN_SYSTEM,
          parts: [{ type: "text", text: intent }],
        })
      } catch (error) {
        const err = error instanceof Error ? error.message : String(error)
        if (!isSuppressedPlanningError(err)) {
          unexpectedError = unexpectedError ? unexpectedError + EOL + err : err
        }
      }

      const preview = await buildPlanPreview({
        sessionID,
        intent,
        suppressedInteractiveGate: false,
        unexpectedError,
      })

      if (args.format === "json") {
        process.stdout.write(JSON.stringify(preview, null, 2) + EOL)
      } else {
        UI.println(formatPlanPreview(preview))
      }

      if (unexpectedError) {
        UI.println(UI.Style.TEXT_WARNING_BOLD + "!", UI.Style.TEXT_NORMAL + unexpectedError)
      }
    })
  },
})

function resolveIntent(args: PlanArgs) {
  const positional = args.intent.join(" ").trim()
  return (args.prompt ?? positional).trim()
}

function resolveTitle(args: PlanArgs, intent: string) {
  if (args.title !== undefined) return args.title
  return intent.slice(0, 50) + (intent.length > 50 ? "..." : "")
}

function normalizePreviewLine(input: string) {
  return input
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^\[[ xX]\]\s+/, "")
    .trim()
}

export function extractPlanSteps(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^([-*+]|\d+\.)\s+/.test(line) || /^\[[ xX]\]\s+/.test(line))
    .map(normalizePreviewLine)
    .filter(Boolean)
}

export function extractPlanSummary(content: string) {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith("<system-reminder>") || line.startsWith("</system-reminder>")) continue
    const normalized = normalizePreviewLine(line)
    if (!normalized) continue
    return normalized
  }
  return "No plan summary available."
}

export function createPlanPreview(input: {
  sessionID: string
  intent: string
  content?: string
  planPath?: string
  suppressedInteractiveGate?: boolean
  contentSource?: PlanPreview["content_source"]
  note?: string
  error?: string
}): PlanPreview {
  const content = input.content?.trim() ?? ""
  const assistantFallbackWithoutPlan = input.contentSource === "assistant_output" && !input.planPath
  const steps = assistantFallbackWithoutPlan ? [] : content ? extractPlanSteps(content) : []
  const summary = assistantFallbackWithoutPlan
    ? "Planning returned assistant output, but no canonical plan file was produced."
    : content
      ? extractPlanSummary(content)
      : input.error
        ? "Planning failed before a plan was produced."
        : "No plan was produced."
  const readiness: PlanReadiness = (() => {
    if (!content) return "blocked"
    if (assistantFallbackWithoutPlan) return "incomplete"
    if (steps.length === 0) return "incomplete"
    return "ready"
  })()

  return {
    type: "plan_preview",
    session_id: input.sessionID,
    intent: input.intent,
    plan_path: input.planPath,
    readiness,
    summary,
    steps,
    content_source: input.contentSource ?? "none",
    note: assistantFallbackWithoutPlan
      ? "Planning produced assistant output, but no canonical plan file was written. Treat this as a draft and avoid executing on it until the plan artifact exists."
      : input.note
        ? input.note
      : input.suppressedInteractiveGate
        ? "Planning reached an interactive checkpoint; review the plan before execution."
        : undefined,
    error: input.error,
  }
}

export function formatPlanPreview(preview: PlanPreview) {
  const lines = [
    `Intent: ${preview.intent}`,
    `Readiness: ${preview.readiness}`,
    `Summary: ${preview.summary}`,
  ]
  if (preview.plan_path) lines.push(`Plan file: ${preview.plan_path}`)
  lines.push(`Source: ${preview.content_source}`)
  if (preview.steps.length > 0) {
    lines.push("Steps:")
    lines.push(...preview.steps.map((step, index) => `${index + 1}. ${step}`))
  } else {
    lines.push("Steps: none extracted")
  }
  if (preview.error) lines.push(`Error: ${preview.error}`)
  if (preview.note) lines.push(`Note: ${preview.note}`)
  return lines.join(EOL)
}

async function buildPlanPreview(input: {
  sessionID: string
  intent: string
  suppressedInteractiveGate: boolean
  unexpectedError?: string
}): Promise<PlanPreview> {
  const session = await Session.get(input.sessionID)
  const planFile = Session.plan(session)
  const exists = await Bun.file(planFile).exists()
  if (exists) {
    const content = await Bun.file(planFile).text()
    return createPlanPreview({
      sessionID: input.sessionID,
      intent: input.intent,
      content,
      planPath: path.relative(process.cwd(), planFile),
      suppressedInteractiveGate: input.suppressedInteractiveGate,
      contentSource: "plan_file",
    })
  }

  const messages = await Session.messages({ sessionID: input.sessionID })
  const assistantText = messages
    .filter((item) => item.info.role === "assistant" && item.info.agent === "plan")
    .flatMap((item) => item.parts)
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join(EOL + EOL)

  const materialized = await materializePlanArtifact({
    planFile,
    assistantText,
  })
  if (materialized) {
    return createPlanPreview({
      sessionID: input.sessionID,
      intent: input.intent,
      content: materialized.content,
      planPath: path.relative(process.cwd(), planFile),
      suppressedInteractiveGate: input.suppressedInteractiveGate,
      contentSource: "plan_file",
      note: "Canonical plan file was materialized from the assistant's final plan output because the model did not write the artifact directly.",
    })
  }

  return createPlanPreview({
    sessionID: input.sessionID,
    intent: input.intent,
    content: assistantText,
    suppressedInteractiveGate: input.suppressedInteractiveGate,
    contentSource: assistantText ? "assistant_output" : "none",
    error: !assistantText ? input.unexpectedError : undefined,
  })
}

function formatSessionError(error: { name?: string; data?: Record<string, unknown> }) {
  if (error.data && "message" in error.data && typeof error.data.message === "string") {
    return error.data.message
  }
  if (typeof error.name === "string" && error.name) return error.name
  return "Unknown planning error"
}

function isSuppressedPlanningError(message: string) {
  return (
    message.includes("The user rejected permission to use this specific tool call") ||
    message.includes("The user dismissed this question")
  )
}

function extractMarkdownFence(text: string) {
  const fence = text.match(/```(?:md|markdown)?\n([\s\S]*?)```/i)
  return fence?.[1]?.trim()
}

async function materializePlanArtifact(input: { planFile: string; assistantText: string }) {
  const artifact = extractMarkdownFence(input.assistantText) ?? input.assistantText.trim()
  if (!artifact) return undefined
  if (!extractPlanSummary(artifact) || extractPlanSteps(artifact).length === 0) return undefined
  await Bun.write(input.planFile, artifact.endsWith(EOL) ? artifact : artifact + EOL)
  return { content: artifact }
}
