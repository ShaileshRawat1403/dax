#!/usr/bin/env bun

/**
 * Proof ladder demo.
 *
 * Runs all three Rust proof surfaces against a single synthetic session and
 * prints the results. Requires no credentials and no running DAX server.
 *
 * Usage:
 *   bun run demo:proof-ladder
 */

import { replayRunStateWithRust, createRustProofReport } from "../packages/dax/src/rust/core"
import { evaluatePolicyWithRust } from "../packages/dax/src/rust/policy"
import { evaluateAuditWithRust } from "../packages/dax/src/rust/audit"

// ---------------------------------------------------------------------------
// Shared synthetic event log — a clean completed run with one step and one
// artifact. All three proof surfaces operate on the same session.
// ---------------------------------------------------------------------------

const SESSION_ID = "demo_ses_proof_ladder"
const RUN_ID = "demo_run_proof_ladder"

const EVENTS = [
  { eventId: "e1", sequence: 1, cursor: "c1", runId: RUN_ID, timestamp: "2026-04-26T09:00:00Z", type: "run.created", payload: { status: "created", title: "proof ladder demo" } },
  { eventId: "e2", sequence: 2, cursor: "c2", runId: RUN_ID, timestamp: "2026-04-26T09:00:01Z", type: "run.started", payload: { status: "running" } },
  { eventId: "e3", sequence: 3, cursor: "c3", runId: RUN_ID, timestamp: "2026-04-26T09:00:02Z", type: "step.proposed", payload: { stepId: "s1", title: "analyse repository" } },
  { eventId: "e4", sequence: 4, cursor: "c4", runId: RUN_ID, timestamp: "2026-04-26T09:00:03Z", type: "step.started", payload: { stepId: "s1", title: "analyse repository" } },
  { eventId: "e5", sequence: 5, cursor: "c5", runId: RUN_ID, timestamp: "2026-04-26T09:00:04Z", type: "step.completed", payload: { stepId: "s1", title: "analyse repository", durationMs: 820 } },
  { eventId: "e6", sequence: 6, cursor: "c6", runId: RUN_ID, timestamp: "2026-04-26T09:00:05Z", type: "artifact.created", payload: { artifact: { artifactId: "art_repo_analysis" } } },
  { eventId: "e7", sequence: 7, cursor: "c7", runId: RUN_ID, timestamp: "2026-04-26T09:00:06Z", type: "run.completed", payload: { status: "completed", summaryAvailable: true } },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function header(title: string) {
  const bar = "─".repeat(60)
  console.log(`\n${bar}`)
  console.log(`  ${title}`)
  console.log(bar)
}

function kv(label: string, value: string | number | boolean) {
  const pad = "  " + label.padEnd(24)
  console.log(`${pad}${value}`)
}

function result(label: string, value: string) {
  const v = value.trim()
  const symbol = v.startsWith("pass") || v.startsWith("verified") || v.startsWith("allow")
    ? "✓"
    : v.startsWith("policy_clean") || v.startsWith("ask") || v.startsWith("warn") || v.startsWith("degraded")
    ? "~"
    : "✗"
  console.log(`  ${symbol}  ${label.padEnd(22)}${value}`)
}

// ---------------------------------------------------------------------------
// Step 1 — Replay (dax-core)
// ---------------------------------------------------------------------------

header("Step 1 · dax-core — what happened?")
console.log("  Replaying event log to reconstruct run state...\n")

const runState = await replayRunStateWithRust(EVENTS)

kv("run status", runState.status)
kv("steps completed", runState.steps.filter(s => s.status === "completed").length)
kv("artifacts recorded", runState.artifactIds.length)
kv("pending approvals", runState.pendingApprovalIds.length)

// ---------------------------------------------------------------------------
// Step 2 — Proof report (dax-core)
// ---------------------------------------------------------------------------

header("Step 2 · dax-core — deterministic proof receipt")
console.log("  Generating proof report (same input → same hashes every time)...\n")

const proof = await createRustProofReport(EVENTS)

kv("schema version", proof.schemaVersion)
kv("event count", proof.eventCount)
kv("final status", proof.finalStatus ?? "—")
kv("state hash", proof.stateHash ?? "—")
kv("sequence hash", proof.eventSequenceHash)
result("proof result", proof.result)

// ---------------------------------------------------------------------------
// Step 3 — Policy evaluation (dax-policy)
// ---------------------------------------------------------------------------

header("Step 3 · dax-policy — should the action proceed?")
console.log("  Evaluating three representative actions...\n")

// blocklist makes the deny case explicit and reproducible — the demo uses it
// to show the full allow / ask / deny spectrum rather than relying on profile
// defaults alone.
const policyBase = {
  session_id: SESSION_ID,
  context: {
    profile: "standard" as const,
    blocklist: ["rm -rf"],
  },
}

const policyScenarios = [
  { label: "read file (low risk)", action: { type: "tool_call", tool: "read_file", path: "src/index.ts" } },
  { label: "git commit (mutating)", action: { type: "tool_call", tool: "bash", command: "git commit -m 'update'" } },
  { label: "rm -rf (destructive)", action: { type: "tool_call", tool: "bash", command: "rm -rf /tmp/build" } },
]

for (const scenario of policyScenarios) {
  const r = await evaluatePolicyWithRust({ ...policyBase, action: scenario.action })
  result(`${scenario.label}`, `${r.decision}  (risk: ${r.risk})`)
}

// ---------------------------------------------------------------------------
// Step 4 — Audit (dax-audit)
// ---------------------------------------------------------------------------

header("Step 4 · dax-audit — is this run trustworthy?")
console.log("  Evaluating trust posture across six structured checks...\n")

const auditReport = await evaluateAuditWithRust({
  session_id: SESSION_ID,
  events: EVENTS,
  findings: [],
  policy_decision_count: 5,
  override_count: 0,
  audit_present: true,
})

kv("schema version", auditReport.schema_version)
kv("verification result", auditReport.verification_result)

console.log("")
for (const check of auditReport.checks) {
  result(check.label, check.status)
}

console.log("")
result("trust posture", auditReport.posture)

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

header("Summary")
console.log(`
  DAX does not make model outputs deterministic.
  DAX provides a deterministic runtime contract around stochastic model execution.

  The Rust proof ladder makes that contract testable:

    dax-core   → replays events to prove what happened
    dax-policy → evaluates actions to prove whether they should proceed
    dax-audit  → derives trust posture to prove whether the run is trustworthy

  All three surfaces ran successfully against session ${SESSION_ID}.
`)
