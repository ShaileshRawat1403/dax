import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import path from "path"
import { tmpdir } from "os"
import { getSnapshotPath, loadSnapshot, saveSnapshot } from "./persist-state"
import type { SessionState } from "./state-types"

async function makeState(sessionId: string, cwd: string): Promise<SessionState> {
  const now = new Date().toISOString()
  return {
    id: sessionId,
    status: "active",
    workspace: { cwd },
    findings: [],
    hypotheses: [],
    openQuestions: [],
    risks: [],
    nextActions: [],
    completedSteps: [],
    emittedArtifacts: [],
    trustState: {
      score: 0.5,
      posture: "neutral",
      signals: [],
      lastUpdated: now,
    },
    approvalState: {
      pending: [],
      granted: [],
      denied: [],
    },
    createdAt: now,
    updatedAt: now,
  }
}

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("snapshot persistence", () => {
  test("anchors snapshot paths to the provided workspace cwd", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "dax-snapshot-a-"))
    dirs.push(cwd)
    const state = await makeState("session-a", cwd)

    await saveSnapshot("session-a", state, { cwd })

    expect(Bun.file(getSnapshotPath("session-a", cwd)).size).toBeGreaterThan(0)
    expect(await loadSnapshot("session-a", cwd)).not.toBeNull()
  })

  test("keeps snapshots isolated across multiple workspaces", async () => {
    const cwdA = await mkdtemp(path.join(tmpdir(), "dax-snapshot-b-"))
    const cwdB = await mkdtemp(path.join(tmpdir(), "dax-snapshot-c-"))
    dirs.push(cwdA, cwdB)

    await saveSnapshot("shared-session", await makeState("shared-session", cwdA), { cwd: cwdA })
    await saveSnapshot("shared-session", await makeState("shared-session", cwdB), { cwd: cwdB })

    expect(getSnapshotPath("shared-session", cwdA)).not.toBe(getSnapshotPath("shared-session", cwdB))
    expect((await loadSnapshot("shared-session", cwdA))?.state.workspace.cwd).toBe(cwdA)
    expect((await loadSnapshot("shared-session", cwdB))?.state.workspace.cwd).toBe(cwdB)
  })
})
