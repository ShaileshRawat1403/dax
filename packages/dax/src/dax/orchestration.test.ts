import { describe, expect, it } from "bun:test"
import { labelOrchestrationPhase, streamStageToOrchestrationPhase } from "./orchestration"

describe("orchestration contract", () => {
  it("maps internal stream stages to the stable workstation loop", () => {
    expect(streamStageToOrchestrationPhase("exploring")).toBe("understand")
    expect(streamStageToOrchestrationPhase("thinking")).toBe("understand")
    expect(streamStageToOrchestrationPhase("planning")).toBe("plan")
    expect(streamStageToOrchestrationPhase("executing")).toBe("execute")
    expect(streamStageToOrchestrationPhase("verifying")).toBe("verify")
    expect(streamStageToOrchestrationPhase("waiting")).toBe("waiting")
    expect(streamStageToOrchestrationPhase("done")).toBe("complete")
  })

  it("uses product-facing labels for the workstation phases", () => {
    expect(labelOrchestrationPhase("understand", false)).toBe("Understanding")
    expect(labelOrchestrationPhase("plan", false)).toBe("Planning")
    expect(labelOrchestrationPhase("execute", false)).toBe("Executing")
    expect(labelOrchestrationPhase("verify", false)).toBe("Verifying")
    expect(labelOrchestrationPhase("waiting", false)).toBe("Waiting for approval")
    expect(labelOrchestrationPhase("complete", false)).toBe("Complete")
  })
})
