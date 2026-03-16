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
    expect(labelOrchestrationPhase("understand", false)).toBe("Analysis")
    expect(labelOrchestrationPhase("plan", false)).toBe("Strategy")
    expect(labelOrchestrationPhase("execute", false)).toBe("Action")
    expect(labelOrchestrationPhase("verify", false)).toBe("Audit")
    expect(labelOrchestrationPhase("waiting", false)).toBe("Review Required")
    expect(labelOrchestrationPhase("complete", false)).toBe("Done")
  })
})
