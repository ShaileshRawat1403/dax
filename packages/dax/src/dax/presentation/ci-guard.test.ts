import { describe, expect, test } from "bun:test"
import { deriveGitHubCINudge } from "./ci-guard"

describe("ci guard", () => {
  test("nudges after release-sensitive work without a confirmed remote check", () => {
    const nudge = deriveGitHubCINudge({
      recentTools: [{ tool: "shell", status: "completed", label: "Running git push", command: "git push origin HEAD" }],
    })
    expect(nudge?.status).toBe("unknown")
    expect(nudge?.title).toContain("Check GitHub CI")
  })

  test("surfaces confirmed failing gh checks", () => {
    const nudge = deriveGitHubCINudge({
      recentTools: [
        {
          tool: "shell",
          status: "completed",
          label: "Running gh pr checks",
          command: "gh pr checks",
          output: "build\tfail\nlint\tcancelled",
        },
      ],
    })
    expect(nudge?.status).toBe("failed")
    expect(nudge?.tone).toBe("warning")
  })

  test("surfaces confirmed passing gh checks", () => {
    const nudge = deriveGitHubCINudge({
      recentTools: [
        {
          tool: "shell",
          status: "completed",
          label: "Running gh run list",
          command: "gh run list --limit 1",
          output: "CI\tcompleted\tsuccess",
        },
      ],
    })
    expect(nudge?.status).toBe("passed")
    expect(nudge?.tone).toBe("primary")
  })
})
