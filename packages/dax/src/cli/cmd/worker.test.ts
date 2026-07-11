import { describe, expect, test } from "bun:test"
import { renderVetoCard, resolveFieldProvenance } from "./worker"

const base = {
  agent: "claude" as const,
  task: "add an isEven helper to shared/util.ts with tests",
  riskLevel: "low",
  writeScope: ["src/**", "test/**"],
  forbiddenPaths: ["package.json"],
  verification: ["bun test"],
  sources: {
    writeScope: "inferred" as const,
    forbiddenPaths: "operator-authored" as const,
    verification: "inferred" as const,
  },
}

describe("resolveFieldProvenance — eight input combinations", () => {
  // operator-authored always wins regardless of card state
  test("operator-authored, card shown, accepted → operator-authored", () =>
    expect(resolveFieldProvenance("operator-authored", true, true)).toBe("operator-authored"))
  test("operator-authored, card shown, rejected → operator-authored", () =>
    expect(resolveFieldProvenance("operator-authored", true, false)).toBe("operator-authored"))
  test("operator-authored, card not shown, accepted → operator-authored", () =>
    expect(resolveFieldProvenance("operator-authored", false, true)).toBe("operator-authored"))
  test("operator-authored, card not shown, not accepted → operator-authored", () =>
    expect(resolveFieldProvenance("operator-authored", false, false)).toBe("operator-authored"))

  // inferred: outcome depends on card interaction
  test("inferred, card shown, accepted → operator-confirmed", () =>
    expect(resolveFieldProvenance("inferred", true, true)).toBe("operator-confirmed"))
  test("inferred, card shown, not accepted → inferred-unreviewed (abort path; never reaches event)", () =>
    expect(resolveFieldProvenance("inferred", true, false)).toBe("inferred-unreviewed"))
  test("inferred, card not shown (--yes), not accepted → inferred-unreviewed", () =>
    expect(resolveFieldProvenance("inferred", false, false)).toBe("inferred-unreviewed"))
  test("inferred, card not shown (--yes), accepted flag ignored → inferred-unreviewed", () =>
    expect(resolveFieldProvenance("inferred", false, true)).toBe("inferred-unreviewed"))
})

describe("renderVetoCard — Job 2: pre-run confirmation", () => {
  test("card contains all key fields", () => {
    const card = renderVetoCard(base)
    expect(card).toContain("claude")
    expect(card).toContain("add an isEven helper")
    expect(card).toContain("low")
    expect(card).toContain("src/**")
    expect(card).toContain("package.json")
    expect(card).toContain("bun test")
  })

  test("per-field provenance tags are shown correctly", () => {
    const card = renderVetoCard(base)
    expect(card).toContain("[inferred]")
    expect(card).toContain("[operator-authored]")
  })

  test("operator-authored and inferred fields can appear in the same card", () => {
    const card = renderVetoCard(base)
    const writeScopeLine = card.split("\n").find((l) => l.startsWith("Write scope:")) ?? ""
    const forbiddenLine = card.split("\n").find((l) => l.startsWith("Forbidden:")) ?? ""
    expect(writeScopeLine).toContain("[inferred]")
    expect(forbiddenLine).toContain("[operator-authored]")
  })

  test("omits write-scope line when empty", () => {
    const card = renderVetoCard({ ...base, writeScope: [] })
    expect(card).not.toContain("Write scope:")
  })

  test("omits forbidden line when empty", () => {
    const card = renderVetoCard({ ...base, forbiddenPaths: [] })
    expect(card).not.toContain("Forbidden:")
  })

  test("omits verify line when empty", () => {
    const card = renderVetoCard({ ...base, verification: [] })
    expect(card).not.toContain("Verify:")
  })

  test("truncates very long task text", () => {
    const longTask = "x".repeat(100)
    const card = renderVetoCard({ ...base, task: longTask })
    expect(card).toContain("…")
    const taskLine = card.split("\n").find((line) => line.startsWith("Task:")) ?? ""
    expect(taskLine.length).toBeLessThan(100)
  })

  test("card ends with confirmation prompt", () => {
    const card = renderVetoCard(base)
    expect(card).toContain("Press Enter to start the run")
  })
})
