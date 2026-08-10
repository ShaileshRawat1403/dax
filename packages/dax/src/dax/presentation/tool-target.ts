import type { Part } from "@dax-ai/sdk/v2"

/**
 * How a tool call is described to the operator: "read src/index.ts",
 * "shell bun test", "grep useEffect".
 *
 * This lived twice — once in session-surface.ts and once in session-stream.ts
 * as `extractToolTarget` — with the same tool list, the same fallback order and
 * the same defaults, diverging only in how each copy laundered untyped input.
 * One of them is what the operator reads in the stream and the other is what
 * they read in the surface, so the two drifting apart is a correctness problem,
 * not a tidiness one.
 */

export type ToolPart = Extract<Part, { type: "tool" }>

/**
 * Tool inputs and metadata are open records, so every read out of them is
 * narrowed rather than trusted. The previous copies cast to `any` and passed
 * the result straight to `summarizeValue`, which calls `.replace` on it: any
 * tool emitting a non-string input could crash the presentation layer. The
 * other copy wrapped in `String()`, which does not crash but renders
 * "[object Object]" at the operator.
 */
export const asString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)
export const asNumber = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined)
export const firstString = (...values: unknown[]): string | undefined => values.map(asString).find(Boolean)

export function toolInput(part: ToolPart): Record<string, unknown> {
  return part.state.input ?? {}
}

/** Only some tool states carry metadata, and on those it is still optional. */
export function toolMetadata(part: ToolPart): Record<string, unknown> {
  return "metadata" in part.state ? (part.state.metadata ?? {}) : {}
}

export function summarizeValue(value: string | undefined, max = 72): string | undefined {
  if (!value) return undefined
  const normalized = value.replace(/\s+/g, " ").trim()
  if (!normalized) return undefined
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

export function normalizePathLike(value: string | undefined): string | undefined {
  if (!value) return undefined
  return summarizeValue(value.replace(/\\/g, "/"), 64)
}

export function stripQuotes(value: string | undefined): string | undefined {
  if (!value) return value
  return value.replace(/^['"]|['"]$/g, "")
}

export function extractToolTarget(part: Part): string {
  if (part.type !== "tool") return "runtime target"
  const input = toolInput(part)
  const metadata = toolMetadata(part)
  const tool = part.tool.toLowerCase()

  if (tool === "shell") return summarizeValue(asString(input.command), 56) ?? "shell command"
  if (tool === "reflection") return summarizeValue(asString(input.goal), 56) ?? "execution reflection"
  if (tool === "read" || tool === "write" || tool === "edit") {
    return normalizePathLike(firstString(input.filePath, input.path)) ?? "workspace file"
  }
  if (tool === "apply_patch") {
    return normalizePathLike(firstString(metadata.filePath, input.filePath)) ?? "workspace patch"
  }
  if (tool === "grep" || tool === "codesearch" || tool === "websearch") {
    return summarizeValue(stripQuotes(firstString(input.pattern, input.query)), 56) ?? "search query"
  }
  if (tool === "glob" || tool === "list") {
    return summarizeValue(firstString(input.pattern, input.path), 56) ?? "workspace listing"
  }
  if (tool === "webfetch") return summarizeValue(asString(input.url), 56) ?? "external URL"
  if (tool === "task" || tool === "question" || tool === "skill") {
    return summarizeValue(firstString(input.description, input.prompt, input.name), 56) ?? "operator step"
  }
  return (
    summarizeValue(firstString(input.filePath, input.path, input.query, input.pattern, input.command), 56) ??
    "runtime target"
  )
}
