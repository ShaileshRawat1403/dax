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
  return {
    repository_shape: delta.repository_shape ?? base.repository_shape,
    entry_points: delta.entry_points ?? base.entry_points,
    execution_graph: delta.execution_graph ?? base.execution_graph,
    orchestration_loop: delta.orchestration_loop ?? base.orchestration_loop,
    integrations: delta.integrations ?? base.integrations,
    important_files: delta.important_files ?? base.important_files,
    suggested_reading_order: delta.suggested_reading_order ?? base.suggested_reading_order,
    unknowns_follow_up_targets: delta.unknowns_follow_up_targets ?? base.unknowns_follow_up_targets,
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
