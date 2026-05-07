const BOX = {
  tl: "┌", tr: "┐", bl: "└", br: "┘",
  h: "─", v: "│",
  ts: "┬", bs: "┴", ls: "├", rs: "┤", c: "┼",
} as const

export type TableColumn = {
  header: string
  /** Minimum column width (defaults to header length) */
  minWidth?: number
  /** Maximum column width before content wraps */
  maxWidth?: number
}

/**
 * Render a box-drawing ASCII table.
 *
 * @param columns  Column definitions (header + optional width bounds)
 * @param rows     2-D array of string cell values; rows[i][j] corresponds to columns[j]
 * @param maxWidth Total character budget (defaults to min(stdout width, 120))
 */
export function renderTable(
  columns: TableColumn[],
  rows: string[][],
  maxWidth = Math.min((process.stdout.columns || 120), 120),
): string {
  const n = columns.length

  // Natural content width: widest header or cell line per column
  const colWidths = columns.map((col, ci) => {
    const cellMax = rows.reduce((m, row) => {
      return Math.max(m, ...(row[ci] ?? "").split("\n").map((l) => l.length))
    }, 0)
    const natural = Math.max(col.header.length, col.minWidth ?? 0, cellMax)
    const max = col.maxWidth
    return max ? Math.min(natural, max) : natural
  })

  // If the rendered table is wider than maxWidth, shrink the last column
  // (borders + 2 padding chars per column)
  const overhead = n + 1 + n * 2
  const excess = colWidths.reduce((a, b) => a + b, 0) + overhead - maxWidth
  if (excess > 0) {
    const last = colWidths.length - 1
    colWidths[last] = Math.max(12, colWidths[last]! - excess)
  }

  const hline = (left: string, sep: string, right: string) =>
    left + colWidths.map((w) => BOX.h.repeat(w + 2)).join(sep) + right

  const padCell = (text: string, width: number) => ` ${text.padEnd(width)} `

  const wrapText = (text: string, width: number): string[] => {
    const words = (text ?? "").replace(/\s+/g, " ").trim().split(" ")
    const lines: string[] = []
    let cur = ""
    for (const word of words) {
      if (!cur) {
        cur = word
      } else if (cur.length + 1 + word.length <= width) {
        cur += " " + word
      } else {
        lines.push(cur)
        cur = word
      }
    }
    if (cur) lines.push(cur)
    return lines.length ? lines : [""]
  }

  const out: string[] = []

  out.push(hline(BOX.tl, BOX.ts, BOX.tr))
  out.push(BOX.v + columns.map((col, ci) => padCell(col.header, colWidths[ci]!)).join(BOX.v) + BOX.v)
  out.push(hline(BOX.ls, BOX.c, BOX.rs))

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri]!
    const wrapped = colWidths.map((w, ci) => wrapText(row[ci] ?? "", w))
    const lineCount = Math.max(...wrapped.map((w) => w.length))

    for (let li = 0; li < lineCount; li++) {
      out.push(BOX.v + colWidths.map((w, ci) => padCell(wrapped[ci]?.[li] ?? "", w)).join(BOX.v) + BOX.v)
    }

    if (ri < rows.length - 1) {
      out.push(hline(BOX.ls, BOX.c, BOX.rs))
    }
  }

  out.push(hline(BOX.bl, BOX.bs, BOX.br))

  return out.join("\n")
}
