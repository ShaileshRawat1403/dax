import fs from "fs"
import path from "path"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { aggregateProductState, labelProductState, type ProductState } from "@/dax/status"
import { MCP } from "@/mcp"
import { diagnoseProviderAuth, expectedGoogleOauthClientIds, type AuthDiagnostics } from "@/provider/auth-preflight"
import { Project } from "@/project/project"
import { Vcs } from "@/project/vcs"
import { detectPythonEnvironment } from "@/cli/cmd/tui/util/environment"

export type DoctorSection = {
  id: "auth" | "mcp" | "env" | "project"
  title: string
  state: ProductState
  summary: string
  detail: string[]
  next: string[]
}

export type DoctorReport = {
  generatedAt: string
  state: ProductState
  sections: DoctorSection[]
}

function exists(filepath: string) {
  try {
    return fs.existsSync(filepath)
  } catch {
    return false
  }
}

function countMcpStates(statuses: Record<string, MCP.Status>) {
  const values = Object.values(statuses)
  return {
    total: values.length,
    connected: values.filter((item) => item.status === "connected").length,
    failed: values.filter((item) => item.status === "failed").length,
    blocked: values.filter((item) => item.status === "needs_auth" || item.status === "needs_client_registration").length,
    disabled: values.filter((item) => item.status === "disabled").length,
  }
}

function authSectionFromReports(reports: AuthDiagnostics[]): DoctorSection {
  const failing = reports.filter((item) => !item.ok)
  const state: ProductState = failing.length > 0 ? "blocked" : "connected"
  const summary =
    failing.length > 0
      ? `${failing.length} provider authentication check${failing.length === 1 ? "" : "s"} need attention`
      : `${reports.length} provider authentication check${reports.length === 1 ? "" : "s"} passed`

  const detail = reports.flatMap((report) => {
    const base = `${report.providerID}: ${report.ok ? "connected" : "blocked"} (${report.mode})`
    const missing = report.missingEnv.length > 0 ? `missing ${report.missingEnv.join(", ")}` : undefined
    return [base, ...(missing ? [missing] : []), ...report.details.map((item) => `${report.providerID}: ${item}`)]
  })

  const next =
    failing.length > 0
      ? [
          "Run `dax auth login` for the provider you want to use first.",
          "Run `dax doctor auth --json` for machine-readable diagnostics.",
        ]
      : ["Authentication is ready for the checked providers."]

  const audiences = expectedGoogleOauthClientIds()
  if (audiences.length > 0) {
    detail.push(`Google OAuth client ids in play: ${audiences.join(", ")}`)
  }

  return {
    id: "auth",
    title: "Authentication",
    state,
    summary,
    detail,
    next,
  }
}

export async function authSection(model?: string): Promise<DoctorSection> {
  const checks = model
    ? [model.split("/")[0] ?? model]
    : ["google", "google-vertex", "google-vertex-anthropic"]
  const reports = await Promise.all(checks.map((providerID) => diagnoseProviderAuth(providerID)))
  return authSectionFromReports(reports)
}

export async function mcpSection(): Promise<DoctorSection> {
  const config = await Config.get()
  const statuses = await MCP.status()
  const counts = countMcpStates(statuses)
  const names = Object.keys(config.mcp ?? {})

  if (names.length === 0) {
    return {
      id: "mcp",
      title: "MCP",
      state: "waiting" as const,
      summary: "No MCP servers configured",
      detail: ["DAX can run without MCP, but MCP is available as an optional first-class capability."],
      next: [
        "Add a local MCP server in dax.json or .dax/dax.jsonc.",
        "Run `dax mcp list` after configuring a server.",
      ],
    }
  }

  const state: ProductState =
    counts.failed > 0 ? "failed" : counts.blocked > 0 ? "blocked" : counts.connected > 0 ? "connected" : "waiting"
  const summary =
    counts.connected > 0
      ? `${counts.connected}/${counts.total} MCP server${counts.total === 1 ? "" : "s"} connected`
      : counts.blocked > 0
        ? `${counts.blocked} MCP server${counts.blocked === 1 ? "" : "s"} blocked`
        : `${counts.total} MCP server${counts.total === 1 ? "" : "s"} waiting`

  const detail = Object.entries(statuses).map(([name, status]) => {
    if (status.status === "connected") return `${name}: connected`
    if (status.status === "disabled") return `${name}: waiting (disabled in config)`
    if (status.status === "needs_auth") return `${name}: blocked (needs authentication)`
    if (status.status === "needs_client_registration") return `${name}: blocked (${status.error})`
    return `${name}: failed (${status.error})`
  })

  const next =
    state === "connected"
      ? ["Run `dax mcp ping <server>` or `dax mcp tools <server>` to inspect a server."]
      : [
          "Run `dax mcp list` to inspect current MCP state.",
          "Use `dax mcp auth <server>` for remote OAuth servers when needed.",
        ]

  return {
    id: "mcp",
    title: "MCP",
    state,
    summary,
    detail,
    next,
  }
}

export async function envSection(cwd: string = process.cwd()): Promise<DoctorSection> {
  const report = detectPythonEnvironment(cwd)
  const state: ProductState = report.inVirtualEnv || !report.projectHasPythonSignals ? "connected" : "waiting"
  const summary = report.inVirtualEnv
    ? `Python environment active (${report.virtualEnvType})`
    : report.projectHasPythonSignals
      ? "Project-local environment recommended"
      : "No Python project signals detected"

  return {
    id: "env" as const,
    title: "Environment",
    state,
    summary,
    detail: [
      `cwd: ${report.cwd}`,
      `active env: ${report.virtualEnvType}${report.virtualEnvPath ? ` (${report.virtualEnvPath})` : ""}`,
      `project envs: ${report.projectVenvPaths.length > 0 ? report.projectVenvPaths.map((item) => path.basename(item)).join(", ") : "none"}`,
      `package manager hints: ${report.packageManagerHints.length > 0 ? report.packageManagerHints.join(", ") : "none"}`,
      `recommendation: ${report.recommendation}`,
    ],
    next:
      state === "connected"
        ? ["Environment looks ready."]
        : ["Activate or create a project-local virtual environment before Python package installs."],
  }
}

export async function projectSection(cwd: string = process.cwd()): Promise<DoctorSection> {
  const info = await Project.fromDirectory(cwd)
  const branch = await Vcs.branch().catch(() => undefined)
  const hasPackageJson = exists(path.join(cwd, "package.json"))
  const hasCargoToml = exists(path.join(cwd, "Cargo.toml"))
  const hasGit = info.project.vcs === "git"
  const state: ProductState = hasGit || hasPackageJson || hasCargoToml ? "connected" : "waiting"

  return {
    id: "project" as const,
    title: "Project",
    state,
    summary: hasGit
      ? `Git workspace ready${branch ? ` on ${branch}` : ""}`
      : hasPackageJson || hasCargoToml
        ? "Project signals detected"
        : "Loose directory detected",
    detail: [
      `directory: ${cwd}`,
      `worktree: ${info.project.worktree}`,
      `project id: ${info.project.id}`,
      hasGit ? `vcs: git${branch ? ` (${branch})` : ""}` : "vcs: none",
      hasPackageJson ? "node project signal: package.json" : "node project signal: none",
      hasCargoToml ? "rust project signal: Cargo.toml" : "rust project signal: none",
    ],
    next:
      state === "connected"
        ? ["Project context is ready."]
        : ["Open DAX inside a project directory to unlock richer context, audit, and diff flows."],
  }
}

export async function aggregateDoctorReport(cwd: string = process.cwd(), model?: string): Promise<DoctorReport> {
  const sections = await Promise.all([authSection(model), mcpSection(), envSection(cwd), projectSection(cwd)])
  return {
    generatedAt: new Date().toISOString(),
    state: aggregateProductState(sections.map((item) => item.state)),
    sections,
  }
}

export function doctorExitCode(state: ProductState) {
  return state === "connected" || state === "waiting" ? 0 : 1
}

export function formatDoctorSection(section: DoctorSection) {
  const lines = [`${section.title}: ${labelProductState(section.state)}`, `  ${section.summary}`]
  for (const item of section.detail) {
    lines.push(`  - ${item}`)
  }
  for (const item of section.next) {
    lines.push(`  next: ${item}`)
  }
  return lines.join("\n")
}

export function formatDoctorReport(report: DoctorReport) {
  return [
    `DAX doctor: ${labelProductState(report.state)}`,
    ...report.sections.flatMap((section) => ["", formatDoctorSection(section)]),
  ].join("\n")
}
