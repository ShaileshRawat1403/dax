import { describe, expect, test } from "bun:test"
import { Agent } from "./agent"

describe("Agent module structure", () => {
  test("Agent namespace exports required functions", () => {
    // Match the other Agent suites: module loading belongs to test discovery,
    // not a five-second callback whose abandoned import can outlive its owner.

    expect(typeof Agent.get).toBe("function")
    expect(typeof Agent.list).toBe("function")
    expect(typeof Agent.defaultAgent).toBe("function")
    expect(typeof Agent.generate).toBe("function")
  })
})

test("cold Agent import finishes without provider I/O or subprocess initialization", async () => {
  const { mkdtemp, mkdir, rm } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const path = await import("node:path")
  const { Shell } = await import("@/shell/shell")
  const home = await mkdtemp(path.join(tmpdir(), "dax-agent-import-"))
  await mkdir(path.join(home, ".config", "dax"), { recursive: true })
  const child = Bun.spawn([process.execPath, "--conditions=browser", path.resolve(import.meta.dir, "../../test/fixtures/agent-cold-import.ts")], {
    env: { ...process.env, DAX_TEST_HOME: home, DAX_DISABLE_MODELS_FETCH: "1", DAX_DISABLE_CONFIG_AUTO_INSTALL: "1",
      XDG_CONFIG_HOME: path.join(home, "config"), XDG_DATA_HOME: path.join(home, "data"),
      XDG_CACHE_HOME: path.join(home, "cache"), XDG_STATE_HOME: path.join(home, "state") },
    stdout: "pipe", stderr: "pipe",
  })
  let exited = false
  let timedOut = false
  let termination: Promise<void> | undefined
  const timer = setTimeout(() => {
    timedOut = true
    termination = Shell.killTree(child, { exited: () => exited })
  }, 30_000)
  try {
    const [status, stdout, stderr] = await Promise.all([
      child.exited.then((status) => { exited = true; return status }),
      new Response(child.stdout).text(), new Response(child.stderr).text(),
    ])
    if (timedOut || status !== 0) throw new Error(`Cold Agent import: timeout=${timedOut}, status=${status}\n${stdout}\n${stderr}`)
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!)
    expect(result.available).toBe(true)
    expect(result.networkCalls).toBe(0)
    expect(result.processCalls).toBe(0)
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
    console.log(`Cold Agent import (${process.platform}): ${Math.round(result.elapsedMs)}ms`)
  } finally {
    clearTimeout(timer)
    if (!exited) await Shell.killTree(child, { exited: () => exited })
    await termination
    await child.exited
    await rm(home, { recursive: true, force: true })
  }
}, 40_000)
