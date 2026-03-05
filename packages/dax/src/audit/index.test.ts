import { describe, expect, test } from "bun:test"
import { Audit } from "./index"

describe("audit contracts", () => {
  test("result schema accepts stable contract", () => {
    const sample = {
      run_id: "audit_abc123",
      timestamp: new Date().toISOString(),
      profile: "strict",
      status: "warn",
      findings: [
        {
          id: "policy.example",
          severity: "high",
          category: "policy",
          title: "Example",
          evidence: "example evidence",
          impact: "example impact",
          fix: "example fix",
          owner_hint: "tech lead",
          blocking: true,
        },
      ],
      summary: {
        blocker_count: 1,
        warning_count: 0,
        info_count: 0,
      },
      next_actions: ["Resolve blocker: Example"],
      metadata: {
        trigger: "manual",
        project_id: "proj_1",
        github_enabled: false,
        auto_triggers: [],
      },
    }
    expect(() => Audit.Result.parse(sample)).not.toThrow()
  })

  test("resolveSettings uses config defaults", () => {
    const settings = Audit.resolveSettings({
      audit: {
        enabled: true,
        profile: "balanced",
        auto_triggers: ["before_release"],
      },
      integration: {
        github: {
          enabled: true,
        },
      },
    } as any)

    expect(settings.enabled).toBeTrue()
    expect(settings.profile).toBe("balanced")
    expect(settings.auto_triggers).toContain("before_release")
    expect(settings.github_enabled).toBeTrue()
  })

  test("shouldAutoTrigger requires enabled + configured trigger", () => {
    const config = {
      audit: {
        enabled: true,
        auto_triggers: ["after_pr_review"],
      },
    } as any
    expect(Audit.shouldAutoTrigger({ trigger: "after_pr_review", config })).toBeTrue()
    expect(Audit.shouldAutoTrigger({ trigger: "manual", config })).toBeFalse()
    expect(Audit.shouldAutoTrigger({ trigger: "before_release", config })).toBeFalse()
  })

  test("gate fails when blocking findings exist", () => {
    const result = Audit.Result.parse({
      run_id: "audit_gate",
      timestamp: new Date().toISOString(),
      profile: "strict",
      status: "fail",
      findings: [
        {
          id: "release.blocker",
          severity: "critical",
          category: "release",
          title: "Blocker",
          evidence: "dirty tree",
          impact: "non reproducible release",
          fix: "clean tree",
          owner_hint: "release engineering",
          blocking: true,
        },
      ],
      summary: {
        blocker_count: 1,
        warning_count: 0,
        info_count: 0,
      },
      next_actions: ["Resolve blocker: Blocker"],
      metadata: {
        trigger: "before_release",
        project_id: "proj_1",
        github_enabled: false,
        auto_triggers: [],
      },
    })

    const gate = Audit.gate(result)
    expect(gate.pass).toBeFalse()
    expect(gate.blockers.length).toBe(1)
    expect(gate.message).toContain("AUDIT_GATE_FAIL")
  })
})

