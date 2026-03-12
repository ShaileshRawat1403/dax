export type PMListRow = { day: string; title: string; tags: string[] }
export type PMRuleRow = { ruleType: string; pattern: string; action: "allow" | "deny" | "ask"; source?: string }

export function parsePMList(text: string): { rows: PMListRow[]; info?: string } {
  const trimmed = text.trim()
  if (!trimmed) return { rows: [], info: "Run /pm list to load notes." }
  if (trimmed === "No DSR notes found." || trimmed.startsWith("Usage:")) return { rows: [], info: trimmed }

  const rows: PMListRow[] = []
  for (const rawLine of trimmed.split("\n")) {
    const line = rawLine.trim()
    if (!line.startsWith("- ")) continue
    const match = line.match(/^- (\d{4}-\d{2}-\d{2}) \| (.+?)(?: \[(.+)\])?$/)
    if (!match) continue
    rows.push({
      day: match[1]!,
      title: match[2]!,
      tags: match[3] ? match[3].split(",").map((tag) => tag.trim()).filter(Boolean) : [],
    })
  }

  if (!rows.length) return { rows, info: trimmed }
  return { rows }
}

export function parsePMRules(text: string): { rows: PMRuleRow[]; info?: string } {
  const trimmed = text.trim()
  if (!trimmed) return { rows: [], info: "Run /pm rules to load active rules." }
  if (trimmed === "No PM rules set." || trimmed.startsWith("Usage:")) return { rows: [], info: trimmed }

  const rows: PMRuleRow[] = []
  for (const rawLine of trimmed.split("\n")) {
    const line = rawLine.trim()
    if (!line.startsWith("- ")) continue
    const match = line.match(/^- (\S+)\s+(.+?)\s+->\s+(allow|deny|ask)(?:\s+\(([^)]+)\))?$/)
    if (!match) continue
    rows.push({
      ruleType: match[1]!,
      pattern: match[2]!,
      action: match[3]! as PMRuleRow["action"],
      source: match[4],
    })
  }

  if (!rows.length) return { rows, info: trimmed }
  return { rows }
}
