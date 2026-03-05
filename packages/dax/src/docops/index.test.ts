import { describe, expect, test } from "bun:test"
import { DocOps } from "./index"

describe("docops contracts", () => {
  test("result schema accepts stable shape", () => {
    const sample = {
      run_id: "docs_abc",
      timestamp: new Date().toISOString(),
      mode: "qa",
      status: "warn",
      title: "Documentation QA",
      content: "## Docs QA",
      checks: [
        {
          id: "docs.link.broken",
          severity: "medium",
          category: "documentation",
          title: "Broken link",
          evidence: "docs/README.md -> missing.md",
          fix: "Fix link",
          blocking: false,
        },
      ],
      summary: {
        blocker_count: 0,
        warning_count: 1,
        info_count: 0,
      },
      next_actions: ["Fix: Broken link"],
    }
    expect(() => DocOps.Result.parse(sample)).not.toThrow()
  })

  test("guide mode returns pass with content", async () => {
    const result = await DocOps.run({ mode: "guide", topic: "Onboarding" })
    expect(result.mode).toBe("guide")
    expect(result.status).toBe("pass")
    expect(result.content).toContain("# User Guide")
  })

  test("prd mode returns pass with template content", async () => {
    const result = await DocOps.run({ mode: "prd", topic: "Agent UX" })
    expect(result.mode).toBe("prd")
    expect(result.status).toBe("pass")
    expect(result.content).toContain("# PRD:")
  })

  test("qa mode returns valid status", async () => {
    const result = await DocOps.run({ mode: "qa" })
    expect(["pass", "warn", "fail"]).toContain(result.status)
    expect(result.summary.blocker_count).toBeGreaterThanOrEqual(0)
  })

  test("qa strict mode includes profile in result", async () => {
    const result = await DocOps.run({ mode: "qa", qa_profile: "strict" })
    expect(result.mode).toBe("qa")
    expect(result.qa_profile).toBe("strict")
    expect(["pass", "warn", "fail"]).toContain(result.status)
  })
})
