import { describe, expect, test } from "bun:test"
import { Permission } from "./next"
import { RookBridge } from "./rook-bridge-types"
import { RookEvaluate } from "./evaluate"

function action(
  overrides: Partial<RookBridge.ProposedAction> = {},
): RookBridge.ProposedAction {
  return {
    schemaVersion: RookBridge.SCHEMA_VERSION,
    id: "act_1",
    runId: "run_1",
    source: "rook",
    sourceAgent: "claude-acp",
    tool: "edit",
    target: "README.md",
    diffPreview: "...",
    ...overrides,
  }
}

describe("RookEvaluate.toPermissionPattern", () => {
  test("edit-family tools map to edit permission with target as pattern", () => {
    expect(RookEvaluate.toPermissionPattern(action({ tool: "write" }))).toEqual(
      { permission: "edit", pattern: "README.md" },
    )
  })

  test("read-family tools map to read permission", () => {
    expect(
      RookEvaluate.toPermissionPattern(
        action({ tool: "grep", target: "src/**" }),
      ),
    ).toEqual({ permission: "read", pattern: "src/**" })
  })

  test("unknown tools pass through with command as pattern when present", () => {
    expect(
      RookEvaluate.toPermissionPattern(
        action({ tool: "bash", target: undefined, command: "rm -rf /" }),
      ),
    ).toEqual({ permission: "bash", pattern: "rm -rf /" })
  })
})

describe("RookEvaluate.evaluate", () => {
  test("policy allow → decision allow, low risk", () => {
    const ruleset = Permission.fromConfig({ edit: { "*": "allow" } })
    const out = RookEvaluate.evaluate(action(), ruleset)
    expect(out.decision).toBe("allow")
    expect(out.risk).toBe("low")
    expect(out.source).toBe("dax")
    expect(out.actionId).toBe("act_1")
    expect(out.reversible).toBe(true)
  })

  test("policy deny → decision deny, high risk by default", () => {
    const ruleset = Permission.fromConfig({ edit: { "*": "deny" } })
    const out = RookEvaluate.evaluate(action(), ruleset)
    expect(out.decision).toBe("deny")
    expect(out.risk).toBe("high")
  })

  test("policy ask → decision needs_approval, medium risk", () => {
    const ruleset = Permission.fromConfig({ edit: { "*": "ask" } })
    const out = RookEvaluate.evaluate(action(), ruleset)
    expect(out.decision).toBe("needs_approval")
    expect(out.risk).toBe("medium")
  })

  test("empty ruleset defaults to ask (PolicyEngine default)", () => {
    const out = RookEvaluate.evaluate(action(), [])
    expect(out.decision).toBe("needs_approval")
  })

  test("riskHint critical escalates a deny to critical", () => {
    const ruleset = Permission.fromConfig({ edit: { "*": "deny" } })
    const out = RookEvaluate.evaluate(
      action({ riskHint: "critical" }),
      ruleset,
    )
    expect(out.risk).toBe("critical")
  })

  test("edit without diffPreview is not marked reversible", () => {
    const ruleset = Permission.fromConfig({ edit: { "*": "allow" } })
    const out = RookEvaluate.evaluate(
      action({ diffPreview: undefined }),
      ruleset,
    )
    expect(out.reversible).toBe(false)
  })

  test("shell-style tool is not marked reversible by default", () => {
    const ruleset = Permission.fromConfig({ bash: { "*": "ask" } })
    const out = RookEvaluate.evaluate(
      action({ tool: "bash", target: undefined, command: "ls" }),
      ruleset,
    )
    expect(out.reversible).toBe(false)
  })
})
