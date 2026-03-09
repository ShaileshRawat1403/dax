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

  if (/release|readiness|ship|launch|ga|beta/.test(asked)) {
    return input.completed
      ? "I checked the release surface first so the plan stays grounded in what DAX actually ships today and what could block release."
      : "I’m checking the release surface first so the plan stays grounded in what DAX actually ships today and what could block release."
  }

  if (/fix|debug|error|failing|broken|test|bug|issue/.test(asked)) {
    return input.completed
      ? "I narrowed the problem first so I could focus on the likeliest cause, the real failure boundary, and the safest fix path."
      : "I’m narrowing the problem first so I can focus on the likeliest cause, the real failure boundary, and the safest fix path."
  }

  if (/stream|streaming|delta|render|reasoning/.test(asked)) {
    return input.completed
      ? "I traced the visible streaming path first so we can separate real UX gaps from internal runtime detail."
      : "I’m tracing the visible streaming path first so we can separate real UX gaps from internal runtime detail."
  }

  if (/docs qa|docs quality|documentation quality|audit docs/.test(asked)) {
    return input.completed
      ? "I checked the docs surface for clarity, accuracy, and release risk so the recommendations are actionable."
      : "I’m checking the docs surface for clarity, accuracy, and release risk so the recommendations stay actionable."
  }

  if (/readme|docs|documentation|audit/.test(asked)) {
    return input.completed
      ? "I checked the docs and code context together so the answer stays accurate and useful."
      : "I’m checking the docs and code context together so the answer stays accurate and useful."
  }

  if (/architecture|design|system|workflow|orchestration|boundary|boundaries|data flow|control flow/.test(asked)) {
    return input.completed
      ? "I mapped the main system boundaries first so the explanation reflects how DAX actually works, not just how it is named."
      : "I’m mapping the main system boundaries first so the explanation reflects how DAX actually works, not just how it is named."
  }

  if (/learn|understand|explain|teach|walk me through/.test(asked)) {
    return input.completed
      ? "I framed this to help you understand what matters, why it matters, and what to look at next."
      : "I’m framing this to help you understand what matters, why it matters, and what to look at next."
  }

  if (/what('?s| is) your name|tell me about yourself|who are you|what can you do|how can you help|help me/.test(asked)) {
    return input.completed
      ? "I’m answering this as your engineering teammate here, so I’ll keep it practical, specific, and useful."
      : "I’m answering this directly and keeping it practical for how I can help in this repo."
  }

  if (/review|summarize|analy[sz]e|read( me)?|repo|repository|architecture/.test(asked)) {
    return input.completed
      ? "I read through the repo safely first, so this stays anchored to the actual code and docs."
      : "I’m reading through the repo safely first so this stays anchored to the actual code and docs."
  }

  if (input.mode === "plan") {
    return input.completed
      ? "I kept this read-only so I could shape the clearest next step without changing anything yet."
      : "I’m keeping this read-only so I can shape the clearest next step before changing anything."
  }

  return input.completed
    ? "I shaped this around the clearest next step so you can move quickly."
    : "I’m shaping this around the clearest next step before I go deeper."
}

function isLightRequest(asked: string) {
  const trimmed = asked.trim()
  if (!trimmed) return true
  if (LIGHT_REQUEST.test(trimmed)) return true
  const words = trimmed.split(/\s+/).length
  return words <= 5 && !/[/?]/.test(trimmed)
}

export function classifyAssistantNarrativeIntensity(input: AssistantNarrativeInput): AssistantNarrativeIntensity {
  if (input.hasError) return "operational"
  if (input.hasPendingTool) return "operational"
  if (input.hasExecuteTool) return "operational"
  if (input.hasToolActivity) {
    const toolCount = input.toolCount ?? 0
    if (toolCount > 2) return "operational"
    if (input.hasVerifyTool && toolCount > 1) return "operational"
    return "guided"
  }
  if (!input.hasReasoning && isLightRequest(input.asked)) return "light"
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
