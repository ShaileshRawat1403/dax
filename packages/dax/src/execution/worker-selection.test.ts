import { describe, expect, test } from "bun:test"
import { compileWithRunId } from "./compiler"

describe("explicit worker authority selection", () => {
  test("keeps an unknown provider on worker_run so execution fails closed", () => {
    const { contract, warnings } = compileWithRunId(
      {
        request: {
          intent: { input: "Analyze this repository using the governed worker." },
          workflowHint: "worker_run",
          personaPreset: { personaId: "worker", providerHint: "worker:unknown" },
        },
      },
      "run_worker_unknown",
    )

    expect(contract.workflowClass).toBe("worker_run")
    expect(contract.workflowHintAccepted).toBe(false)
    expect(contract.providerHint).toBe("worker:unknown")
    expect(warnings).toContain(
      'Workflow hint "worker_run" requires providerHint "worker:<claude|codex|gemini>" and will fail closed.',
    )
  })

  test("continues to accept a registered worker provider", () => {
    const { contract } = compileWithRunId(
      {
        request: {
          intent: { input: "Modify src/index.ts using the governed worker." },
          workflowHint: "worker_run",
          personaPreset: { personaId: "worker", providerHint: "worker:codex" },
        },
      },
      "run_worker_codex",
    )

    expect(contract.workflowClass).toBe("worker_run")
    expect(contract.workflowHintAccepted).toBe(true)
  })
})
