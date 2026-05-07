export type ScenarioKind = "core_proof" | "policy" | "audit" | "indexer"

export interface Scenario {
  name: string
  suite: string | string[]
  kind: ScenarioKind
  input: string
  expected: Record<string, unknown>
}

export interface CheckResult {
  name: string
  expected: unknown
  actual: unknown
  passed: boolean
}

export interface ScenarioResult {
  name: string
  kind: ScenarioKind
  passed: boolean
  duration_ms: number
  checks: CheckResult[]
  error?: string
}

export interface EvalReport {
  schema_version: "dax.eval.report.v1"
  suite: string
  generated_at: string
  summary: {
    total: number
    passed: number
    failed: number
  }
  scenarios: ScenarioResult[]
}
