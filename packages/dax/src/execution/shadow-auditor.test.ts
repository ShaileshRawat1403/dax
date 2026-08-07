import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Provider } from "@/provider/provider"
import { ShadowAuditor } from "./shadow-auditor"
import type { ExecutionContract } from "./execution-contract"

const contract = {
  contractId: "ctr_test",
  workflowClass: "code_change",
  riskLevel: "low",
} as unknown as ExecutionContract

describe("shadow auditor", () => {
  const original = process.env.DAX_DISABLE_SHADOW_AUDIT

  afterEach(() => {
    if (original === undefined) delete process.env.DAX_DISABLE_SHADOW_AUDIT
    else process.env.DAX_DISABLE_SHADOW_AUDIT = original
  })

  test("does not reach a provider when disabled", async () => {
    // The auditor is fire-and-forget, so an unguarded provider call surfaces as
    // an auth error logged inside an otherwise passing suite rather than as a
    // failure anyone acts on.
    process.env.DAX_DISABLE_SHADOW_AUDIT = "1"
    const defaultModel = spyOn(Provider, "defaultModel")

    await ShadowAuditor.analyze("ses_test", "add a feature", contract)

    expect(defaultModel).not.toHaveBeenCalled()
    defaultModel.mockRestore()
  })

  test("still reaches the provider when not disabled", async () => {
    // Guards the guard: without this the test above would pass even if the
    // auditor were disabled unconditionally.
    delete process.env.DAX_DISABLE_SHADOW_AUDIT
    const defaultModel = spyOn(Provider, "defaultModel").mockResolvedValue({
      providerID: "stub",
      modelID: "stub",
    })
    // Stopped at the next boundary so the assertion stays about the guard and
    // never reaches a real provider.
    const getModel = spyOn(Provider, "getModel").mockImplementation(async () => undefined as never)

    await ShadowAuditor.analyze("ses_test", "add a feature", contract)

    expect(defaultModel).toHaveBeenCalled()
    defaultModel.mockRestore()
    getModel.mockRestore()
  })
})
