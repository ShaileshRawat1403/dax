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
  auditor: {
    id: "auditor",
    label: "The Auditor",
    archetype: "precise",
    ui: {
      glyph: "󱇱",
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
  commander: {
    id: "commander",
    label: "Mission Commander",
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
  detective: {
    id: "detective",
    label: "The Detective",
    archetype: "cynical",
    ui: {
      glyph: "󰭟",
      statusLabels: {
        interpreting: "sizing up the job",
        critiquing: "looking for the catch",
        executing: "hitting the pavement",
        verifying: "checking the story",
        recovering: "getting out of a jam",
      },
    },
    voice: {
      formality: "low",
      humor: "light",
      verbosity: "rich",
      metaphorStyle: "dramatic",
    },
  },
  zen: {
    id: "zen",
    label: "Zen Engineer",
    archetype: "minimal",
    ui: {
      glyph: "󰚳",
      statusLabels: {
        interpreting: "listening",
        critiquing: "reflecting",
        executing: "acting",
        verifying: "observing",
        recovering: "aligning",
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

export function getPersona(id: string = "zen"): PersonaPack {
  return PERSONAS[id] || PERSONAS.zen
}

export function applyPersonaVoice(text: string, persona: PersonaPack): string {
  // This is a simple placeholder. In a real system, this could use a small model or rule-based templates.
  if (persona.voice.formality === "high") {
    return text.charAt(0).toUpperCase() + text.slice(1)
  }
  if (persona.id === "detective") {
    return `Look, ${text.toLowerCase().replace(/\.$/, "")}.`
  }
  return text
}
