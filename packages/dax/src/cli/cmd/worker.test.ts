import { describe, expect, test } from "bun:test"
import { renderVetoCard } from "./worker"

describe("renderVetoCard — Job 2: pre-run confirmation", () => {
  const base = {
    agent: "claude" as const,
    task: "add an isEven helper to shared/util.ts with tests",
    riskLevel: "low",
    writeScope: ["src/**", "test/**"],
    forbiddenPaths: ["package.json"],
    verification: ["bun test"],
    scopeProvenance: "inferred" as const,
  }

  test("card contains all key fields", () => {
    const card = renderVetoCard(base)
    expect(card).toContain("claude")
    expect(card).toContain("add an isEven helper")
    expect(card).toContain("low")
    expect(card).toContain("src/**")
    expect(card).toContain("package.json")
    expect(card).toContain("bun test")
  })

  test("provenance tag is shown for inferred scope", () => {
    const card = renderVetoCard({ ...base, scopeProvenance: "inferred" })
    expect(card).toContain("[inferred]")
    expect(card).not.toContain("[operator-confirmed]")
  })

  test("provenance tag is shown for operator-confirmed scope", () => {
    const card = renderVetoCard({ ...base, scopeProvenance: "operator-confirmed" })
    expect(card).toContain("[operator-confirmed]")
    expect(card).not.toContain("[inferred]")
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
