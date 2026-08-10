import type {
  EmittedArtifact,
  Finding,
  Hypothesis,
  NextAction,
  OpenQuestion,
  Risk,
  SessionState,
  Severity,
} from "../session/state-types"
import type { ContextPack } from "./context-types"
import { generateSessionSummary } from "../session/summarize-state"

/**
 * Operator identities, as reported by `Operator.type` at runtime.
 *
 * These must stay identical to the `type` fields on the operator classes in
 * `src/operators/`. They previously carried class-style names
 * ("ExploreOperator"), which no operator ever reports, so the only selector
 * that branched on them always fell through to its default. A cast to `any`
 * at the call site is what allowed that mismatch to compile.
 */
export const OPERATOR_TYPES = ["explore", "verify", "release", "artifact", "git"] as const
export type OperatorType = (typeof OPERATOR_TYPES)[number]

/**
 * Bounds on how much a single pack may carry.
 *
 * The pack previously had no cap of any kind: every finding, question, risk
 * and artifact accumulated for the life of the session and was handed to the
 * operator whole. These are a deliberately conservative starting policy, not
 * a tuned one. Selection is ordered by severity first, so a cap drops the
 * least important items rather than the newest.
 */
export const CONTEXT_LIMITS = {
  findings: 25,
  hypotheses: 10,
  questions: 10,
  risks: 10,
  artifacts: 20,
  nextActions: 10,
  importantFiles: 30,
} as const

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, major: 1, minor: 2, info: 3 }
const TRI_RANK: Record<"high" | "medium" | "low", number> = { high: 0, medium: 1, low: 2 }

/**
 * Assemble the context an operator receives for one task.
 *
 * Every field is a claim about what the operator is being given, so selection
 * is ordered and bounded rather than "everything we have". `validatedFindings`
 * in particular is a governance claim: it now carries only confirmed findings,
 * because handing an operator unverified findings under that name is exactly
 * the confusion DAX exists to prevent.
 */
export function buildContextPack(sessionState: SessionState, taskId: string, operator: OperatorType): ContextPack {
  const summary = generateSessionSummary(sessionState)
  const validatedFindings = selectFindings(sessionState)

  return {
    sessionId: sessionState.id,
    workflowId: sessionState.workflowId,
    taskId,
    operator,
    goal: sessionState.currentGoal,
    repoTarget: sessionState.workspace.repo,
    validatedFindings,
    activeHypotheses: selectHypotheses(sessionState),
    openQuestions: selectQuestions(sessionState),
    risks: selectRisks(sessionState),
    importantFiles: selectImportantFiles(validatedFindings),
    artifacts: selectArtifacts(sessionState, operator),
    trustState: sessionState.trustState,
    approvalState: sessionState.approvalState,
    nextActions: selectNextActions(sessionState),
    summary: summary.narrative,
  }
}

/** Confirmed findings only, worst first. The field is named for the contract it keeps. */
function selectFindings(sessionState: SessionState): Finding[] {
  return sessionState.findings
    .filter((finding) => finding.confirmed)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, CONTEXT_LIMITS.findings)
}

/** Hypotheses still in play. Settled ones are history, not context. */
function selectHypotheses(sessionState: SessionState): Hypothesis[] {
  return sessionState.hypotheses
    .filter((hypothesis) => hypothesis.status === "testing" || hypothesis.status === "pending")
    .slice(0, CONTEXT_LIMITS.hypotheses)
}

function selectQuestions(sessionState: SessionState): OpenQuestion[] {
  return sessionState.openQuestions
    .filter((question) => question.status === "unanswered")
    .sort((a, b) => TRI_RANK[a.priority] - TRI_RANK[b.priority])
    .slice(0, CONTEXT_LIMITS.questions)
}

/** Unresolved risks, ordered by likelihood then impact. */
function selectRisks(sessionState: SessionState): Risk[] {
  return sessionState.risks
    .filter((risk) => risk.status === "identified")
    .sort((a, b) => TRI_RANK[a.likelihood] - TRI_RANK[b.likelihood] || TRI_RANK[a.impact] - TRI_RANK[b.impact])
    .slice(0, CONTEXT_LIMITS.risks)
}

function selectArtifacts(sessionState: SessionState, operator: OperatorType): EmittedArtifact[] {
  const all = sessionState.emittedArtifacts
  const scoped = (() => {
    switch (operator) {
      case "explore":
        return all.filter((artifact) => artifact.type === "explore_report" || artifact.type === "map")
      case "verify":
        // Explore reports are included deliberately: VerifyOperator treats
        // their presence as a precondition check (`hasExploreArtifacts`).
        // Scoping verify to verification reports alone would make that check
        // permanently false — which is what the broken operator-name match
        // was accidentally protecting it from.
        return all.filter(
          (artifact) => artifact.type === "verification_report" || artifact.type === "explore_report",
        )
      // Release and artifact operators reason over the whole evidence set.
      case "release":
      case "artifact":
      case "git":
        return all
    }
  })()
  return scoped.slice(0, CONTEXT_LIMITS.artifacts)
}

function selectNextActions(sessionState: SessionState): NextAction[] {
  return sessionState.nextActions
    .filter((action) => action.status === "pending")
    .slice(0, CONTEXT_LIMITS.nextActions)
}

/**
 * Files worth the operator's attention, derived from the evidence attached to
 * the findings actually being handed over.
 *
 * This field was previously always empty with a comment promising that
 * operators would populate it, which nothing did. `Finding.evidence` holds
 * "paths to files or specific code snippets", so entries that do not look
 * like paths are skipped. Ordered by how many findings cite the file, since a
 * file implicated repeatedly is the more important one.
 */
function selectImportantFiles(findings: Finding[]): string[] {
  const counts = new Map<string, number>()
  for (const finding of findings) {
    for (const entry of finding.evidence) {
      if (!looksLikePath(entry)) continue
      counts.set(entry, (counts.get(entry) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, CONTEXT_LIMITS.importantFiles)
    .map(([file]) => file)
}

/** A path, not a pasted snippet: single line, no whitespace, and actually path-shaped. */
function looksLikePath(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || /\s/.test(trimmed)) return false
  return trimmed.includes("/") || /\.[a-z0-9]{1,10}$/i.test(trimmed)
}
