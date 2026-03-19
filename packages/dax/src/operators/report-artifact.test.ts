import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { writeWorkflowArtifact } from "./report-artifact"

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("workflow report artifacts", () => {
  test("writeWorkflowArtifact writes a truthful artifact file", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "dax-artifact-"))
    dirs.push(cwd)

    const { artifact } = await writeWorkflowArtifact({
      cwd,
      sessionId: "session-1",
      taskId: "task-1",
      producingOperator: "verify",
      type: "verification_report",
      filename: "verification-report.json",
      description: "Verification report",
      payload: { ok: true },
    })

    expect(artifact.path.endsWith("verification-report.json")).toBe(true)
    expect(await Bun.file(artifact.path).text()).toContain('"ok": true')
  })
})
