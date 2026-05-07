import { describe, expect, test } from "bun:test"
import { renderTable } from "./table"

describe("renderTable", () => {
  test("renders a simple 2-column table with box-drawing borders", () => {
    const out = renderTable(
      [{ header: "Field" }, { header: "Value" }],
      [
        ["Session", "ses_abc123"],
        ["Outcome", "completed"],
      ],
    )
    expect(out).toContain("┌")
    expect(out).toContain("┐")
    expect(out).toContain("└")
    expect(out).toContain("┘")
    expect(out).toContain("Field")
    expect(out).toContain("Value")
    expect(out).toContain("ses_abc123")
    expect(out).toContain("completed")
  })

  test("wraps long cell text at maxWidth", () => {
    const longText =
      "This is a very long description that should be wrapped across multiple lines when the column max width is exceeded"
    const out = renderTable(
      [{ header: "Label" }, { header: "Description", maxWidth: 30 }],
      [["fix", longText]],
    )
    const lines = out.split("\n")
    // Table should have more than 4 lines (top + header + separator + 1 data + bottom) due to wrapping
    expect(lines.length).toBeGreaterThan(5)
    // All content must be present across lines
    expect(out).toContain("This is a very long")
  })

  test("row separator appears between rows but not after the last row", () => {
    const out = renderTable(
      [{ header: "A" }, { header: "B" }],
      [
        ["r1c1", "r1c2"],
        ["r2c1", "r2c2"],
        ["r3c1", "r3c2"],
      ],
    )
    // ├ appears on header separator + between each pair of rows = 1 + (n-1) = 3 for 3 rows
    const separatorCount = (out.match(/├/g) ?? []).length
    expect(separatorCount).toBe(3)
    // Bottom border uses └
    expect(out.split("\n").at(-1)).toMatch(/^└/)
  })

  test("header column count matches column definitions", () => {
    const out = renderTable(
      [{ header: "Fix" }, { header: "File" }, { header: "Bug" }],
      [["TOCTOU fix", "approval-store.ts", "Race condition in resolve"]],
    )
    // Top border has 2 ┬ separators for 3 columns
    const topBorder = out.split("\n")[0]!
    expect((topBorder.match(/┬/g) ?? []).length).toBe(2)
  })

  test("empty rows array produces header-only table", () => {
    const out = renderTable([{ header: "Fix" }, { header: "File" }], [])
    expect(out).toContain("Fix")
    expect(out).toContain("File")
    // Should still have top, header, separator, bottom
    const lines = out.split("\n")
    expect(lines.length).toBe(4)
  })

  test("minWidth is respected even when content is shorter", () => {
    const out = renderTable([{ header: "X", minWidth: 20 }, { header: "Y" }], [["a", "b"]])
    const headerLine = out.split("\n")[1]!
    // "X" padded to 20 chars, so the cell including padding is at least 22 chars
    expect(headerLine.indexOf("Y") - headerLine.indexOf("X")).toBeGreaterThanOrEqual(22)
  })
})
