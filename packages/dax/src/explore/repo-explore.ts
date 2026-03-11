import path from "path"
import { Filesystem } from "@/util/filesystem"

export type ExploreConfidence = "high_confidence" | "medium_confidence" | "low_confidence" | "unknown"
export type ExploreEvidenceKind = "observed" | "inferred" | "unknown"

export type ExploreFinding = {
  kind: ExploreEvidenceKind
  summary: string
  paths?: string[]
}

export type ExploreImportantFile = {
  path: string
  role: string
}

export type ExploreReadingStep = {
  path: string
  reason: string
}

export type ExploreFollowUp = {
  kind: "unknown" | "follow_up"
  summary: string
}

export type ExploreSectionKey =
  | "repository_shape"
  | "entry_points"
  | "execution_graph"
  | "orchestration_loop"
  | "integrations"

export type ExploreEvidenceSection = {
  confidence: ExploreConfidence
  findings: ExploreFinding[]
}

export type RepoExplorePassOutputs = {
  repository_shape: ExploreEvidenceSection
  entry_points: ExploreEvidenceSection
  execution_graph: ExploreEvidenceSection
  orchestration_loop: ExploreEvidenceSection
  integrations: ExploreEvidenceSection
  important_files: ExploreImportantFile[]
  suggested_reading_order: ExploreReadingStep[]
  unknowns_follow_up_targets: ExploreFollowUp[]
}

export type RepoExploreResult = {
  sections: Array<
    | {
        key: ExploreSectionKey
        title: string
        confidence: ExploreConfidence
        findings: ExploreFinding[]
      }
    | {
        key: "important_files"
        title: "Important files"
        files: ExploreImportantFile[]
      }
    | {
        key: "suggested_reading_order"
        title: "Suggested reading order"
        steps: ExploreReadingStep[]
      }
    | {
        key: "unknowns_follow_up_targets"
        title: "Unknowns / follow-up targets"
        items: ExploreFollowUp[]
      }
  >
}

export type RepoExplorePassDelta = Partial<{
  [K in keyof RepoExplorePassOutputs]: RepoExplorePassOutputs[K]
}>

const SECTION_TITLES: Record<ExploreSectionKey, string> = {
  repository_shape: "Repository shape",
  entry_points: "Entry points",
  execution_graph: "Execution graph",
  orchestration_loop: "Orchestration loop",
  integrations: "Integrations",
}

export function createEmptyExplorePassOutputs(): RepoExplorePassOutputs {
  const emptySection = (): ExploreEvidenceSection => ({
    confidence: "unknown",
    findings: [],
  })

  return {
    repository_shape: emptySection(),
    entry_points: emptySection(),
    execution_graph: emptySection(),
    orchestration_loop: emptySection(),
    integrations: emptySection(),
    important_files: [],
    suggested_reading_order: [],
    unknowns_follow_up_targets: [],
  }
}

export function mergeExplorePassOutputs(
  base: RepoExplorePassOutputs,
  delta: RepoExplorePassDelta,
): RepoExplorePassOutputs {
  const mergeUniqueBy = <T>(items: T[], next: T[] | undefined, key: (item: T) => string) => {
    const merged = [...items]
    const seen = new Set(items.map(key))
    for (const item of next ?? []) {
      const id = key(item)
      if (seen.has(id)) continue
      seen.add(id)
      merged.push(item)
    }
    return merged
  }

  return {
    repository_shape: delta.repository_shape ?? base.repository_shape,
    entry_points: delta.entry_points ?? base.entry_points,
    execution_graph: delta.execution_graph ?? base.execution_graph,
    orchestration_loop: delta.orchestration_loop ?? base.orchestration_loop,
    integrations: delta.integrations ?? base.integrations,
    important_files: mergeUniqueBy(base.important_files, delta.important_files, (item) => `${item.path}:${item.role}`),
    suggested_reading_order: mergeUniqueBy(
      base.suggested_reading_order,
      delta.suggested_reading_order,
      (item) => `${item.path}:${item.reason}`,
    ),
    unknowns_follow_up_targets: mergeUniqueBy(
      base.unknowns_follow_up_targets,
      delta.unknowns_follow_up_targets,
      (item) => `${item.kind}:${item.summary}`,
    ),
  }
}

export function buildExploreResult(outputs: RepoExplorePassOutputs): RepoExploreResult {
  const synthesized = synthesizeExploreOutputs(outputs)
  return {
    sections: [
      ...((["repository_shape", "entry_points", "execution_graph", "orchestration_loop", "integrations"] as ExploreSectionKey[]).map(
        (key) => ({
          key,
          title: SECTION_TITLES[key],
          confidence: synthesized[key].confidence,
          findings: synthesized[key].findings,
        }),
      )),
      {
        key: "important_files",
        title: "Important files" as const,
        files: synthesized.important_files,
      },
      {
        key: "suggested_reading_order",
        title: "Suggested reading order" as const,
        steps: synthesized.suggested_reading_order,
      },
      {
        key: "unknowns_follow_up_targets",
        title: "Unknowns / follow-up targets" as const,
        items: synthesized.unknowns_follow_up_targets,
      },
    ],
  }
}

function importantFilePriority(role: string) {
  if (role.includes("root repo-shape signal")) return 100
  if (role.includes("runtime package manifest")) return 96
  if (role.includes("bootstrap")) return 92
  if (role.includes("execution flow surface")) return 88
  if (role.includes("orchestration loop surface")) return 87
  if (role.includes("approval interruption surface")) return 86
  if (role.includes("control transition surface")) return 85
  if (role.includes("boundary")) return 80
  if (role.includes("integration")) return 74
  if (role.includes("candidate runtime")) return 72
  return 60
}

function importanceReason(role: string) {
  if (role.includes("root repo-shape signal") || role.includes("runtime package manifest")) {
    return "Establishes repository shape and workspace boundaries."
  }
  if (role.includes("bootstrap")) {
    return "Shows where runtime execution starts."
  }
  if (role.includes("execution flow surface")) {
    return "Shows the first concrete execution handoff."
  }
  if (role.includes("orchestration loop surface")) {
    return "Shows where the main orchestration loop coordinates work."
  }
  if (role.includes("approval interruption surface") || role.includes("control transition surface")) {
    return "Shows where execution can pause, gate, or resume."
  }
  if (role.includes("integration")) {
    return "Shows the external boundary this runtime depends on."
  }
  if (role.includes("boundary")) {
    return "Helps establish package or workspace ownership."
  }
  return "Provides supporting evidence for how this repository runs."
}

function normalizeFollowUp(summary: string): string {
  return summary.replace(/^no clear runtime entry point confirmed under /, "Confirm runtime start under ")
}

export function synthesizeExploreOutputs(outputs: RepoExplorePassOutputs): RepoExplorePassOutputs {
  const importantFiles = [...outputs.important_files]
    .sort((a, b) => {
      const diff = importantFilePriority(b.role) - importantFilePriority(a.role)
      if (diff !== 0) return diff
      const pathDiff = a.path.length - b.path.length
      if (pathDiff !== 0) return pathDiff
      return a.path.localeCompare(b.path)
    })
    .filter((item, index, array) => array.findIndex((candidate) => candidate.path === item.path) === index)
    .slice(0, 10)

  const readingOrder: ExploreReadingStep[] =
    outputs.suggested_reading_order.length > 0
      ? outputs.suggested_reading_order
      : importantFiles.slice(0, 6).map((file) => ({
          path: file.path,
          reason: importanceReason(file.role),
        }))

  const derivedFollowUps: ExploreFollowUp[] = []
  const derivedKeys = new Set<string>()
  const pushDerived = (item: ExploreFollowUp) => {
    const key = `${item.kind}:${item.summary}`
    if (derivedKeys.has(key)) return
    derivedKeys.add(key)
    derivedFollowUps.push(item)
  }

  for (const section of [
    outputs.repository_shape,
    outputs.entry_points,
    outputs.execution_graph,
    outputs.orchestration_loop,
    outputs.integrations,
  ]) {
    for (const finding of section.findings) {
      if (finding.kind === "unknown") {
        pushDerived({
          kind: "unknown",
          summary: normalizeFollowUp(finding.summary),
        })
      }
      if (finding.kind === "inferred") {
        pushDerived({
          kind: "follow_up",
          summary: `Confirm inferred boundary: ${finding.summary}`,
        })
      }
    }
  }

  const unknownsFollowUpTargets = [...outputs.unknowns_follow_up_targets]
  for (const item of derivedFollowUps) {
    if (!unknownsFollowUpTargets.some((candidate) => candidate.kind === item.kind && candidate.summary === item.summary)) {
      unknownsFollowUpTargets.push(item)
    }
  }

  return {
    ...outputs,
    important_files: importantFiles,
    suggested_reading_order: readingOrder,
    unknowns_follow_up_targets: unknownsFollowUpTargets.slice(0, 10),
  }
}

function formatConfidence(confidence: ExploreConfidence) {
  switch (confidence) {
    case "high_confidence":
      return "high confidence"
    case "medium_confidence":
      return "medium confidence"
    case "low_confidence":
      return "low confidence"
    case "unknown":
      return "unknown"
  }
}

function formatFindingKind(kind: ExploreEvidenceKind) {
  switch (kind) {
    case "observed":
      return "Observed"
    case "inferred":
      return "Inferred"
    case "unknown":
      return "Unknown"
  }
}

function formatFinding(finding: ExploreFinding) {
  const suffix =
    finding.paths && finding.paths.length > 0 ? ` (${finding.paths.join(", ")})` : ""
  return `- ${formatFindingKind(finding.kind)}: ${finding.summary}${suffix}`
}

function formatUnknownOrFollowUp(item: ExploreFollowUp) {
  const label = item.kind === "unknown" ? "Unknown" : "Follow-up"
  return `- ${label}: ${item.summary}`
}

export function renderExploreResult(
  result: RepoExploreResult,
  options?: {
    eli12?: boolean
  },
) {
  const lines: string[] = []
  const eli12 = Boolean(options?.eli12)

  for (const section of result.sections) {
    lines.push(section.title)

    if ("confidence" in section) {
      lines.push(`Confidence: ${formatConfidence(section.confidence)}`)

      if (section.findings.length === 0) {
        lines.push(eli12 ? "- Unknown: DAX could not confirm this section yet." : "- Unknown: no confirmed findings yet")
      } else {
        lines.push(...section.findings.map(formatFinding))
      }
    } else if ("files" in section) {
      if (section.files.length === 0) {
        lines.push("- Unknown: no important files confirmed yet")
      } else {
        lines.push(...section.files.map((file) => `- ${file.path} — ${file.role}`))
      }
    } else if ("steps" in section) {
      if (section.steps.length === 0) {
        lines.push("- Unknown: no reading order confirmed yet")
      } else {
        lines.push(
          ...section.steps.flatMap((step, index) => [
            `${index + 1}. ${step.path}`,
            `   Reason: ${step.reason}`,
          ]),
        )
      }
    } else if (section.items.length === 0) {
      lines.push("- None")
    } else {
      lines.push(...section.items.map(formatUnknownOrFollowUp))
    }

    lines.push("")
  }

  return lines.join("\n").trimEnd()
}

const REPO_SHAPE_SIGNALS = [
  "package.json",
  "pnpm-workspace.yaml",
  "turbo.json",
  "nx.json",
  "go.mod",
  "Cargo.toml",
  "pyproject.toml",
  "requirements.txt",
  "Dockerfile",
  "Makefile",
] as const

const CONTAINER_DIR_NAMES = ["packages", "apps", "services"] as const
const ENTRY_POINT_FILENAMES = [
  "index.ts",
  "index.tsx",
  "cli.ts",
  "cli.tsx",
  "main.ts",
  "main.tsx",
  "server.ts",
  "server.tsx",
  "app.ts",
  "app.tsx",
  "worker.ts",
  "worker.tsx",
  "src/index.ts",
  "src/index.tsx",
  "src/cli.ts",
  "src/cli.tsx",
  "src/main.ts",
  "src/main.tsx",
  "src/server.ts",
  "src/server.tsx",
  "src/app.ts",
  "src/app.tsx",
  "src/worker.ts",
  "src/worker.tsx",
] as const

type RuntimeEntryType = "cli" | "server" | "worker" | "tui"
type IntegrationCategory =
  | "provider"
  | "mcp"
  | "storage"
  | "queue"
  | "ci"
  | "platform"
  | "auth"

type ExecutionFlowLabel =
  | "cli_command_flow"
  | "server_request_flow"
  | "worker_dispatch_flow"
  | "session_execution_flow"
  | "approval_interruption_flow"
  | "tui_action_flow"

type EntryPointCandidate = {
  type: RuntimeEntryType
  kind: ExploreEvidenceKind
  summary: string
  paths: string[]
  reason: string
}

type IntegrationCandidate = {
  category: IntegrationCategory
  kind: ExploreEvidenceKind
  summary: string
  paths: string[]
  reason: string
  role: string
}

type ExecutionFlowCandidate = {
  label: ExecutionFlowLabel
  section: "execution_graph" | "orchestration_loop"
  kind: ExploreEvidenceKind
  summary: string
  paths: string[]
  reason: string
  role: string
}

const PACKAGE_INTEGRATION_PATTERNS: Array<{
  match: RegExp
  candidate: Omit<IntegrationCandidate, "paths">
}> = [
  {
    match: /^@ai-sdk\//,
    candidate: {
      category: "provider",
      kind: "observed",
      summary: "Provider integration detected",
      reason: "ai provider sdk dependency declared",
      role: "provider integration manifest",
    },
  },
  {
    match: /^@modelcontextprotocol\/sdk$/,
    candidate: {
      category: "mcp",
      kind: "observed",
      summary: "MCP integration detected",
      reason: "mcp sdk dependency declared",
      role: "mcp integration manifest",
    },
  },
  {
    match: /^@octokit\/|^@actions\//,
    candidate: {
      category: "ci",
      kind: "observed",
      summary: "CI or automation integration detected",
      reason: "github automation sdk dependency declared",
      role: "automation integration manifest",
    },
  },
  {
    match: /redis|postgres|pg$|mongodb|mongoose|sqlite|better-sqlite|mysql|prisma/i,
    candidate: {
      category: "storage",
      kind: "observed",
      summary: "Storage integration detected",
      reason: "database or persistence dependency declared",
      role: "storage integration manifest",
    },
  },
  {
    match: /bull|agenda|bee-queue|sqs|queue/i,
    candidate: {
      category: "queue",
      kind: "observed",
      summary: "Queue or async integration detected",
      reason: "queue or async dependency declared",
      role: "queue integration manifest",
    },
  },
  {
    match: /aws|azure|google-vertex|gcp|vercel/i,
    candidate: {
      category: "platform",
      kind: "observed",
      summary: "Platform or cloud integration detected",
      reason: "cloud platform dependency declared",
      role: "platform integration manifest",
    },
  },
]

const CONTENT_INTEGRATION_PATTERNS: Array<{
  match: RegExp
  candidate: Omit<IntegrationCandidate, "paths">
}> = [
  {
    match: /fetch\(|axios|@octokit\/|https:\/\/api\./i,
    candidate: {
      category: "provider",
      kind: "inferred",
      summary: "External api integration boundary detected",
      reason: "network client usage detected",
      role: "external api integration",
    },
  },
  {
    match: /mcp|modelcontextprotocol/i,
    candidate: {
      category: "mcp",
      kind: "observed",
      summary: "MCP integration detected",
      reason: "mcp references detected in runtime code",
      role: "mcp integration surface",
    },
  },
  {
    match: /sqlite|redis|postgres|mongodb|prisma|database_url|pm\.sqlite/i,
    candidate: {
      category: "storage",
      kind: "observed",
      summary: "Storage integration detected",
      reason: "storage backend usage detected",
      role: "storage integration surface",
    },
  },
  {
    match: /queue\.process|scheduler|cron|background/i,
    candidate: {
      category: "queue",
      kind: "observed",
      summary: "Queue or async integration detected",
      reason: "background or queue signals detected",
      role: "queue or async integration surface",
    },
  },
  {
    match: /process\.env|dotenv|oauth|auth/i,
    candidate: {
      category: "auth",
      kind: "inferred",
      summary: "Auth or secrets boundary detected",
      reason: "runtime auth or env configuration signals detected",
      role: "auth or secrets boundary",
    },
  },
  {
    match: /aws_|azure|google_vertex|vercel|bedrock|gcp/i,
    candidate: {
      category: "platform",
      kind: "inferred",
      summary: "Platform or cloud integration detected",
      reason: "cloud platform signals detected in runtime code",
      role: "platform integration surface",
    },
  },
]

async function readTextIfExists(file: string) {
  if (!(await Filesystem.exists(file))) return undefined
  return Bun.file(file).text()
}

async function readJsonIfExists(file: string) {
  if (!(await Filesystem.exists(file))) return undefined
  try {
    return await Bun.file(file).json()
  } catch {
    return undefined
  }
}

async function listPackageRoots(root: string) {
  const resolvedRoot = path.resolve(root)
  const results = [resolvedRoot]
  for (const containerName of CONTAINER_DIR_NAMES) {
    const containerPath = path.join(resolvedRoot, containerName)
    if (!(await Filesystem.isDir(containerPath))) continue

    const childEntries = await Array.fromAsync(
      new Bun.Glob("*").scan({
        cwd: containerPath,
        onlyFiles: false,
        absolute: false,
        followSymlinks: false,
        dot: false,
      }),
    )

    for (const child of childEntries) {
      const childPath = path.join(containerPath, child)
      if (!(await Filesystem.isDir(childPath))) continue
      if (
        (await Filesystem.exists(path.join(childPath, "package.json"))) ||
        (await Filesystem.exists(path.join(childPath, "go.mod"))) ||
        (await Filesystem.exists(path.join(childPath, "Cargo.toml"))) ||
        (await Filesystem.exists(path.join(childPath, "pyproject.toml")))
      ) {
        results.push(childPath)
      }
    }
  }
  return results
}

async function listExistingFiles(root: string, patterns: string[]) {
  const matches: string[] = []
  for (const pattern of patterns) {
    for await (const match of new Bun.Glob(pattern).scan({
      cwd: root,
      onlyFiles: true,
      absolute: false,
      followSymlinks: false,
      dot: true,
    })) {
      matches.push(match.replace(/\\/g, "/"))
    }
  }
  return matches
}

async function resolveRelativeImport(baseFile: string, specifier: string) {
  const baseDir = path.dirname(baseFile)
  const candidates = [
    path.resolve(baseDir, specifier),
    path.resolve(baseDir, `${specifier}.ts`),
    path.resolve(baseDir, `${specifier}.tsx`),
    path.resolve(baseDir, `${specifier}.js`),
    path.resolve(baseDir, `${specifier}.jsx`),
    path.resolve(baseDir, specifier, "index.ts"),
    path.resolve(baseDir, specifier, "index.tsx"),
    path.resolve(baseDir, specifier, "index.js"),
    path.resolve(baseDir, specifier, "index.jsx"),
  ]

  for (const candidate of candidates) {
    if (await Filesystem.exists(candidate)) return candidate
  }
  return undefined
}

async function extractRelativeImports(absoluteFile: string, content: string) {
  const imports = new Set<string>()
  const patterns = [
    /import\s+(?:[^'"]+?\s+from\s+)?["'](\.[^"']+)["']/g,
    /await\s+import\(["'](\.[^"']+)["']\)/g,
  ]

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const specifier = match[1]
      const resolved = await resolveRelativeImport(absoluteFile, specifier)
      if (resolved) imports.add(resolved)
    }
  }

  return [...imports]
}

function classifyEntryFile(relativePath: string, content: string | undefined): EntryPointCandidate | undefined {
  if (!content) return undefined
  const lowerPath = relativePath.toLowerCase()
  const lower = content.toLowerCase()

  if (
    lower.includes("yargs") ||
    lower.includes("commander") ||
    lower.includes("import { cmd }") ||
    lower.includes("scriptname(") ||
    lowerPath.includes("/cli") ||
    lowerPath.endsWith("src/index.ts")
  ) {
    return {
      type: "cli",
      kind: "observed",
      summary: "CLI entry point detected",
      paths: [relativePath],
      reason: "cli bootstrap signals detected",
    }
  }

  if (
    lower.includes("bun.serve(") ||
    lower.includes("createserver(") ||
    lower.includes(".listen(") ||
    lower.includes("serve(") ||
    lowerPath.includes("/server")
  ) {
    return {
      type: "server",
      kind: "observed",
      summary: "Server entry point detected",
      paths: [relativePath],
      reason: "server bootstrap signals detected",
    }
  }

  if (
    lower.includes("@opentui/") ||
    lower.includes("tui(") ||
    lower.includes("start dax tui") ||
    lowerPath.includes("/tui/")
  ) {
    return {
      type: "tui",
      kind: "observed",
      summary: "TUI entry point detected",
      paths: [relativePath],
      reason: "tui bootstrap signals detected",
    }
  }

  if (
    lower.includes("new worker(") ||
    lower.includes("queue.process") ||
    lower.includes("scheduler") ||
    lower.includes("cron") ||
    lowerPath.includes("worker")
  ) {
    return {
      type: "worker",
      kind: "observed",
      summary: "Worker or background entry point detected",
      paths: [relativePath],
      reason: "background execution signals detected",
    }
  }

  return undefined
}

export async function runBoundaryPass(root: string): Promise<RepoExplorePassDelta> {
  const resolvedRoot = path.resolve(root)
  const findings: ExploreFinding[] = []
  const importantFiles: ExploreImportantFile[] = []
  const seenImportantFiles = new Set<string>()

  const addImportantFile = (relativePath: string, role: string) => {
    if (seenImportantFiles.has(relativePath)) return
    seenImportantFiles.add(relativePath)
    importantFiles.push({
      path: relativePath,
      role,
    })
  }

  const rootSignals = await Promise.all(
    REPO_SHAPE_SIGNALS.map(async (filename) => {
      const absolute = path.join(resolvedRoot, filename)
      return (await Filesystem.exists(absolute)) ? filename : undefined
    }),
  ).then((signals) => signals.filter(Boolean) as string[])

  if (rootSignals.length > 0) {
    findings.push({
      kind: "observed",
      summary: `repo root contains ${rootSignals.join(", ")}`,
      paths: rootSignals,
    })

    for (const signal of rootSignals) {
      addImportantFile(signal, `root repo-shape signal`)
    }
  }

  const workspaceTools: string[] = []
  if (rootSignals.includes("pnpm-workspace.yaml")) workspaceTools.push("pnpm workspace")
  if (rootSignals.includes("turbo.json")) workspaceTools.push("turborepo")
  if (rootSignals.includes("nx.json")) workspaceTools.push("nx workspace")
  if (workspaceTools.length > 0) {
    findings.push({
      kind: "observed",
      summary: `workspace tooling detected: ${workspaceTools.join(", ")}`,
    })
  }

  const languageDomains = new Set<string>()
  if (rootSignals.includes("package.json")) languageDomains.add("node")
  if (rootSignals.includes("go.mod")) languageDomains.add("go")
  if (rootSignals.includes("Cargo.toml")) languageDomains.add("rust")
  if (rootSignals.includes("pyproject.toml") || rootSignals.includes("requirements.txt")) languageDomains.add("python")
  if (rootSignals.includes("Dockerfile")) languageDomains.add("container")
  if (rootSignals.includes("Makefile")) languageDomains.add("make")

  const topLevelEntries = await Array.fromAsync(
    new Bun.Glob("*").scan({
      cwd: resolvedRoot,
      onlyFiles: false,
      absolute: false,
      followSymlinks: false,
      dot: false,
    }),
  )

  const childBoundaries: string[] = []
  for (const containerName of CONTAINER_DIR_NAMES) {
    if (!topLevelEntries.includes(containerName)) continue
    const containerPath = path.join(resolvedRoot, containerName)
    if (!(await Filesystem.isDir(containerPath))) continue

    const childEntries = await Array.fromAsync(
      new Bun.Glob("*").scan({
        cwd: containerPath,
        onlyFiles: false,
        absolute: false,
        followSymlinks: false,
        dot: false,
      }),
    )

    for (const child of childEntries) {
      const childPath = path.join(containerPath, child)
      if (!(await Filesystem.isDir(childPath))) continue

      const signals = await Promise.all(
        ["package.json", "go.mod", "Cargo.toml", "pyproject.toml"].map(async (filename) => {
          const absolute = path.join(childPath, filename)
          return (await Filesystem.exists(absolute)) ? filename : undefined
        }),
      ).then((items) => items.filter(Boolean) as string[])

      if (signals.length === 0) continue

      const relativeChild = path.join(containerName, child)
      childBoundaries.push(relativeChild)
      addImportantFile(relativeChild, `${containerName.slice(0, -1)} boundary`)

      if (signals.includes("package.json")) languageDomains.add("node")
      if (signals.includes("go.mod")) languageDomains.add("go")
      if (signals.includes("Cargo.toml")) languageDomains.add("rust")
      if (signals.includes("pyproject.toml")) languageDomains.add("python")
    }
  }

  if (childBoundaries.length > 0) {
    findings.push({
      kind: "observed",
      summary: `workspace boundaries detected under ${childBoundaries.join(", ")}`,
      paths: childBoundaries,
    })
  }

  if (languageDomains.size > 0) {
    findings.push({
      kind: "observed",
      summary: `language and build domains detected: ${Array.from(languageDomains).sort().join(", ")}`,
    })
  }

  const confidence: ExploreConfidence =
    findings.length >= 3 ? "high_confidence" : findings.length > 0 ? "medium_confidence" : "unknown"

  return {
    repository_shape: {
      confidence,
      findings,
    },
    important_files: importantFiles,
  }
}

export async function runEntryPointPass(root: string): Promise<RepoExplorePassDelta> {
  const resolvedRoot = path.resolve(root)
  const findings: ExploreFinding[] = []
  const importantFiles: ExploreImportantFile[] = []
  const seenImportantFiles = new Set<string>()
  const seenFindingKeys = new Set<string>()
  const packageRoots = await listPackageRoots(resolvedRoot)

  const addImportantFile = (relativePath: string, role: string) => {
    const key = `${relativePath}:${role}`
    if (seenImportantFiles.has(key)) return
    seenImportantFiles.add(key)
    importantFiles.push({ path: relativePath, role })
  }

  const addFinding = (candidate: EntryPointCandidate) => {
    const key = `${candidate.type}:${candidate.summary}:${candidate.paths.join(",")}`
    if (seenFindingKeys.has(key)) return
    seenFindingKeys.add(key)
    findings.push({
      kind: candidate.kind,
      summary: `${candidate.summary}: ${candidate.reason}`,
      paths: candidate.paths,
    })
  }

  for (const packageRoot of packageRoots) {
    const relativeRoot = path.relative(resolvedRoot, packageRoot) || "."
    const packageJsonPath = path.join(packageRoot, "package.json")
    const packageJson = await readJsonIfExists(packageJsonPath)

    if (packageJson && typeof packageJson === "object") {
      if (packageJson.bin && typeof packageJson.bin === "object") {
        for (const value of Object.values(packageJson.bin as Record<string, unknown>)) {
          if (typeof value !== "string") continue
          const entryFile = path.normalize(path.join(relativeRoot, value)).replace(/\\/g, "/")
          addFinding({
            type: "cli",
            kind: "observed",
            summary: "CLI entry point detected",
            paths: [relativeRoot === "." ? "package.json" : path.posix.join(relativeRoot, "package.json"), entryFile],
            reason: "package.json bin mapping points to runtime bootstrap",
          })
          addImportantFile(relativeRoot === "." ? "package.json" : path.posix.join(relativeRoot, "package.json"), "runtime package manifest")
          addImportantFile(entryFile, "cli bootstrap")
        }
      }

      if (typeof packageJson.main === "string") {
        const mainTarget = path.normalize(path.join(relativeRoot, packageJson.main)).replace(/\\/g, "/")
        addFinding({
          type: "cli",
          kind: "inferred",
          summary: "Candidate runtime entry point detected",
          paths: [relativeRoot === "." ? "package.json" : path.posix.join(relativeRoot, "package.json"), mainTarget],
          reason: "package.json main field points to a likely runtime entry",
        })
        addImportantFile(mainTarget, "candidate runtime bootstrap")
      }
    }

    let packageHadRuntime = false
    for (const candidateFile of ENTRY_POINT_FILENAMES) {
      const absolute = path.join(packageRoot, candidateFile)
      const content = await readTextIfExists(absolute)
      const relativePath = path
        .relative(resolvedRoot, absolute)
        .replace(/\\/g, "/")
      const candidate = classifyEntryFile(relativePath, content)
      if (!candidate) continue
      packageHadRuntime = true
      addFinding(candidate)
      addImportantFile(
        relativePath,
        candidate.type === "cli"
          ? "cli bootstrap"
          : candidate.type === "server"
            ? "server bootstrap"
            : candidate.type === "tui"
              ? "tui bootstrap"
              : "worker bootstrap",
      )
    }

    if (!packageHadRuntime && relativeRoot !== ".") {
      findings.push({
        kind: "unknown",
        summary: `no clear runtime entry point confirmed under ${relativeRoot}`,
        paths: [relativeRoot],
      })
    }
  }

  const confidence: ExploreConfidence =
    findings.filter((item) => item.kind === "observed").length >= 3
      ? "high_confidence"
      : findings.length > 0
        ? "medium_confidence"
        : "unknown"

  return {
    entry_points: {
      confidence,
      findings,
    },
    important_files: importantFiles,
  }
}

export async function runIntegrationPass(root: string): Promise<RepoExplorePassDelta> {
  const resolvedRoot = path.resolve(root)
  const findings: ExploreFinding[] = []
  const importantFiles: ExploreImportantFile[] = []
  const unknowns: ExploreFollowUp[] = []
  const seenFindingKeys = new Set<string>()
  const seenImportantFiles = new Set<string>()
  const packageRoots = await listPackageRoots(resolvedRoot)

  const addImportantFile = (relativePath: string, role: string) => {
    const key = `${relativePath}:${role}`
    if (seenImportantFiles.has(key)) return
    seenImportantFiles.add(key)
    importantFiles.push({ path: relativePath, role })
  }

  const addIntegration = (candidate: IntegrationCandidate) => {
    const key = `${candidate.category}:${candidate.summary}:${candidate.paths.join(",")}`
    if (seenFindingKeys.has(key)) return
    seenFindingKeys.add(key)
    findings.push({
      kind: candidate.kind,
      summary: `${candidate.summary}: ${candidate.reason}`,
      paths: candidate.paths,
    })
    for (const item of candidate.paths) addImportantFile(item, candidate.role)
  }

  for (const packageRoot of packageRoots) {
    const relativeRoot = path.relative(resolvedRoot, packageRoot) || "."
    const packageJsonPath = path.join(packageRoot, "package.json")
    const packageJson = await readJsonIfExists(packageJsonPath)
    if (packageJson && typeof packageJson === "object") {
      const deps = {
        ...(packageJson.dependencies ?? {}),
        ...(packageJson.devDependencies ?? {}),
      } as Record<string, unknown>

      for (const depName of Object.keys(deps)) {
        for (const rule of PACKAGE_INTEGRATION_PATTERNS) {
          if (!rule.match.test(depName)) continue
          addIntegration({
            ...rule.candidate,
            paths: [relativeRoot === "." ? "package.json" : path.posix.join(relativeRoot, "package.json")],
          })
        }
      }
    }

    const sourceFiles = await listExistingFiles(packageRoot, [
      "src/**/*.ts",
      "src/**/*.tsx",
      "*.ts",
      "*.tsx",
    ])

    for (const relativeFile of sourceFiles) {
      const absolute = path.join(packageRoot, relativeFile)
      const content = await readTextIfExists(absolute)
      if (!content) continue
      const repoRelative = path.relative(resolvedRoot, absolute).replace(/\\/g, "/")
      for (const rule of CONTENT_INTEGRATION_PATTERNS) {
        if (!rule.match.test(content)) continue
        addIntegration({
          ...rule.candidate,
          paths: [repoRelative],
        })
      }
    }
  }

  const workflowFiles = await listExistingFiles(resolvedRoot, [".github/workflows/*.yml", ".github/workflows/*.yaml"])
  for (const workflowFile of workflowFiles) {
    addIntegration({
      category: "ci",
      kind: "observed",
      summary: "CI or automation integration detected",
      reason: "github actions workflow detected",
      paths: [workflowFile],
      role: "ci or automation workflow",
    })
  }

  if (!findings.some((item) => item.summary.includes("Storage integration detected"))) {
    unknowns.push({
      kind: "unknown",
      summary: "storage backend not confirmed from scanned files",
    })
  }

  if (!findings.some((item) => item.summary.includes("Queue or async integration detected"))) {
    unknowns.push({
      kind: "unknown",
      summary: "queue backend not confirmed from scanned files",
    })
  }

  const observedCount = findings.filter((item) => item.kind === "observed").length
  const confidence: ExploreConfidence =
    observedCount >= 3 ? "high_confidence" : findings.length > 0 ? "medium_confidence" : "unknown"

  return {
    integrations: {
      confidence,
      findings,
    },
    important_files: importantFiles,
    unknowns_follow_up_targets: unknowns,
  }
}

export async function runExecutionFlowPass(root: string): Promise<RepoExplorePassDelta> {
  const resolvedRoot = path.resolve(root)
  const executionFindings: ExploreFinding[] = []
  const orchestrationFindings: ExploreFinding[] = []
  const importantFiles: ExploreImportantFile[] = []
  const unknowns: ExploreFollowUp[] = []
  const seenFindingKeys = new Set<string>()
  const seenImportantFiles = new Set<string>()

  const addImportantFile = (relativePath: string, role: string) => {
    const key = `${relativePath}:${role}`
    if (seenImportantFiles.has(key)) return
    seenImportantFiles.add(key)
    importantFiles.push({ path: relativePath, role })
  }

  const addFlow = (candidate: ExecutionFlowCandidate) => {
    const key = `${candidate.section}:${candidate.label}:${candidate.paths.join(",")}`
    if (seenFindingKeys.has(key)) return
    seenFindingKeys.add(key)
    const finding: ExploreFinding = {
      kind: candidate.kind,
      summary: `${candidate.label}: ${candidate.summary}; ${candidate.reason}`,
      paths: candidate.paths,
    }
    if (candidate.section === "execution_graph") executionFindings.push(finding)
    else orchestrationFindings.push(finding)
    for (const item of candidate.paths) addImportantFile(item, candidate.role)
  }

  const sourceFiles = await listExistingFiles(resolvedRoot, ["packages/**/src/**/*.ts", "packages/**/src/**/*.tsx", "src/**/*.ts", "src/**/*.tsx"])
  const repoFiles = sourceFiles.map((relative) => path.join(resolvedRoot, relative))

  for (const absoluteFile of repoFiles) {
    const relativeFile = path.relative(resolvedRoot, absoluteFile).replace(/\\/g, "/")
    const content = await readTextIfExists(absoluteFile)
    if (!content) continue
    const imports = await extractRelativeImports(absoluteFile, content)
    const importRelatives = imports.map((item) => path.relative(resolvedRoot, item).replace(/\\/g, "/"))

    if (relativeFile.endsWith("src/index.ts") && content.includes(".command(")) {
      const commandTargets = importRelatives.filter((item) => item.includes("/cli/cmd/"))
      if (commandTargets.length > 0) {
        addFlow({
          label: "cli_command_flow",
          section: "execution_graph",
          kind: "observed",
          summary: "cli bootstrap dispatches into command handlers",
          paths: [relativeFile, ...commandTargets.slice(0, 3)],
          reason: "yargs command registration points to concrete command modules",
          role: "execution flow surface",
        })
      } else {
        addFlow({
          label: "cli_command_flow",
          section: "execution_graph",
          kind: "inferred",
          summary: "cli bootstrap likely dispatches into command handlers",
          paths: [relativeFile],
          reason: "command registration detected but downstream handler file was not confirmed",
          role: "execution flow surface",
        })
      }
    }

    if (
      content.includes("sdk.client.session.command(") ||
      content.includes("sdk.client.session.prompt(") ||
      content.includes("sdk.client.session.shell(")
    ) {
      const sessionTargets = importRelatives.filter((item) => item.includes("/session/") || item.includes("/cli/cmd/tui/"))
      addFlow({
        label: "tui_action_flow",
        section: "execution_graph",
        kind: sessionTargets.length > 0 ? "observed" : "inferred",
        summary: "tui action submits work into session runtime",
        paths: sessionTargets.length > 0 ? [relativeFile, ...sessionTargets.slice(0, 2)] : [relativeFile],
        reason: "tui prompt dispatches prompt, command, or shell actions into session APIs",
        role: "execution flow surface",
      })
    }

    if (content.includes("SessionPrompt.command(") || content.includes("SessionPrompt.prompt(")) {
      const promptTargets = importRelatives.filter((item) => item.includes("/session/prompt"))
      addFlow({
        label: "session_execution_flow",
        section: "execution_graph",
        kind: promptTargets.length > 0 ? "observed" : "inferred",
        summary: "session surface hands work into the prompt runtime",
        paths: promptTargets.length > 0 ? [relativeFile, ...promptTargets.slice(0, 1)] : [relativeFile],
        reason: "session API calls into the prompt loop",
        role: "execution flow surface",
      })
    }

    if (content.includes("while (true)") && content.includes("SessionStatus.set(") && content.includes("LLM.stream(")) {
      addFlow({
        label: "session_execution_flow",
        section: "orchestration_loop",
        kind: "observed",
        summary: "session runtime maintains the main execution loop",
        paths: [relativeFile],
        reason: "busy/idle status updates and llm stream loop were detected together",
        role: "orchestration loop surface",
      })
    }

    if (content.includes("PermissionNext.ask(") || content.includes("approval") || content.includes("abort(")) {
      if (content.includes("PermissionNext.ask(")) {
        addFlow({
          label: "approval_interruption_flow",
          section: "orchestration_loop",
          kind: "observed",
          summary: "approval checks can interrupt and gate execution",
          paths: [relativeFile],
          reason: "permission handoff is explicitly requested from the execution path",
          role: "approval interruption surface",
        })
      }
      if (content.includes("abort(") && (content.includes("session.abort") || content.includes("abort.abort()"))) {
        addFlow({
          label: "approval_interruption_flow",
          section: "orchestration_loop",
          kind: "inferred",
          summary: "control can pause or stop through abort transitions",
          paths: [relativeFile],
          reason: "abort transition detected in a live execution path",
          role: "control transition surface",
        })
      }
    }

    if ((content.includes("new Worker(") || content.includes("Rpc.client")) && content.includes("client.call(\"server\"")) {
      addFlow({
        label: "worker_dispatch_flow",
        section: "execution_graph",
        kind: "observed",
        summary: "tui thread hands execution into a worker rpc boundary",
        paths: [relativeFile],
        reason: "worker bootstrap and rpc client handoff were detected together",
        role: "execution flow surface",
      })
    }
  }

  if (executionFindings.length === 0) {
    unknowns.push({
      kind: "unknown",
      summary: "primary execution handoff not confirmed from scanned files",
    })
  }
  if (orchestrationFindings.length === 0) {
    unknowns.push({
      kind: "unknown",
      summary: "orchestration loop not confirmed from scanned files",
    })
  }

  const executionConfidence: ExploreConfidence =
    executionFindings.filter((item) => item.kind === "observed").length >= 2
      ? "high_confidence"
      : executionFindings.length > 0
        ? "medium_confidence"
        : "unknown"
  const orchestrationConfidence: ExploreConfidence =
    orchestrationFindings.some((item) => item.kind === "observed")
      ? "high_confidence"
      : orchestrationFindings.length > 0
        ? "medium_confidence"
        : "unknown"

  return {
    execution_graph: {
      confidence: executionConfidence,
      findings: executionFindings,
    },
    orchestration_loop: {
      confidence: orchestrationConfidence,
      findings: orchestrationFindings,
    },
    important_files: importantFiles,
    unknowns_follow_up_targets: unknowns,
  }
}
