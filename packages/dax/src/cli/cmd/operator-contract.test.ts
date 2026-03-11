import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import { HELP_GROUPS } from "../help"
import { bootstrap } from "../bootstrap"
import { aggregateDoctorReport } from "@/doctor"
import { MCP } from "@/mcp"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const repoConfig = path.join(repoRoot, ".dax", "dax.jsonc")

function withRepoConfig<T>(fn: () => Promise<T>) {
  const previous = process.env.DAX_CONFIG
  process.env.DAX_CONFIG = repoConfig
  return fn().finally(() => {
    if (previous === undefined) delete process.env.DAX_CONFIG
    else process.env.DAX_CONFIG = previous
  })
}

function hasWorkspaceKernel() {
  try {
    if (!fs.existsSync(repoConfig)) return false
    const text = fs.readFileSync(repoConfig, "utf8")
    const match = text.match(/"([^"]*workspace-mcp[^"]*)"/)
    if (!match?.[1]) return false
    return fs.existsSync(match[1])
  } catch {
    return false
  }
}

describe("operator contract coverage", () => {
  test("help groups present the new product guidance", () => {
    expect(HELP_GROUPS).toContain("Start and work: dax | dax plan | dax run | dax explore | dax attach | dax web")
    expect(HELP_GROUPS).toContain(
      "Review and inspect: dax docs | dax mcp | dax approvals | dax artifacts | dax session | dax audit | dax verify | dax release | dax stats",
    )
    expect(HELP_GROUPS).toContain("Diagnose and configure: dax doctor | dax auth | dax models")
  })

  test(
    "doctor aggregate returns the four readiness sections",
    async () => {
      const report = await withRepoConfig(() => bootstrap(repoRoot, () => aggregateDoctorReport(repoRoot)))
      expect(report.sections.map((item) => item.id)).toEqual(["auth", "mcp", "env", "project"])
    },
    40000,
  )

  test("mcp inspect and ping work against workspace kernel when configured", async () => {
    if (!hasWorkspaceKernel()) return

    const inspect = await withRepoConfig(() => bootstrap(repoRoot, () => MCP.inspect("workspace_kernel")))
    expect(inspect.name).toBe("workspace_kernel")
    expect(Array.isArray(inspect.tools)).toBe(true)
    expect(inspect.tools.some((item) => item.name === "kernel_version")).toBe(true)

    const ping = await withRepoConfig(() => bootstrap(repoRoot, () => MCP.ping("workspace_kernel")))
    expect(ping.status.status).toBe("connected")
    expect(typeof ping.latency_ms).toBe("number")
  })
})
