import { describe, expect, test } from "bun:test"
import { CONTEXT_LIMITS, OPERATOR_TYPES, buildContextPack } from "./build-context-pack"
import type { Finding, Risk, SessionState, Severity } from "../session/state-types"

const now = "2026-08-10T00:00:00.000Z"

function finding(id: string, severity: Severity, confirmed: boolean, evidence: string[] = []): Finding {
  return {
    id,
    type: "code_smell",
    severity,
    title: `finding ${id}`,
    description: "",
    evidence,
    confirmed,
    timestamp: now,
  }
}

function risk(id: string, likelihood: Risk["likelihood"], impact: Risk["impact"]): Risk {
  return { id, description: id, likelihood, impact, status: "identified", timestamp: now }
}

function sessionState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "ses_test",
    status: "active",
    workspace: { cwd: "/repo" },
    findings: [],
    hypotheses: [],
    openQuestions: [],
    risks: [],
    nextActions: [],
    completedSteps: [],
    emittedArtifacts: [],
    trustState: { score: 1, posture: "trusted", signals: [], lastUpdated: now },
    approvalState: { pending: [], granted: [], denied: [] },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const artifact = (id: string, type: string) => ({
  id,
  type,
  name: id,
  path: `/artifacts/${id}`,
  description: "",
  producedBy: "test",
  timestamp: now,
})

describe("context pack", () => {
  test("validatedFindings carries only confirmed findings", () => {
    // The field is a governance claim. Handing an operator unverified
    // findings under this name is the confusion DAX exists to prevent.
    const pack = buildContextPack(
      sessionState({
        findings: [finding("confirmed", "major", true), finding("unconfirmed", "critical", false)],
      }),
      "task_1",
      "explore",
    )

    expect(pack.validatedFindings.map((f) => f.id)).toEqual(["confirmed"])
  })

  test("findings are ordered worst first so a cap drops the least important", () => {
    const pack = buildContextPack(
      sessionState({
        findings: [
          finding("info", "info", true),
          finding("critical", "critical", true),
          finding("minor", "minor", true),
          finding("major", "major", true),
        ],
      }),
      "task_1",
      "explore",
    )

    expect(pack.validatedFindings.map((f) => f.id)).toEqual(["critical", "major", "minor", "info"])
  })

  test("every collection is bounded", () => {
    // Previously unbounded: every finding accumulated for the life of the
    // session and was handed over whole.
    const many = Array.from({ length: CONTEXT_LIMITS.findings + 25 }, (_, i) => finding(`f${i}`, "major", true))
    const manyRisks = Array.from({ length: CONTEXT_LIMITS.risks + 25 }, (_, i) => risk(`r${i}`, "high", "high"))

    const pack = buildContextPack(sessionState({ findings: many, risks: manyRisks }), "task_1", "explore")

    expect(pack.validatedFindings).toHaveLength(CONTEXT_LIMITS.findings)
    expect(pack.risks).toHaveLength(CONTEXT_LIMITS.risks)
  })

  test("operator-scoped artifact selection actually branches", () => {
    // Regression: OperatorType used class-style names ("ExploreOperator")
    // that no operator reports, so this switch always hit its default and
    // every operator received every artifact. A cast to `any` at the call
    // site is what let the mismatch compile.
    const artifacts = [artifact("a1", "explore_report"), artifact("a2", "verification_report"), artifact("a3", "map")]

    const explore = buildContextPack(sessionState({ emittedArtifacts: artifacts }), "task_1", "explore")
    const verify = buildContextPack(sessionState({ emittedArtifacts: artifacts }), "task_1", "verify")
    const release = buildContextPack(sessionState({ emittedArtifacts: artifacts }), "task_1", "release")

    expect(explore.artifacts.map((a) => a.id)).toEqual(["a1", "a3"])
    expect(verify.artifacts.map((a) => a.id)).toEqual(["a1", "a2"])
    expect(release.artifacts.map((a) => a.id)).toEqual(["a1", "a2", "a3"])
  })

  test("verify still sees explore reports, because it gates on their presence", () => {
    // VerifyOperator computes `hasExploreArtifacts` from this collection.
    // Scoping verify to verification reports alone would make that check
    // permanently false, which no test would have caught before this one.
    const pack = buildContextPack(
      sessionState({ emittedArtifacts: [artifact("a1", "explore_report"), artifact("a2", "verification_report")] }),
      "task_1",
      "verify",
    )

    expect(pack.artifacts.some((a) => a.type === "explore_report")).toBe(true)
  })

  test("operator identities match what the operators actually report", () => {
    // Guards the drift that caused the bug above. These strings must equal
    // the `type` fields on the operator classes in src/operators/.
    expect([...OPERATOR_TYPES]).toEqual(["explore", "verify", "release", "artifact", "git"])
  })

  test("importantFiles come from evidence on the handed-over findings, most cited first", () => {
    const pack = buildContextPack(
      sessionState({
        findings: [
          finding("f1", "critical", true, ["src/a.ts", "src/b.ts"]),
          finding("f2", "major", true, ["src/a.ts", "this is a prose snippet, not a path"]),
          finding("f3", "major", false, ["src/never-selected.ts"]),
        ],
      }),
      "task_1",
      "explore",
    )

    expect(pack.importantFiles).toEqual(["src/a.ts", "src/b.ts"])
    expect(pack.importantFiles).not.toContain("src/never-selected.ts")
  })
})
