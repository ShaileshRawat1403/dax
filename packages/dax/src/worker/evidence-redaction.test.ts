import { describe, expect, test } from "bun:test"
import { redactCheckResult, redactEvidenceText } from "./evidence-redaction"

describe("worker evidence redaction", () => {
  test("redacts configured and common credential forms", () => {
    const env = { OPENAI_API_KEY: "sk-proj-configured-secret" }
    const value = [
      "OPENAI_API_KEY=sk-proj-configured-secret",
      "authorization: Bearer abc.def.ghi",
      "token='plain-token-value'",
      "github=ghp_abcdefghijklmnopqrstuvwxyz",
    ].join("\n")

    const redacted = redactEvidenceText(value, env)
    expect(redacted).not.toContain("configured-secret")
    expect(redacted).not.toContain("abc.def.ghi")
    expect(redacted).not.toContain("plain-token-value")
    expect(redacted).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz")
    expect(redacted.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(4)
  })

  test("only changes persisted output previews", () => {
    const result = {
      id: "check-1",
      kind: "test" as const,
      label: "test",
      command: "bun test",
      cwd: "/repo",
      required: true,
      risk: "medium" as const,
      exitCode: 1,
      status: "failed" as const,
      startedAt: "2026-07-11T00:00:00.000Z",
      finishedAt: "2026-07-11T00:00:01.000Z",
      durationMs: 1000,
      stdoutPreview: "token=private-value",
      stderrPreview: "ordinary failure",
    }

    expect(redactCheckResult(result, {})).toEqual({
      ...result,
      stdoutPreview: "token=[REDACTED]",
    })
  })
})
