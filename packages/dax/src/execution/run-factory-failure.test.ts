import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "@/project/instance"
import { SessionPrompt } from "@/session/prompt"
import { ShadowAuditor } from "@/execution/shadow-auditor"
import { createRunFromContract } from "@/execution/run-factory"
import { getEventAuthorityState } from "@/state/events/event-transitions"
import { readRunEvents } from "@/state/events/run-event-store"

let testHome = ""
let previousTestHome: string | undefined
let testProject = ""

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  testHome = path.join(
    os.tmpdir(),
    `dax-run-factory-failure-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  )
  testProject = path.join(testHome, "project")
  process.env.DAX_TEST_HOME = testHome
  await fs.mkdir(testProject, { recursive: true })
  await fs.mkdir(path.join(testHome, ".config", "dax"), { recursive: true })
  await Instance.disposeAll()
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousTestHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousTestHome
  await fs.rm(testHome, { recursive: true, force: true })
})

/** Background failure handling is asynchronous; poll rather than guess a delay. */
async function waitForStatus(runId: string, status: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const state = await getEventAuthorityState(runId).catch(() => null)
    if (state?.status === status) return state
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return getEventAuthorityState(runId).catch(() => null)
}

describe("generic run execution failure", () => {
  test("an irrecoverably failed background execution does not leave canonical state running", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        // The defect: RunFactory transitions a generic run to `running` before it
        // dispatches the background prompt, and the dispatch rejection was only
        // logged. Canonical state then claimed an execution that had already died.
        const auditor = spyOn(ShadowAuditor, "analyze").mockResolvedValue(undefined as never)
        const prompt = spyOn(SessionPrompt, "prompt").mockRejectedValue(
          new Error("provider auth rejected the governed execution"),
        )

        try {
          const created = await createRunFromContract({
            request: { intent: { input: "Summarize the repository layout." } },
          })

          const state = await waitForStatus(created.runId, "failed")

          expect(state?.status).toBe("failed")
          expect(state?.status).not.toBe("running")

          // The original reason must stay inspectable, not be swallowed by the
          // transition that records it.
          expect(state?.error?.code).toBe("execution_start_failed")
          expect(state?.error?.message).toContain("provider auth rejected the governed execution")

          // Recorded through the canonical lifecycle, not a parallel failure store.
          const events = await readRunEvents(created.runId)
          expect(events.some((event) => event.type === "run_failed")).toBe(true)
          expect(events.some((event) => event.type === "run_completed")).toBe(false)
        } finally {
          prompt.mockRestore()
          auditor.mockRestore()
        }
      },
    })
  })
})
