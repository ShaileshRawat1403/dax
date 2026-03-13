export function formatAsMarkdownTable(data: Record<string, unknown>[]): string {
  if (!data || data.length === 0) return ""

  const headers = Object.keys(data[0])
  const rows = data.map((item) => headers.map((h) => String(item[h] ?? "")))

  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))

  const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join(" | ")
  const divider = colWidths.map((w) => "-".repeat(w)).join(" | ")
  const bodyLines = rows.map((row) => row.map((cell, i) => cell.padEnd(colWidths[i])).join(" | "))

  return [headerLine, divider, ...bodyLines].join("\n")
}

export function formatObjectAsMarkdown(obj: Record<string, unknown>, depth = 0): string {
  const indent = "  ".repeat(depth)
  let md = ""

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue

    if (typeof value === "object" && !Array.isArray(value)) {
      md += `${indent}**${key}:**\n`
      md += formatObjectAsMarkdown(value as Record<string, unknown>, depth + 1)
    } else if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] === "object") {
        md += `${indent}**${key}:**\n`
        md += formatAsMarkdownTable(value as Record<string, unknown>[]) + "\n"
      } else {
        md += `${indent}**${key}:** ${value.join(", ")}\n`
      }
    } else if (typeof value === "boolean") {
      md += `${indent}**${key}:** ${value ? "✅" : "❌"}\n`
    } else if (typeof value === "number") {
      md += `${indent}**${key}:** ${value}\n`
    } else {
      md += `${indent}**${key}:** ${value}\n`
    }
  }

  return md
}

export function detectMarkdown(text: string): boolean {
  const markdownPatterns = [/^#{1,6}\s/m, /^\*{1,2}.+\*{1,2}$/m, /^`[^`]+`$/m, /^\d+\.\s/m, /^[-*]\s/m, /^\|.+/m, /^>/m]

  return markdownPatterns.some((pattern) => pattern.test(text))
}

export function formatContentAsMarkdown(content: unknown): string {
  if (typeof content === "string") {
    return detectMarkdown(content) ? content : content
  }

  if (Array.isArray(content)) {
    if (content.length > 0 && typeof content[0] === "object") {
      return formatAsMarkdownTable(content as Record<string, unknown>[])
    }
    return content.map((c) => String(c)).join("\n")
  }

  if (typeof content === "object" && content !== null) {
    return formatObjectAsMarkdown(content as Record<string, unknown>)
  }

  return String(content)
}
