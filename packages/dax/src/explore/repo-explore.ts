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
