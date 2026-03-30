import { UI } from "@/cli/ui.ts"

type ExitMessageInput = {
  sessionID?: string
  title?: string
  turnCount: number
  tokenCount: number
  generatedTokenCount: number
  elapsedLabel?: string
  costLabel?: string
}

function daxGlyph() {
  return [
    UI.Style.TEXT_INFO_BOLD,
    "D",
    UI.Style.TEXT_NORMAL,
    UI.Style.TEXT_HIGHLIGHT_BOLD,
    "A",
    UI.Style.TEXT_NORMAL,
    UI.Style.TEXT_SUCCESS_BOLD,
    "X",
    UI.Style.TEXT_NORMAL,
  ].join("")
}

export function formatSessionExitMessage(input: ExitMessageInput) {
  const lines = ["", `  ${daxGlyph()} ${UI.Style.TEXT_NORMAL_BOLD}session closed${UI.Style.TEXT_NORMAL}`]

  if (input.title?.trim()) {
    lines.push(`  ${UI.Style.TEXT_DIM}${input.title.trim()}${UI.Style.TEXT_NORMAL}`)
  }

  const snapshot: string[] = []
  if (input.turnCount > 0) snapshot.push(`${input.turnCount} turn${input.turnCount === 1 ? "" : "s"}`)
  if (input.tokenCount > 0) snapshot.push(`${input.tokenCount.toLocaleString()} tokens`)
  if (input.generatedTokenCount > 0) snapshot.push(`generated ${input.generatedTokenCount.toLocaleString()}`)
  if (input.elapsedLabel) snapshot.push(input.elapsedLabel)
  if (input.costLabel && input.costLabel !== "$0.00") {
    snapshot.push(input.costLabel === "included" ? "cost included" : input.costLabel)
  }

  if (snapshot.length > 0) {
    lines.push(`  ${UI.Style.TEXT_DIM}snapshot: ${snapshot.join(" · ")}${UI.Style.TEXT_NORMAL}`)
  }

  if (input.sessionID) {
    lines.push(`  ${UI.Style.TEXT_DIM}resume: dax -s ${input.sessionID}${UI.Style.TEXT_NORMAL}`)
  }

  return lines.join("\n")
}
