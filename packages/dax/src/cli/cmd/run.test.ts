import { describe, expect, test } from "bun:test"
import { buildExecutionPreview } from "./run"

describe("run command framing", () => {
  test("builds an execution-intent preview for prompt-driven work", () => {
    const preview = buildExecutionPreview({
      intent: "review the release checklist and propose the next safe change",
      files: [{ filename: "README.md" }],
    })

    expect(preview.mode).toBe("intent")
    expect(preview.title).toBe("Execution intent")
    expect(preview.detail).toContain("review the release checklist")
    expect(preview.validation).toContain("governed execution")
    expect(preview.validation).toContain("1 attachment ready")
  })

  test("builds a workflow-command preview when command mode is used", () => {
    const preview = buildExecutionPreview({
      command: "docs",
      intent: "release-readiness",
      files: [],
    })

    expect(preview.mode).toBe("workflow_command")
    expect(preview.title).toBe("Workflow command: docs")
    expect(preview.detail).toBe("docs release-readiness")
    expect(preview.validation).toBe("Execution request validated")
  })
})
