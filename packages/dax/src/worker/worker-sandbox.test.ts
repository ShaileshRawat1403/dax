import { describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import {
  buildWorkerSandboxPlan,
  checkWorkerSandbox,
  isolationRemedy,
  readBoundedOutput,
  runSupervisedProcess,
  sandboxedCheckStatus,
  sensitiveReadPaths,
} from "./worker-sandbox"

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const supervise = (script: string, timeoutMs = 5_000) =>
  runSupervisedProcess({
    command: ["sh", "-c", script],
    cwd: process.cwd(),
    env: { PATH: process.env.PATH },
    timeoutMs,
  })

// Governed workers fail closed on native Windows; these exercise the POSIX
// process-group supervisor used by the supported macOS and Linux providers.
const posixProcessGroupTest = test.skipIf(process.platform === "win32")

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
    if (process.env.TMPDIR) {
      // Seatbelt subpath matching is symlink-resolved: the raw /var/folders
      // form never matches the kernel path (/private/var/folders), so the
      // profile must carry the resolved form for tmp writes to work.
      expect(plan.command[2]).toContain(`(subpath "${realpathSync(process.env.TMPDIR)}")`)
    }
    expect(plan.command[2]).toContain("(allow network*)")
    expect(plan.command.slice(-3)).toEqual(["claude", "-p", "task"])
  })

  test("macOS profile carries symlink-resolved subpaths for not-yet-existing state dirs", () => {
    const plan = buildWorkerSandboxPlan({
      command: ["gemini", "--skip-trust", "-p", "task"],
      cwd: "/repo/checkout",
      network: "full",
      platform: "darwin",
      which: found,
      // Simulates the gemini isolated home: under a symlinked root (/tmp),
      // deeper than anything that exists yet.
      writableStatePaths: ["/tmp/dax-test/state"],
    })
    const profile = plan.command[2]
    // /tmp -> /private/tmp: the resolved form is what Seatbelt matches.
    expect(profile).toContain('(subpath "/private/tmp/dax-test/state")')
    expect(profile).toContain('(subpath "/repo/checkout")')
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

  test("fails closed on Windows and points to WSL2", () => {
    const result = checkWorkerSandbox({ platform: "win32", which: found, probe: () => ({ exitCode: 0 }) })
    expect(result.available).toBeFalse()
    if (!result.available) {
      expect(result.reason).toContain("not available")
      expect(result.remedy).toContain("WSL2")
    }
  })

  test("fails closed when the required provider is missing, with an install remedy", () => {
    const result = checkWorkerSandbox({ platform: "linux", which: () => null, probe: () => ({ exitCode: 0 }) })
    expect(result.available).toBeFalse()
    if (!result.available) {
      expect(result.reason).toContain("bubblewrap")
      expect(result.remedy).toContain("bwrap")
    }
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

  test("isolationRemedy gives a platform-specific, actionable next step", () => {
    expect(isolationRemedy("win32")).toContain("WSL2")
    expect(isolationRemedy("linux")).toContain("bwrap")
    expect(isolationRemedy("darwin")).toContain("sandbox-exec")
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
      summary: "bubblewrap; checkout-only writes; secrets masked; network denied",
    })
  })

  // C1: a governed worker can read the whole disk except known credential
  // stores. These pin the deny-list so the confidentiality boundary cannot
  // silently regress back to a fully readable home directory.

  test("masks credential stores from macOS reads while leaving the checkout readable", () => {
    const plan = buildWorkerSandboxPlan({
      command: ["claude", "-p", "task"],
      cwd: "/repo/checkout",
      network: "full",
      platform: "darwin",
      which: found,
      home: "/home/tester",
    })
    const profile = plan.command[2]
    expect(profile).toContain('(deny file-read* (subpath "/home/tester/.ssh"))')
    expect(profile).toContain('(deny file-read* (subpath "/home/tester/.aws"))')
    expect(profile).toContain('(deny file-read* (subpath "/home/tester/.git-credentials"))')
    // The worker's own config dirs stay readable, or provider auth breaks.
    expect(profile).not.toContain("/home/tester/.codex")
    expect(profile).not.toContain("/home/tester/.claude")
    expect(profile).not.toContain("/home/tester/.gemini")
    // The checkout is still readable and writable.
    expect(profile).toContain('(allow file-write* (subpath "/repo/checkout"))')
    expect(plan.summary).toContain("secrets masked")
  })

  test("masks credential stores from Linux reads with tmpfs and /dev/null binds", () => {
    const plan = buildWorkerSandboxPlan({
      command: ["codex", "exec", "task"],
      cwd: "/repo/checkout",
      network: "full",
      platform: "linux",
      which: found,
      home: "/home/tester",
    })
    // Directory secret: shadowed by an empty tmpfs.
    const sshIndex = plan.command.indexOf("/home/tester/.ssh")
    expect(sshIndex).toBeGreaterThan(-1)
    expect(plan.command[sshIndex - 1]).toBe("--tmpfs")
    // File secret: shadowed by /dev/null via the tolerant -try bind.
    expect(plan.command).toContain("--ro-bind-try")
    expect(plan.command).toContain("/home/tester/.git-credentials")
    // Worker config dirs remain readable through the host bind.
    expect(plan.command).not.toContain("/home/tester/.codex")
    // The checkout bind survives ahead of the chdir.
    expect(plan.command).toContain("--bind")
    expect(plan.command).toContain("/repo/checkout")
  })

  // C1 sequel: the worker's own state dir (e.g. ~/.codex) must be writable at
  // init or the CLI fails closed. These pin that the allowance reaches the
  // profile without re-opening the repo guarantee.

  test("makes the worker state dir writable on macOS without widening the summary claim", () => {
    const plan = buildWorkerSandboxPlan({
      command: ["codex", "exec", "task"],
      cwd: "/repo/checkout",
      network: "full",
      platform: "darwin",
      which: found,
      home: "/home/tester",
      writableStatePaths: ["/home/tester/.codex"],
    })
    const profile = plan.command[2]
    // The state dir appears as a writable subpath. Its exact prefix is the
    // kernel-resolved realpath (symlinks AND firmlinks: /home lives on the APFS
    // data volume here), so match on the tail, not a literal path.
    expect(profile).toMatch(/\(allow file-write\* \(subpath "[^"]*\.codex"\)\)/)
    expect(profile).toContain('(allow file-write* (subpath "/repo/checkout"))')
    expect(plan.summary).toContain("worker-state writes")
  })

  test("binds the worker state dir read-write on Linux with a tolerant bind", () => {
    const plan = buildWorkerSandboxPlan({
      command: ["codex", "exec", "task"],
      cwd: "/repo/checkout",
      network: "full",
      platform: "linux",
      which: found,
      home: "/home/tester",
      writableStatePaths: ["/home/tester/.codex"],
    })
    const idx = plan.command.indexOf("/home/tester/.codex")
    expect(idx).toBeGreaterThan(-1)
    expect(plan.command[idx - 1]).toBe("--bind-try")
  })

  test("keeps the checkout-only summary when the worker needs no state dir", () => {
    const plan = buildWorkerSandboxPlan({
      command: ["claude", "-p", "task"],
      cwd: "/repo/checkout",
      network: "full",
      platform: "darwin",
      which: found,
    })
    expect(plan.summary).toContain("checkout-only writes")
  })

  test("exposes the deny-list as a pure, injectable function", () => {
    const paths = sensitiveReadPaths("/home/tester")
    expect(paths).toContainEqual({ path: "/home/tester/.ssh", kind: "dir" })
    expect(paths).toContainEqual({ path: "/home/tester/.git-credentials", kind: "file" })
    expect(paths.every((p) => p.path.startsWith("/home/tester/"))).toBeTrue()
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

  // P0.0 gate 5: no worker descendant may survive the call, on any exit path.

  posixProcessGroupTest("kills a descendant the worker leaves behind after exiting cleanly", async () => {
    // P0.0 T5. The worker exits zero while a kernel it started keeps running.
    // Signalling only the direct child misses it.
    const result = await supervise("sleep 60 >/dev/null 2>&1 & echo $!; exit 0")
    const descendant = Number(result.stdout.trim())

    expect(result.exitCode).toBe(0)
    expect(result.reapedDescendants).toBe(true)
    expect(alive(descendant)).toBe(false)
  })

  posixProcessGroupTest("does not hang when a timed-out worker ignores SIGTERM", async () => {
    // P0.0 T4, the case that stayed open: SIGTERM alone left descendants alive
    // for minutes. Escalation cannot wait on the process, because the process
    // is what is refusing to exit. Returning at all is the assertion.
    const started = Date.now()
    const result = await supervise("trap '' TERM; sleep 60", 300)

    expect(result.timedOut).toBe(true)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  posixProcessGroupTest("returns captured output even when a descendant holds the pipes open", async () => {
    // An orphan inherits stdout, so the stream stays open while it lives.
    // Reaping has to happen before the output is awaited or this blocks until
    // the timeout.
    const started = Date.now()
    const result = await supervise("sleep 60 & echo parent-done; exit 0", 30_000)

    expect(result.stdout).toContain("parent-done")
    expect(result.timedOut).toBe(false)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  test("reports no reaping when the worker leaves nothing behind", async () => {
    // Guards the evidence signal against false positives: a clean run must not
    // claim descendants were killed.
    const result = await supervise("echo clean; exit 0")

    expect(result.stdout).toContain("clean")
    expect(result.exitCode).toBe(0)
    expect(result.timedOut).toBe(false)
    expect(result.reapedDescendants).toBe(false)
  })
})
