import fs from "fs"
import path from "path"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { aggregateProductState, labelProductState, type ProductState } from "@/dax/status"
import { LSP } from "@/lsp"
import { MCP } from "@/mcp"
import { diagnoseProviderAuth, expectedGoogleOauthClientIds, type AuthDiagnostics } from "@/provider/auth-preflight"
import { Project } from "@/project/project"
import { Vcs } from "@/project/vcs"
import { detectPythonEnvironment } from "@/cli/cmd/tui/util/environment"

export type DoctorReadiness = "ready" | "degraded" | "blocked"

export type DoctorSection = {
  id: "auth" | "mcp" | "lsp" | "env" | "project"
  title: string
  state: ProductState
  readiness: DoctorReadiness
  summary: string
  detail: string[]
  next: string[]
}

export type DoctorReport = {
  generatedAt: string
  state: ProductState
  readiness: DoctorReadiness
  sections: DoctorSection[]
}

type McpConfigEntry = NonNullable<Config.Info["mcp"]>[string]

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
    blocked: values.filter((item) => item.status === "needs_auth" || item.status === "needs_client_registration")
      .length,
    disabled: values.filter((item) => item.status === "disabled").length,
  }
}

function labelDoctorReadiness(readiness: DoctorReadiness): string {
  switch (readiness) {
    case "ready":
      return "Ready"
    case "degraded":
      return "Degraded"
    case "blocked":
      return "Blocked"
  }
}

function aggregateDoctorReadiness(readinesses: DoctorReadiness[]): DoctorReadiness {
  if (readinesses.includes("blocked")) return "blocked"
  if (readinesses.includes("degraded")) return "degraded"
  return "ready"
}

function readinessFromProductState(state: ProductState): DoctorReadiness {
  switch (state) {
    case "connected":
      return "ready"
    case "waiting":
      return "degraded"
    case "needs_approval":
    case "blocked":
    case "failed":
      return "blocked"
  }
}

function parseMissingExecutable(error?: string) {
  if (!error) return
  const match =
    error.match(/posix_spawn '([^']+)'/) ??
    error.match(/spawn ([^ ]+) ENOENT/i) ??
    error.match(/enoent.*?['"`]([^'"`]+)['"`]/i)
  return match?.[1]
}

function describeMcpTarget(config: McpConfigEntry | undefined) {
  if (!config || typeof config !== "object" || !("type" in config)) return []
  if (config.type === "local") {
    const [cmd, ...args] = config.command
    return [`transport: local`, `command: ${[cmd, ...args].join(" ")}`]
  }
  const authMode = config.oauth === false ? "oauth disabled" : typeof config.oauth === "object" ? "oauth configured" : "oauth auto"
  return [`transport: remote`, `url: ${config.url}`, authMode]
}

export function classifyMcpReadiness(
  name: string,
  status: MCP.Status,
  config: McpConfigEntry | undefined,
): { readiness: DoctorReadiness; detail: string[]; next: string[] } {
  const target = describeMcpTarget(config)

  if (status.status === "connected") {
    return {
      readiness: "ready",
      detail: [`${name}: connected`, ...target],
      next: [`Run \`dax mcp ping ${name}\` or \`dax mcp tools ${name}\` to verify live capability.`],
    }
  }

  if (status.status === "disabled") {
    return {
      readiness: "ready",
      detail: [`${name}: disabled in config`, ...target],
      next: [`Enable \`${name}\` in config when you want this MCP capability available.`],
    }
  }

  if (status.status === "needs_auth") {
    return {
      readiness: "degraded",
      detail: [`${name}: authentication required`, ...target],
      next: [`Run \`dax mcp auth ${name}\` to finish MCP authentication.`],
    }
  }

  if (status.status === "needs_client_registration") {
    return {
      readiness: "degraded",
      detail: [`${name}: OAuth client registration required (${status.error})`, ...target],
      next: [
        `Add the required OAuth client configuration for \`${name}\`, then run \`dax mcp auth ${name}\`.`,
      ],
    }
  }

  const missingExecutable = parseMissingExecutable(status.error)
  if (missingExecutable) {
    return {
      readiness: "degraded",
      detail: [`${name}: local executable missing (${missingExecutable})`, ...target],
      next: [
        `Update the MCP command for \`${name}\` to point at an installed executable, or disable it in config until it is available.`,
      ],
    }
  }

  return {
    readiness: "degraded",
    detail: [`${name}: failed (${status.error})`, ...target],
    next: [`Run \`dax mcp inspect ${name}\` or \`dax mcp list\` to inspect the failing server.`],
  }
}

function authSectionFromReports(reports: AuthDiagnostics[]): DoctorSection {
  const failing = reports.filter((item) => !item.ok)
  const state: ProductState = failing.length > 0 ? "blocked" : "connected"
  const readiness = readinessFromProductState(state)
  const summary =
    failing.length > 0
      ? `${failing.length} provider authentication check${failing.length === 1 ? "" : "s"} need attention`
      : `${reports.length} provider authentication check${reports.length === 1 ? "" : "s"} passed`

  const detail = reports.flatMap((report) => {
    const base = `${report.providerID}: ${report.ok ? "connected" : "blocked"} (${report.mode})`
    const details = [
      ...(report.lane ? [`lane: ${report.lane}`] : []),
      ...(report.source ? [`credential source: ${report.source}`] : []),
      ...(report.endpoint ? [`endpoint: ${report.endpoint}`] : []),
    ]
    const missing = report.missingEnv.length > 0 ? `missing ${report.missingEnv.join(", ")}` : undefined
    return [
      base,
      ...details,
      ...(missing ? [missing] : []),
      ...report.details.map((item) => `${report.providerID}: ${item}`),
    ]
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
    readiness,
    summary,
    detail,
    next,
  }
}

export async function authSection(model?: string): Promise<DoctorSection> {
  const checks = model ? [model.split("/")[0] ?? model] : ["google", "google-vertex", "google-vertex-anthropic"]
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
      state: "connected" as const,
      readiness: "ready",
      summary: "No MCP servers configured",
      detail: ["DAX can run without MCP, but MCP is available as an optional first-class capability."],
      next: ["Add a local MCP server in dax.json or .dax/dax.jsonc.", "Run `dax mcp list` after configuring a server."],
    }
  }

  const classifications = Object.entries(statuses).map(([name, status]) =>
    classifyMcpReadiness(name, status, config.mcp?.[name]),
  )
  const readiness = classifications.some((item) => item.readiness === "degraded") ? "degraded" : "ready"
  const issueCount = classifications.filter((item) => item.readiness === "degraded").length
  const state: ProductState = issueCount > 0 && counts.connected === 0 ? "waiting" : "connected"
  const summary =
    issueCount > 0
      ? counts.connected > 0
        ? `${counts.connected}/${counts.total} MCP server${counts.total === 1 ? "" : "s"} connected, ${issueCount} need attention`
        : `${issueCount}/${counts.total} MCP server${counts.total === 1 ? "" : "s"} need attention`
      : counts.connected > 0
        ? `${counts.connected}/${counts.total} MCP server${counts.total === 1 ? "" : "s"} connected`
        : `${counts.total} MCP server${counts.total === 1 ? "" : "s"} configured`

  const detail = classifications.flatMap((item) => item.detail)
  const next = Array.from(new Set(classifications.flatMap((item) => item.next))).slice(0, 4)

  return {
    id: "mcp",
    title: "MCP",
    state,
    readiness,
    summary,
    detail,
    next,
  }
}

export async function lspSection(): Promise<DoctorSection> {
  const config = await Config.get()
  if (config.lsp === false) {
    return {
      id: "lsp",
      title: "LSP",
      state: "connected",
      readiness: "ready",
      summary: "LSP disabled in config",
      detail: ["Language servers are disabled for this project or user profile."],
      next: ["Enable LSP in config when you want symbol, diagnostics, and workspace language features."],
    }
  }

  const state = await LSP.init()
  const connected = await LSP.status()
  const enabled = Object.values(state.servers)
    .map((server) => server.id)
    .sort((a, b) => a.localeCompare(b))
  const broken = Array.from(state.broken).sort()

  const readiness: DoctorReadiness = broken.length > 0 ? "degraded" : "ready"
  const sectionState: ProductState = broken.length > 0 && connected.length === 0 ? "waiting" : "connected"
  const summary =
    enabled.length === 0
      ? "No LSP servers enabled"
      : connected.length > 0
        ? `${connected.length}/${enabled.length} LSP server${enabled.length === 1 ? "" : "s"} connected`
        : `${enabled.length} LSP server${enabled.length === 1 ? "" : "s"} enabled`

  const detail = [
    enabled.length > 0
      ? `enabled servers: ${enabled.slice(0, 8).join(", ")}${enabled.length > 8 ? ` (+${enabled.length - 8} more)` : ""}`
      : "enabled servers: none",
    connected.length > 0
      ? `connected clients: ${connected.map((item) => `${item.id}@${item.root || "."}`).join(", ")}`
      : "connected clients: none yet (connections open on demand as supported files are touched)",
    ...(broken.length > 0 ? [`broken servers: ${broken.join(", ")}`] : []),
  ]

  const next =
    broken.length > 0
      ? ["Run `dax debug lsp status` to inspect enabled servers, then open a supported file to reproduce the failing language server."]
      : enabled.length === 0
        ? ["Configure or enable at least one LSP server if you want symbol and diagnostic coverage."]
        : ["Run `dax debug lsp status` for machine-readable visibility. Zero connected clients is normal before file-driven activation."]

  return {
    id: "lsp",
    title: "LSP",
    state: sectionState,
    readiness,
    summary,
    detail,
    next,
  }
}

export async function envSection(cwd: string = process.cwd()): Promise<DoctorSection> {
  const report = detectPythonEnvironment(cwd)
  const state: ProductState = report.inVirtualEnv || !report.projectHasPythonSignals ? "connected" : "waiting"
  const readiness = readinessFromProductState(state)
  const summary = report.inVirtualEnv
    ? `Python environment active (${report.virtualEnvType})`
    : report.projectHasPythonSignals
      ? "Project-local environment recommended"
      : "No Python project signals detected"

  return {
    id: "env" as const,
    title: "Environment",
    state,
    readiness,
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
  const readiness = readinessFromProductState(state)

  return {
    id: "project" as const,
    title: "Project",
    state,
    readiness,
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
  const sections = await Promise.all([authSection(model), mcpSection(), lspSection(), envSection(cwd), projectSection(cwd)])
  return {
    generatedAt: new Date().toISOString(),
    state: aggregateProductState(sections.map((item) => item.state)),
    readiness: aggregateDoctorReadiness(sections.map((item) => item.readiness)),
    sections,
  }
}

export function doctorExitCode(input: ProductState | DoctorReadiness) {
  return input === "blocked" || input === "failed" || input === "needs_approval" ? 1 : 0
}

export function formatDoctorSection(section: DoctorSection) {
  const lines = [`${section.title}: ${labelDoctorReadiness(section.readiness)}`, `  ${section.summary}`]
  if (section.readiness === "degraded" && section.state !== "connected") {
    lines.push(`  operational state: ${labelProductState(section.state)}`)
  }
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
    `DAX doctor: ${labelDoctorReadiness(report.readiness)}`,
    ...report.sections.flatMap((section) => ["", formatDoctorSection(section)]),
  ].join("\n")
}
