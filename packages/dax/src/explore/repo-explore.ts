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
  return {
    sections: [
      ...((["repository_shape", "entry_points", "execution_graph", "orchestration_loop", "integrations"] as ExploreSectionKey[]).map(
        (key) => ({
          key,
          title: SECTION_TITLES[key],
          confidence: outputs[key].confidence,
          findings: outputs[key].findings,
        }),
      )),
      {
        key: "important_files",
        title: "Important files" as const,
        files: outputs.important_files,
      },
      {
        key: "suggested_reading_order",
        title: "Suggested reading order" as const,
        steps: outputs.suggested_reading_order,
      },
      {
        key: "unknowns_follow_up_targets",
        title: "Unknowns / follow-up targets" as const,
        items: outputs.unknowns_follow_up_targets,
      },
    ],
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

type EntryPointCandidate = {
  type: RuntimeEntryType
  kind: ExploreEvidenceKind
  summary: string
  paths: string[]
  reason: string
}

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
