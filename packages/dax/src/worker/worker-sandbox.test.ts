import { describe, expect, test } from "bun:test"
import {
  buildWorkerSandboxPlan,
  checkWorkerSandbox,
  readBoundedOutput,
  sandboxedCheckStatus,
} from "./worker-sandbox"

const found = (binary: string) => `/usr/bin/${binary}`

describe("worker sandbox", () => {
  test("confines macOS writes while preserving provider network", () => {
    const plan = buildWorkerSandboxPlan({
      command: ["claude", "-p", "task"],
      cwd: "/repo/checkout",
      network: "full",
      platform: "darwin",
      which: found,
    })

    expect(plan.provider).toBe("seatbelt")
    expect(plan.command.slice(0, 2)).toEqual(["/usr/bin/sandbox-exec", "-p"])
    expect(plan.command[2]).toContain('(allow file-write* (subpath "/repo/checkout"))')
    expect(plan.command[2]).not.toContain('(subpath "/private/var/folders")')
    expect(plan.command[2]).toContain("(allow network*)")
    expect(plan.command.slice(-3)).toEqual(["claude", "-p", "task"])
  })

  test("denies verification network on macOS", () => {
    const plan = buildWorkerSandboxPlan({
      command: ["bun", "test"],
      cwd: "/repo/checkout",
      network: "none",
      platform: "darwin",
      which: found,
    })
    expect(plan.command[2]).toContain("(deny network*)")
  })

  test("uses a read-only host with a writable checkout on Linux", () => {
    const plan = buildWorkerSandboxPlan({
      command: ["codex", "exec", "task"],
      cwd: "/repo/checkout",
      network: "full",
      platform: "linux",
      which: found,
    })
    expect(plan.command).toContain("--ro-bind")
    expect(plan.command).toContain("--bind")
    expect(plan.command).toContain("--share-net")
    expect(plan.command.slice(-3)).toEqual(["codex", "exec", "task"])
  })

  test("fails closed when the platform has no supported isolation", () => {
    const result = checkWorkerSandbox({ platform: "win32", which: found, probe: () => ({ exitCode: 0 }) })
    expect(result.available).toBeFalse()
    if (!result.available) expect(result.reason).toContain("not available")
  })

  test("fails closed when the required provider is missing", () => {
    const result = checkWorkerSandbox({ platform: "linux", which: () => null, probe: () => ({ exitCode: 0 }) })
    expect(result.available).toBeFalse()
    if (!result.available) expect(result.reason).toContain("bubblewrap")
  })

  test("fails closed when an installed provider cannot apply isolation", () => {
    const result = checkWorkerSandbox({
      platform: "darwin",
      which: found,
      probe: () => ({ exitCode: 71, stderr: "sandbox_apply: Operation not permitted" }),
    })
    expect(result.available).toBeFalse()
    if (!result.available) expect(result.reason).toContain("isolation probe failed")
  })

  test("reports a provider only after its isolation probe succeeds", () => {
    const result = checkWorkerSandbox({
      platform: "linux",
      which: found,
      probe: () => ({ exitCode: 0 }),
    })
    expect(result).toEqual({
      available: true,
      provider: "bwrap",
      summary: "bubblewrap; checkout-only writes; network denied",
    })
  })

  test("records timeouts distinctly from ordinary command failures", () => {
    expect(sandboxedCheckStatus({ exitCode: 0, timedOut: true })).toBe("timed_out")
    expect(sandboxedCheckStatus({ exitCode: 1, timedOut: false })).toBe("failed")
    expect(sandboxedCheckStatus({ exitCode: 0, timedOut: false })).toBe("passed")
  })

  test("drains command output while retaining a bounded preview", async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("abc"))
        controller.enqueue(encoder.encode("def"))
        controller.close()
      },
    })
    expect(await readBoundedOutput(stream, 5)).toBe("abcde\n...[truncated]")
  })

  test("does not label exact-boundary output as truncated", async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("abc"))
        controller.enqueue(encoder.encode("de"))
        controller.close()
      },
    })
    expect(await readBoundedOutput(stream, 5)).toBe("abcde")
  })
})
