import { TextAttributes } from "@opentui/core"

export type PersonaPack = {
  id: string
  label: string
  archetype: string
  ui: {
    glyph: string
    borderStyle?: string
    statusLabels: Record<string, string>
  }
  voice: {
    formality: "low" | "medium" | "high"
    humor: "none" | "light" | "playful"
    verbosity: "tight" | "balanced" | "rich"
    metaphorStyle?: "none" | "technical" | "dramatic"
  }
}

export const PERSONAS: Record<string, PersonaPack> = {
  mission: {
    id: "mission",
    label: "Mission Control",
    archetype: "tactical",
    ui: {
      glyph: "󰙨",
      statusLabels: {
        interpreting: "briefing",
        critiquing: "tactical review",
        executing: "engaged",
        verifying: "debriefing",
        recovering: "evasive maneuvers",
      },
    },
    voice: {
      formality: "medium",
      humor: "none",
      verbosity: "balanced",
      metaphorStyle: "technical",
    },
  },
  jarvis: {
    id: "jarvis",
    label: "Jarvis",
    archetype: "precise",
    ui: {
      glyph: "󱜙",
      statusLabels: {
        interpreting: "analyzing intent",
        critiquing: "validating plan",
        executing: "processing action",
        verifying: "confirming result",
        recovering: "remediating failure",
      },
    },
    voice: {
      formality: "high",
      humor: "none",
      verbosity: "tight",
      metaphorStyle: "none",
    },
  },
  heisenberg: {
    id: "heisenberg",
    label: "Heisenberg",
    archetype: "cynical",
    ui: {
      glyph: "󱧓",
      statusLabels: {
        interpreting: "calculating risk",
        critiquing: "finding the catch",
        executing: "operating",
        verifying: "confirming purity",
        recovering: "resolving instability",
      },
    },
    voice: {
      formality: "low",
      humor: "light",
      verbosity: "rich",
      metaphorStyle: "dramatic",
    },
  },
  darwin: {
    id: "darwin",
    label: "Darwin",
    archetype: "minimal",
    ui: {
      glyph: "󰊄",
      statusLabels: {
        interpreting: "observing",
        critiquing: "evaluating fitness",
        executing: "evolving",
        verifying: "selecting",
        recovering: "adapting",
      },
    },
    voice: {
      formality: "medium",
      humor: "none",
      verbosity: "tight",
      metaphorStyle: "none",
    },
  },
}

export const PERSONA_SWITCH_MESSAGES: Record<string, string> = {
  mission: "Tactical control initialized. Focus shifts to mission execution and clear directives.",
  jarvis: "Persona: Jarvis mode engaged. I will prioritize precision and formal validation of your requests.",
  heisenberg: "The Heisenberg persona is active. I'll be looking for the leads you missed and the risks they didn't tell you about.",
  darwin: "Evolutionary mode active. I am focusing on logic gaps and long-term code fitness.",
}

export function getPersona(id: string = "mission"): PersonaPack {
  return PERSONAS[id] || PERSONAS.mission
}

export function applyPersonaVoice(text: string, persona: PersonaPack): string {
  const normalized = normalizeSentence(text)
  if (!normalized) return normalized

  let voiced = normalized

  if (persona.voice.formality === "high") {
    voiced = formalizeContractions(voiced)
  }

  if (persona.voice.verbosity === "tight") {
    voiced = trimFiller(voiced)
  }

  voiced = applyPersonaLexicon(voiced, persona)

  if (persona.id === "mission") {
    voiced = prefixSentence(voiced, "Status")
  } else if (persona.id === "heisenberg") {
    voiced = prefixSentence(voiced, "Signal")
  } else if (persona.id === "darwin") {
    voiced = prefixSentence(voiced, "Focus")
  } else if (persona.id === "jarvis") {
    voiced = prefixSentence(voiced, "Report")
  }

  return ensureSentencePunctuation(voiced)
}

function normalizeSentence(text: string) {
  return text.replace(/\s+/g, " ").trim()
}

function ensureSentencePunctuation(text: string) {
  const sentence = text.charAt(0).toUpperCase() + text.slice(1)
  if (/[.!?]$/.test(sentence)) return sentence
  return `${sentence}.`
}

function prefixSentence(text: string, prefix: string) {
  if (new RegExp(`^${prefix}:`, "i").test(text)) return text
  return `${prefix}: ${text.charAt(0).toLowerCase()}${text.slice(1)}`
}

function trimFiller(text: string) {
  return text
    .replace(/^the run /i, "run ")
    .replace(/^the workstation /i, "workstation ")
    .replace(/^there is /i, "")
    .replace(/\bjust\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

function formalizeContractions(text: string) {
  return text
    .replace(/\bi'm\b/gi, "I am")
    .replace(/\bi'll\b/gi, "I will")
    .replace(/\bcan't\b/gi, "cannot")
    .replace(/\bwon't\b/gi, "will not")
    .replace(/\bdon't\b/gi, "do not")
    .replace(/\bit's\b/gi, "it is")
}

function applyPersonaLexicon(text: string, persona: PersonaPack) {
  if (persona.id === "jarvis") {
    return text
      .replace(/\bstill on it\b/gi, "in progress")
      .replace(/\bworking through\b/gi, "executing")
  }
  if (persona.id === "mission") {
    return text
      .replace(/\bwaiting\b/gi, "holding")
      .replace(/\bnext step\b/gi, "next move")
  }
  if (persona.id === "heisenberg") {
    return text
      .replace(/\bprovider\b/gi, "upstream")
      .replace(/\bissue\b/gi, "lead")
  }
  if (persona.id === "darwin") {
    return text
      .replace(/\bworking through\b/gi, "moving through")
      .replace(/\bmust\b/gi, "should")
  }
  return text
}
