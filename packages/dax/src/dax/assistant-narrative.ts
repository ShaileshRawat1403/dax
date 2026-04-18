export type AssistantNarrativeIntensity = "light" | "guided" | "operational"

type NarrativeStep = {
  now: string
  next: string
}

type AssistantNarrativeInput = {
  asked: string
  mode: string
  hasPendingTool: boolean
  hasToolActivity: boolean
  toolCount?: number
  hasExecuteTool?: boolean
  hasVerifyTool?: boolean
  hasReasoning: boolean
  hasError: boolean
  completed: boolean
  doing: string
  next: string
  liveStep?: NarrativeStep
}

const LIGHT_REQUEST =
  /^(hi|hello|hey|yo|sup|good (morning|afternoon|evening)|tell me about yourself|who are you|what can you do|how can you help|help me|what('?s| is) your name|thanks|thank you|ok|okay)[!.?\s]*$/i

function normalizeAsked(asked: string) {
  return asked.trim().toLowerCase()
}

function buildGuidedPreamble(input: AssistantNarrativeInput): string | undefined {
  const asked = normalizeAsked(input.asked)

  if (input.hasError) {
    return "Encountered an issue — adjusting approach."
  }

  if (/fix|debug|error|failing|broken|bug|issue/.test(asked)) {
    return input.completed
      ? "Root cause identified."
      : "Tracing the failure."
  }

  if (input.mode === "plan") {
    return input.completed
      ? "Plan ready."
      : "Mapping the execution plan."
  }

  if (input.mode === "audit") {
    return input.completed
      ? "Audit complete."
      : "Reviewing for release risk."
  }

  if (input.mode === "explore") {
    return input.completed ? undefined : "Searching the codebase."
  }

  if (input.mode === "docs") {
    return input.completed ? undefined : "Reading the repository."
  }

  return undefined
}

function isLightRequest(asked: string) {
  const trimmed = asked.trim()
  if (!trimmed) return true
  if (LIGHT_REQUEST.test(trimmed)) return true
  if (
    /review|read|readme|docs|documentation|repo|repository|summarize|analy[sz]e|debug|fix|release|readiness|stream|streaming|architecture|explain|audit|plan/.test(
      trimmed,
    )
  ) {
    return false
  }
  const words = trimmed.split(/\s+/).length
  return words <= 5 && !/[/?]/.test(trimmed)
}

export function classifyAssistantNarrativeIntensity(input: AssistantNarrativeInput): AssistantNarrativeIntensity {
  if (!input.hasPendingTool && !input.hasToolActivity && !input.hasExecuteTool && !input.hasError && isLightRequest(input.asked)) {
    return "light"
  }
  if (input.hasError) return "operational"
  if (input.hasPendingTool) return "operational"
  if (input.hasExecuteTool) return "operational"
  if (input.hasToolActivity) {
    const toolCount = input.toolCount ?? 0
    if (toolCount > 2) return "operational"
    if (input.hasVerifyTool && toolCount > 1) return "operational"
    return "guided"
  }
  return "guided"
}

export function buildAssistantNarrative(input: AssistantNarrativeInput):
  | {
      intensity: AssistantNarrativeIntensity
      preamble?: string
      step?: NarrativeStep
      showWorkingNote: boolean
    }
  | undefined {
  const intensity = classifyAssistantNarrativeIntensity(input)

  if (intensity === "light") {
    return {
      intensity,
      showWorkingNote: false,
    }
  }

  if (intensity === "guided") {
    const preamble = buildGuidedPreamble(input)
    return {
      intensity,
      preamble,
      showWorkingNote: false,
    }
  }

  return {
    intensity,
    step: input.liveStep ?? {
      now: input.doing,
      next: input.next,
    },
    showWorkingNote: false,
  }
}
