import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import os from "os"
import path from "path"
import { mkdirSync, rmSync } from "fs"
import { RunGateway } from "../../src/server/run-gateway"
import { Instance } from "../../src/project/instance"

describe("generic run lifecycle status", () => {
  const testHome = path.join(os.tmpdir(), `dax-generic-run-status-${Date.now().toString(36)}`)
  const previousHome = process.env.DAX_TEST_HOME

  beforeEach(async () => {
    process.env.DAX_TEST_HOME = testHome
    mkdirSync(testHome, { recursive: true })
    const { bootstrap } = await import("../../src/cli/bootstrap")
    await bootstrap(path.resolve(import.meta.dir, "../../.."), async () => {})
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.DAX_TEST_HOME
    else process.env.DAX_TEST_HOME = previousHome
    rmSync(testHome, { recursive: true, force: true })
  })

  test("createRun for generic intent persists running snapshot (not created)", async () => {
    await Instance.provide({
      directory: path.resolve(import.meta.dir, "../../.."),
      async fn() {
        const created = await RunGateway.createRun({
          intent: {
            input: "Give me a short summary of this repository.",
            kind: "general",
          },
          metadata: {
            source: "api",
          },
        })

        expect(created.status === "running" || created.status === "waiting_approval").toBe(true)

        const snapshot = await RunGateway.getSnapshot(created.runId)
        expect(snapshot.status === "running" || snapshot.status === "waiting_approval").toBe(true)
      },
    })
  })
})
