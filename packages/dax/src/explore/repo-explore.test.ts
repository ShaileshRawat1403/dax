import { describe, expect, it } from "bun:test"
import {
  buildExploreResult,
  createEmptyExplorePassOutputs,
  renderExploreResult,
  type RepoExplorePassOutputs,
} from "./repo-explore"

describe("repo explore scaffolding", () => {
  it("builds the fixed section order required by the Explore output contract", () => {
    const result = buildExploreResult(createEmptyExplorePassOutputs())

    expect(result.sections.map((section) => section.key)).toEqual([
      "repository_shape",
      "entry_points",
      "execution_graph",
      "orchestration_loop",
      "integrations",
      "important_files",
      "suggested_reading_order",
      "unknowns_follow_up_targets",
    ])
  })

  it("renders evidence markers, confidence labels, file citations, and follow-up structure", () => {
    const outputs: RepoExplorePassOutputs = {
      repository_shape: {
        confidence: "high_confidence",
        findings: [{ kind: "observed", summary: "canonical runtime under packages/dax", paths: ["packages/dax"] }],
      },
      entry_points: {
        confidence: "high_confidence",
        findings: [{ kind: "observed", summary: "CLI entry point", paths: ["packages/dax/src/index.ts"] }],
      },
      execution_graph: {
        confidence: "medium_confidence",
        findings: [{ kind: "inferred", summary: "session runtime coordinates the main execution flow", paths: ["packages/dax/src/session/index.ts"] }],
      },
      orchestration_loop: {
        confidence: "medium_confidence",
        findings: [{ kind: "observed", summary: "stable operator loop aligns with plan -> run -> approvals -> artifacts -> audit" }],
      },
      integrations: {
        confidence: "low_confidence",
        findings: [{ kind: "unknown", summary: "queue backend not confirmed" }],
      },
      important_files: [
        { path: "packages/dax/src/index.ts", role: "CLI entry surface" },
        { path: "packages/dax/src/session/index.ts", role: "session runtime coordination" },
      ],
      suggested_reading_order: [
        { path: "packages/dax/src/index.ts", reason: "establishes runtime entry" },
        { path: "packages/dax/src/session/index.ts", reason: "shows session control flow" },
      ],
      unknowns_follow_up_targets: [
        { kind: "unknown", summary: "background job entry surface not confirmed" },
        { kind: "follow_up", summary: "inspect provider initialization under packages/dax/src/provider/*" },
      ],
    }

    const rendered = renderExploreResult(buildExploreResult(outputs))

    expect(rendered).toContain("Repository shape")
    expect(rendered).toContain("Confidence: high confidence")
    expect(rendered).toContain("- Observed: canonical runtime under packages/dax (packages/dax)")
    expect(rendered).toContain("- Observed: CLI entry point (packages/dax/src/index.ts)")
    expect(rendered).toContain("- Inferred: session runtime coordinates the main execution flow (packages/dax/src/session/index.ts)")
    expect(rendered).toContain("- Unknown: queue backend not confirmed")
    expect(rendered).toContain("- packages/dax/src/index.ts — CLI entry surface")
    expect(rendered).toContain("1. packages/dax/src/index.ts")
    expect(rendered).toContain("Reason: establishes runtime entry")
    expect(rendered).toContain("- Follow-up: inspect provider initialization under packages/dax/src/provider/*")
  })

  it("preserves structure in eli12 mode while simplifying empty-section wording", () => {
    const rendered = renderExploreResult(buildExploreResult(createEmptyExplorePassOutputs()), { eli12: true })

    expect(rendered).toContain("Repository shape")
    expect(rendered).toContain("Confidence: unknown")
    expect(rendered).toContain("- Unknown: DAX could not confirm this section yet.")
    expect(rendered).toContain("Important files")
    expect(rendered).toContain("Suggested reading order")
    expect(rendered).toContain("Unknowns / follow-up targets")
  })
})
