import { describe, expect, test } from "bun:test"
import { formatStartGuide } from "./start-guide"
import type { DoctorReport, DoctorSection } from "./index"

function section(over: Partial<DoctorSection> & Pick<DoctorSection, "id" | "readiness">): DoctorSection {
  return {
    title: "Section",
    state: "connected",
    summary: "summary",
    detail: [],
    next: [],
    ...over,
  }
}

function report(sections: DoctorSection[]): DoctorReport {
  return { generatedAt: "2026-08-13T00:00:00.000Z", state: "connected", readiness: "degraded", sections }
}

describe("formatStartGuide", () => {
  test("declares readiness and a first-run suggestion when nothing is pending", () => {
    const out = formatStartGuide(
      report([
        section({ id: "auth", readiness: "ready" }),
        section({ id: "worker", readiness: "ready" }),
      ]),
    )
    expect(out).toContain("DAX is ready")
    expect(out).toContain("dax worker run")
  })

  test("counts pending steps and shows each item's own next action", () => {
    const out = formatStartGuide(
      report([
        section({
          id: "auth",
          readiness: "blocked",
          title: "Provider authentication",
          summary: "No provider connected",
          next: ["Run `dax auth` to connect a model provider."],
        }),
      ]),
    )
    expect(out).toContain("You are 1 step from ready.")
    expect(out).toContain("1. Provider authentication: No provider connected")
    expect(out).toContain("Next: Run `dax auth` to connect a model provider.")
  })

  test("lists blocked items before degraded ones regardless of section order", () => {
    const out = formatStartGuide(
      report([
        section({ id: "worker", readiness: "degraded", title: "Governed workers" }),
        section({ id: "auth", readiness: "blocked", title: "Provider authentication" }),
      ]),
    )
    expect(out).toContain("You are 2 steps from ready.")
    expect(out.indexOf("Provider authentication")).toBeLessThan(out.indexOf("Governed workers"))
  })

  test("falls back to the summary when a pending section has no next action", () => {
    const out = formatStartGuide(
      report([section({ id: "mcp", readiness: "degraded", title: "MCP", summary: "one server failing", next: [] })]),
    )
    expect(out).toContain("Next: one server failing")
  })
})
