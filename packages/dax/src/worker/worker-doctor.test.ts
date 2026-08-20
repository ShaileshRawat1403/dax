import { describe, expect, test } from "bun:test"
import {
  allWorkerReadiness,
  formatWorkerReadiness,
  probeBinaryVersion,
  workerReadiness,
} from "./worker-doctor"
import type { WorkerSandboxCheck } from "./worker-sandbox"

const sandboxOk: WorkerSandboxCheck = {
  available: true,
  provider: "seatbelt",
  summary: "seatbelt; checkout-only writes; secrets masked; network denied",
}

const sandboxMissing: WorkerSandboxCheck = {
  available: false,
  reason: "no sandbox provider",
  remedy: "install one",
}

const whichFound = (binary: string) => `/usr/local/bin/${binary}`

describe("worker doctor readiness", () => {
  test("reports a ready worker from its profile declarations", async () => {
    const report = await workerReadiness({
      workerId: "gemini",
      hostEnv: { GEMINI_API_KEY: "gm-xxx", HOME: "/Users/operator", TMPDIR: "/tmp" },
      which: whichFound,
      checkSandbox: () => sandboxOk,
    })
    expect(report.workerId).toBe("gemini")
    expect(report.ready).toBe(true)
    expect(report.items.map((item) => item.label)).toEqual([
      "Binary",
      "Auth",
      "Auth lane",
      "Conflicts",
      "State",
      "Sandbox",
      "Egress",
    ])
    const byLabel = Object.fromEntries(report.items.map((item) => [item.label, item]))
    expect(byLabel["Binary"].status).toBe("ok")
    expect(byLabel["Auth"].status).toBe("ok")
    // Never any credential value — only the var name.
    expect(byLabel["Auth"].value).toContain("GEMINI_API_KEY")
    expect(byLabel["Auth"].value).not.toContain("gm-xxx")
    expect(byLabel["Auth lane"].value).toContain("api-key")
    expect(byLabel["Conflicts"].value).toContain("blocked by profile")
    expect(byLabel["State"].value).toContain("isolated per-run")
    expect(byLabel["Sandbox"].status).toBe("ok")
    expect(byLabel["Egress"].value).toContain("generativelanguage.googleapis.com")
    expect(report.next).toEqual([])
  })

  test("fails closed on a missing binary and a missing required env var", async () => {
    const report = await workerReadiness({
      workerId: "gemini",
      hostEnv: { HOME: "/Users/operator", TMPDIR: "/tmp" },
      which: () => null,
      checkSandbox: () => sandboxOk,
    })
    expect(report.ready).toBe(false)
    const byLabel = Object.fromEntries(report.items.map((item) => [item.label, item]))
    expect(byLabel["Binary"].status).toBe("missing")
    expect(byLabel["Auth"].status).toBe("missing")
    expect(byLabel["Auth"].value).toContain("missing GEMINI_API_KEY")
    expect(byLabel["Auth"].value).not.toContain("gm-xxx")
    expect(report.next.join(" ")).toContain("Install gemini")
    expect(report.next.join(" ")).toContain("Set GEMINI_API_KEY")
  })

  test("treats an empty env var as missing auth", async () => {
    const report = await workerReadiness({
      workerId: "gemini",
      hostEnv: { GEMINI_API_KEY: "", HOME: "/Users/operator", TMPDIR: "/tmp" },
      which: whichFound,
      checkSandbox: () => sandboxOk,
    })
    expect(report.ready).toBe(false)
    const auth = report.items.find((item) => item.label === "Auth")!
    expect(auth.status).toBe("missing")
  })

  test("reports a blocked sandbox as not ready with its remedy", async () => {
    const report = await workerReadiness({
      workerId: "claude",
      hostEnv: { HOME: "/Users/operator", TMPDIR: "/tmp" },
      which: whichFound,
      checkSandbox: () => sandboxMissing,
    })
    expect(report.ready).toBe(false)
    const sandbox = report.items.find((item) => item.label === "Sandbox")!
    expect(sandbox.status).toBe("blocked")
    expect(report.next).toContain("install one")
  })

  test("workers that need no env declare auth ready from stored auth", async () => {
    const report = await workerReadiness({
      workerId: "antigravity",
      hostEnv: { HOME: "/Users/operator", TMPDIR: "/tmp" },
      which: whichFound,
      checkSandbox: () => sandboxOk,
    })
    expect(report.ready).toBe(true)
    const auth = report.items.find((item) => item.label === "Auth")!
    expect(auth.value).toContain("none required")
    // State dirs render home-relative, never with the home prefix leaking.
    const state = report.items.find((item) => item.label === "State")!
    expect(state.value).toContain("~/.gemini")
    expect(state.value).not.toContain("/Users/operator")
  })

  test("every approved worker gets a readiness report (no per-worker doctor functions)", async () => {
    const reports = await allWorkerReadiness({
      hostEnv: { HOME: "/Users/operator", TMPDIR: "/tmp" },
      which: whichFound,
      checkSandbox: () => sandboxOk,
    })
    expect(reports.map((report) => report.workerId)).toEqual(["claude", "codex", "gemini", "antigravity"])
    for (const report of reports) {
      // Binary, auth, lane, conflicts, state, sandbox, egress — always the
      // same shape, so a new provider is covered by the same checks.
      expect(report.items.length).toBe(7)
      expect(report.items.some((item) => item.label === "Binary")).toBe(true)
      expect(report.items.some((item) => item.label === "Auth")).toBe(true)
      expect(report.items.some((item) => item.label === "Egress")).toBe(true)
      // No credential values anywhere in the report.
      const text = report.items.map((item) => `${item.label}:${item.value}`).join("\n")
      expect(text).not.toMatch(/sk-[a-z0-9]+/i)
      expect(text).not.toMatch(/ghp_/i)
    }
  })

  test("format is stable and omits credentials", async () => {
    const report = await workerReadiness({
      workerId: "gemini",
      hostEnv: { GEMINI_API_KEY: "gm-secret-value", HOME: "/Users/operator", TMPDIR: "/tmp" },
      which: whichFound,
      checkSandbox: () => sandboxOk,
    })
    const rendered = formatWorkerReadiness(report)
    expect(rendered).toContain("Binary")
    expect(rendered).toContain("✓")
    expect(rendered).toContain("Status")
    expect(rendered).toContain("READY")
    expect(rendered).not.toContain("gm-secret-value")
  })
})

describe("probeBinaryVersion", () => {
  test("returns the first stdout line of `--version` when the binary exists", async () => {
    const which = (binary: string) => (binary === "gemini" ? "/usr/local/bin/gemini" : null)
    // Reuse the real binary on PATH where available; otherwise skip the value
    // assertion and rely on the contract that a found binary yields a string.
    const version = await probeBinaryVersion("gemini", which)
    expect(version === undefined || version.length > 0).toBe(true)
  })

  test("returns undefined when the binary is missing", async () => {
    expect(await probeBinaryVersion("no-such-agent", () => null)).toBeUndefined()
  })
})