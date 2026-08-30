import { describe, test, expect } from "bun:test"
import { compile } from "../../src/execution/compiler"
import { deriveExecutionMode } from "../../src/execution/execution-contract"
import type { CreateRunRequest } from "../../src/server/run-contract"

function makeRequest(intent: string, personaPreset?: Partial<CreateRunRequest["personaPreset"]>): CreateRunRequest {
  return {
    intent: { input: intent },
    personaPreset: personaPreset ? { personaId: "test", ...personaPreset } : undefined,
  }
}

describe("Execution Contract Compilation", () => {
  test("same intent compiles to same workflow class", () => {
    const request = makeRequest("analyze the repository structure")
    const result1 = compile({ request })
    const result2 = compile({ request })

    expect(result1.contract.workflowClass).toBe(result2.contract.workflowClass)
  })

  test("draft intent classifies as draft_and_approve", () => {
    const request = makeRequest("create a new file and prepare it for review")
    const result = compile({ request })

    expect(result.contract.workflowClass).toBe("draft_and_approve")
  })

  test("analyze intent classifies as repo_analyze", () => {
    const request = makeRequest("explore the codebase and summarize findings")
    const result = compile({ request })

    expect(result.contract.workflowClass).toBe("repo_analyze")
  })

  test("review intent classifies as review_and_signoff", () => {
    const request = makeRequest("review this pull request")
    const result = compile({ request })

    expect(result.contract.workflowClass).toBe("review_and_signoff")
  })

  test("worker_run is explicit and requires a governed worker provider hint", () => {
    const request: CreateRunRequest = {
      ...makeRequest("fix the small bug in src/math.ts"),
      workflowHint: "worker_run",
      personaPreset: {
        personaId: "test",
        providerHint: "worker:codex",
      },
    }
    const result = compile({ request })

    expect(result.contract.workflowClass).toBe("worker_run")
    expect(result.contract.workflowHintAccepted).toBe(true)
    expect(result.contract.providerHint).toBe("worker:codex")
    expect(result.contract.executionMode).toBe("approval_gated")
    expect(result.contract.approvalPolicy.mode).toBe("approval_gated")
    expect(result.contract.expectedOutputs.some((output) => output.type === "patch")).toBe(true)
  })

  test("worker_run without a governed provider remains explicit and fails closed", () => {
    const request: CreateRunRequest = {
      ...makeRequest("fix the small bug in src/math.ts"),
      workflowHint: "worker_run",
    }
    const result = compile({ request })

    expect(result.contract.workflowClass).toBe("worker_run")
    expect(result.contract.workflowHintAccepted).toBe(false)
    expect(result.warnings).toContain(
      'Workflow hint "worker_run" requires providerHint "worker:<claude|codex|gemini>" and will fail closed.',
    )
  })

  test("generic intent gets generic workflow class", () => {
    const request = makeRequest("what time is it")
    const result = compile({ request })

    expect(result.contract.workflowClass).toBe("generic")
  })

  test("risk level derived from intent keywords", () => {
    const highRiskRequest = makeRequest("delete all files in the repository")
    const highRiskResult = compile({ request: highRiskRequest })
    expect(highRiskResult.contract.riskLevel).toBe("high")

    const lowRiskRequest = makeRequest("read and analyze the configuration")
    const lowRiskResult = compile({ request: lowRiskRequest })
    expect(lowRiskResult.contract.riskLevel).toBe("low")
  })

  test("tool allowlist is derived from workflow class", () => {
    const analyzeRequest = makeRequest("explore the codebase")
    const analyzeResult = compile({ request: analyzeRequest })
    expect(analyzeResult.contract.toolAllowlist.length).toBeGreaterThan(0)

    const editRequest = makeRequest("edit the configuration file")
    const editResult = compile({ request: editRequest })
    expect(editResult.contract.toolAllowlist.length).toBeGreaterThan(analyzeResult.contract.toolAllowlist.length)
  })

  test("strict persona preset enforces approval_gated mode", () => {
    const request = makeRequest("read the file", { approvalMode: "strict" })
    const result = compile({ request })

    expect(result.contract.executionMode).toBe("manual")
  })

  test("balanced persona preset enforces approval_gated mode", () => {
    const request = makeRequest("edit the file", { approvalMode: "balanced" })
    const result = compile({ request })

    expect(result.contract.executionMode).toBe("approval_gated")
  })

  test("contract has unique contractId", () => {
    const request = makeRequest("analyze the repo")
    const result1 = compile({ request })
    const result2 = compile({ request })

    expect(result1.contract.contractId).not.toBe(result2.contract.contractId)
  })

  test("expected outputs are derived from workflow class", () => {
    const draftRequest = makeRequest("draft a new README file")
    const draftResult = compile({ request: draftRequest })
    expect(draftResult.contract.expectedOutputs.some((o) => o.type === "file")).toBe(true)

    const analyzeRequest = makeRequest("analyze the repository")
    const analyzeResult = compile({ request: analyzeRequest })
    expect(analyzeResult.contract.expectedOutputs.some((o) => o.type === "report")).toBe(true)
  })
})

describe("Execution Mode Derivation", () => {
  test("draft_and_approve defaults to approval_gated", () => {
    const mode = deriveExecutionMode("draft_and_approve", "low")
    expect(mode).toBe("approval_gated")
  })

  test("review_and_signoff defaults to approval_gated", () => {
    const mode = deriveExecutionMode("review_and_signoff", "low")
    expect(mode).toBe("approval_gated")
  })

  test("repo_analyze defaults to auto for low risk", () => {
    const mode = deriveExecutionMode("repo_analyze", "low")
    expect(mode).toBe("auto")
  })

  test("critical risk always results in manual", () => {
    const mode = deriveExecutionMode("generic", "critical")
    expect(mode).toBe("manual")
  })

  test("high risk results in approval_gated", () => {
    const mode = deriveExecutionMode("generic", "high")
    expect(mode).toBe("approval_gated")
  })

  test("explicit mode overrides defaults", () => {
    const mode = deriveExecutionMode("generic", "low", "manual")
    expect(mode).toBe("manual")
  })
})

describe("Contract Structure", () => {
  test("compiled contract has all required fields", () => {
    const request = makeRequest("analyze the codebase")
    const result = compile({ request })
    const contract = result.contract

    expect(contract.contractId).toBeDefined()
    expect(contract.runId).toBe("")
    expect(contract.workflowClass).toBeDefined()
    expect(contract.intent).toBe(request.intent.input)
    expect(contract.executionMode).toBeDefined()
    expect(contract.riskLevel).toBeDefined()
    expect(contract.toolAllowlist).toBeDefined()
    expect(contract.toolBlocklist).toBeDefined()
    expect(contract.approvalPolicy).toBeDefined()
    expect(contract.expectedOutputs).toBeDefined()
    expect(contract.timeoutMs).toBeGreaterThan(0)
    expect(contract.createdAt).toBeDefined()
  })

  test("contractId starts with ctr_", () => {
    const request = makeRequest("test intent")
    const result = compile({ request })

    expect(result.contract.contractId.startsWith("ctr_")).toBe(true)
  })

  test("compiled contract carries default runtime hardening policy", () => {
    const request = makeRequest("fix the build error in packages/dax/src/execution/compiler.ts and verify it")
    const result = compile({ request })

    expect(result.contract.runtimePolicy?.budgets.maxFilesTouched).toBe(8)
    expect(result.contract.runtimePolicy?.budgets.maxMutatingCommands).toBe(6)
    expect(result.contract.runtimePolicy?.postconditions.verificationRequired).toBe(true)
    expect(result.contract.runtimePolicy?.scope.targetFiles).toContain("packages/dax/src/execution/compiler.ts")
  })
})

describe("Approval Policy", () => {
  test("approval_gated mode includes tool categories", () => {
    const request = makeRequest("edit the files", { approvalMode: "balanced" })
    const result = compile({ request })

    expect(result.contract.approvalPolicy.mode).toBe("approval_gated")
    expect(result.contract.approvalPolicy.toolCategories).toBeDefined()
  })

  test("manual mode has no tool categories requirement", () => {
    const request = makeRequest("do something", { approvalMode: "strict" })
    const result = compile({ request })

    expect(result.contract.approvalPolicy.mode).toBe("manual")
  })
})
