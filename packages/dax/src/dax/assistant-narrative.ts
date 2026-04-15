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

function buildGuidedPreamble(input: AssistantNarrativeInput) {
  const asked = normalizeAsked(input.asked)

  if (input.hasError) {
    return "I encountered an issue while processing. Let me adjust and try again."
  }

  if (/review|summarize|analy[sz]e|read( me)?|repo|repository|architecture/.test(asked)) {
    return input.completed
      ? "I've completed my analysis of the repository based on the actual code and documentation."
      : "I'm analyzing the repository structure and contents to provide a comprehensive overview."
  }

  if (/fix|debug|error|failing|broken|test|bug|issue/.test(asked)) {
    return input.completed
      ? "I've identified the root cause and mapped out a safe path for the fix."
      : "I'm investigating the failure boundary to find the most direct path to a resolution."
  }

  if (/learn|understand|explain|teach|walk me through/.test(asked)) {
    return input.completed
      ? "I've framed this explanation to highlight the core concepts and next steps."
      : "I'm breaking this down to help you understand the key architectural flows."
  }

  if (input.mode === "plan") {
    return input.completed
      ? "The strategy is now fully mapped and ready for implementation."
      : "I'm drafting a grounded execution plan to ensure we move safely."
  }

  if (input.hasExecuteTool) {
    return "Executing the planned changes now. I'll verify the system state at each step."
  }

  return input.completed
    ? "I've processed the request and refined the current state."
    : "I'm moving forward with the most relevant steps for this task."
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
