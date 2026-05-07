#!/usr/bin/env bun

/**
 * DAX eval runner.
 *
 * Runs deterministic execution-quality checks against dax-core, dax-policy,
 * and dax-audit using the existing Rust wrapper bindings.
 *
 * Usage:
 *   bun run eval:smoke     # run smoke suite (default)
 *   bun run eval:proof     # run proof suite
 *   bun run eval            # same as eval:smoke
 */

import { mkdir, mkdtemp, readdir, readFile, writeFile } from "fs/promises"
import { dirname, join, resolve } from "path"
import { tmpdir } from "os"
import { createRustProofReport } from "../packages/dax/src/rust/core"
import { evaluatePolicyWithRust } from "../packages/dax/src/rust/policy"
import { evaluateAuditWithRust } from "../packages/dax/src/rust/audit"
import { buildIndex, getSymbols, queryIndex } from "../packages/dax/src/rust/indexer"
import type { Scenario, EvalReport, ScenarioResult, CheckResult } from "../evals/types"

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { suite: string } {
  const suite = "smoke"
  for (let i = 0; i < Bun.argv.length; i++) {
    if (Bun.argv[i] === "--suite" && i + 1 < Bun.argv.length) {
      return { suite: Bun.argv[i + 1] }
    }
  }
  return { suite }
}

// ---------------------------------------------------------------------------
// Scenario loading
// ---------------------------------------------------------------------------

const SCENARIOS_DIR = resolve(import.meta.dir, "../evals/scenarios")
const ARTIFACTS_DIR = resolve(import.meta.dir, "../artifacts/evals")

async function loadScenarios(suite: string): Promise<Scenario[]> {
  const files = await readdir(SCENARIOS_DIR)
  const scenarios: Scenario[] = []
  for (const f of files) {
    if (!f.endsWith(".json")) continue
    const raw = JSON.parse(await readFile(join(SCENARIOS_DIR, f), "utf-8"))
    const suites = Array.isArray(raw.suite) ? raw.suite : [raw.suite]
    if (suites.includes(suite)) scenarios.push(raw as Scenario)
  }
  return scenarios.sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

async function loadFixture(scenario: Scenario): Promise<unknown> {
  const base = resolve(import.meta.dir, "../evals/scenarios")
  const fixturePath = resolve(base, scenario.input)
  return JSON.parse(await readFile(fixturePath, "utf-8"))
}

// ---------------------------------------------------------------------------
// Runners by kind
// ---------------------------------------------------------------------------

async function runCoreProof(events: unknown[]): Promise<Record<string, unknown>> {
  const report = await createRustProofReport(events as never[])
  return {
    result: report.result,
    finalStatus: report.finalStatus ?? null,
    stateHash: report.stateHash ?? null,
    eventSequenceHash: report.eventSequenceHash,
  }
}

async function runPolicy(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await evaluatePolicyWithRust(input as never)
  return {
    decision: result.decision,
    risk: result.risk,
    reason: result.reason,
  }
}

async function runAudit(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const report = await evaluateAuditWithRust(input as never)
  return {
    posture: report.posture,
    verification_result: report.verification_result,
    checks: report.checks,
  }
}

async function runIndexer(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const root = await mkdtemp(join(tmpdir(), "dax-indexer-eval-"))
  const files = input.files as Array<{ path: string; content: string }>
  for (const file of files) {
    const target = join(root, file.path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.content)
  }

  const cacheDir = join(root, ".cache", "index")
  const build = await buildIndex({ repoRoot: root, cacheDir, projectId: "eval" })
  const hits = await queryIndex(cacheDir, {
    keywords: [String(input.query ?? "")],
    limit: Number(input.limit ?? 3),
  })
  const symbolsFile = input.symbolsFile ? String(input.symbolsFile) : hits[0]?.path
  const symbols = symbolsFile ? await getSymbols(cacheDir, symbolsFile) : []

  return {
    filesIndexed: build.files_indexed,
    topPath: hits[0]?.path ?? null,
    hitPaths: hits.map((hit) => hit.path),
    symbolNames: symbols.map((symbol) => symbol.name).toSorted(),
  }
}

// ---------------------------------------------------------------------------
// Expected-field comparison
// ---------------------------------------------------------------------------

function checkExpected(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
): CheckResult[] {
  const checks: CheckResult[] = []
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[key]
    let passed: boolean
    if (typeof expectedValue === "string" && (expectedValue as string).endsWith(":")) {
      passed = typeof actualValue === "string" && (actualValue as string).startsWith(expectedValue as string)
    } else {
      passed = JSON.stringify(actualValue) === JSON.stringify(expectedValue)
    }
    checks.push({ name: key, expected: expectedValue, actual: actualValue ?? null, passed })
  }
  return checks
}

// ---------------------------------------------------------------------------
// Report writing
// ---------------------------------------------------------------------------

async function writeReport(report: EvalReport): Promise<void> {
  await mkdir(ARTIFACTS_DIR, { recursive: true })
  await Bun.write(join(ARTIFACTS_DIR, `${report.suite}-report.json`), JSON.stringify(report, null, 2))
}

// ---------------------------------------------------------------------------
// Terminal output
// ---------------------------------------------------------------------------

function header(title: string) {
  const bar = "─".repeat(60)
  console.log(`\n${bar}`)
  console.log(`  ${title}`)
  console.log(bar)
}

function printReport(report: EvalReport) {
  header(`DAX Evals — ${report.suite} suite`)
  console.log(`  Generated: ${report.generated_at}`)
  console.log(`  Schema:    ${report.schema_version}`)
  console.log()

  for (const s of report.scenarios) {
    const icon = s.passed ? "✓" : "✗"
    console.log(`  ${icon}  ${s.name}  (${s.duration_ms}ms)`)
    for (const c of s.checks) {
      const ci = c.passed ? "  ✓" : "  ✗"
      console.log(`      ${ci} ${c.name}: expected=${JSON.stringify(c.expected)}, actual=${JSON.stringify(c.actual)}`)
    }
    if (s.error) console.log(`      error: ${s.error}`)
  }

  console.log()
  const { total, passed, failed } = report.summary
  console.log(`  Total:   ${total}`)
  console.log(`  Passed:  ${passed}`)
  console.log(`  Failed:  ${failed}`)
  console.log()
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { suite } = parseArgs()
  const scenarios = await loadScenarios(suite)

  if (scenarios.length === 0) {
    console.error(`No scenarios found for suite: ${suite}`)
    process.exit(1)
  }

  const results: ScenarioResult[] = []

  for (const scenario of scenarios) {
    const start = performance.now()
    let checks: CheckResult[] = []
    let passed = true
    let error: string | undefined

    try {
      const fixture = await loadFixture(scenario)
      let actual: Record<string, unknown>

      switch (scenario.kind) {
        case "core_proof":
          actual = await runCoreProof(fixture as never[])
          break
        case "policy":
          actual = await runPolicy(fixture as Record<string, unknown>)
          break
        case "audit":
          actual = await runAudit(fixture as Record<string, unknown>)
          break
        case "indexer":
          actual = await runIndexer(fixture as Record<string, unknown>)
          break
        default:
          throw new Error(`Unknown scenario kind: ${(scenario as Scenario).kind}`)
      }

      checks = checkExpected(actual, scenario.expected as Record<string, unknown>)
      passed = checks.every(c => c.passed)
    } catch (e) {
      passed = false
      error = e instanceof Error ? e.message : String(e)
    }

    const duration_ms = Math.round(performance.now() - start)
    results.push({ name: scenario.name, kind: scenario.kind, passed, duration_ms, checks, error })
  }

  const report: EvalReport = {
    schema_version: "dax.eval.report.v1",
    suite,
    generated_at: new Date().toISOString(),
    summary: {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
    },
    scenarios: results,
  }

  await writeReport(report)
  printReport(report)

  if (report.summary.failed > 0) {
    console.error(`\n${report.summary.failed} scenario(s) failed.`)
    process.exit(1)
  }
}

main()
