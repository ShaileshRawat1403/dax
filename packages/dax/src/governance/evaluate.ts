import { Permission } from "./next"
import { PolicyEngine } from "./policy-engine"
import { RookBridge } from "./rook-bridge-types"

export namespace RookEvaluate {
  /**
   * Tool buckets — kept here rather than imported so this module stays
   * cheap to load and easy to reason about. Mirrors the EDIT_TOOLS list
   * in policy-engine.ts.
   */
  const EDIT_TOOLS = new Set(["edit", "write", "patch", "multiedit"])
  const READ_TOOLS = new Set(["read", "list", "search", "glob", "grep", "ls"])

  /** Map a proposed action onto the (permission, pattern) pair PolicyEngine expects. */
  export function toPermissionPattern(action: RookBridge.ProposedAction): {
    permission: string
    pattern: string
  } {
    const tool = action.tool.toLowerCase()
    if (EDIT_TOOLS.has(tool)) {
      return { permission: "edit", pattern: action.target ?? "*" }
    }
    if (READ_TOOLS.has(tool)) {
      return { permission: "read", pattern: action.target ?? "*" }
    }
    return {
      permission: tool,
      pattern: action.command ?? action.target ?? "*",
    }
  }

  /** Risk level inferred from the policy action plus any hint from the caller. */
  function inferRisk(
    policyAction: PolicyEngine.Action,
    hint: RookBridge.RiskLevel | undefined,
  ): RookBridge.RiskLevel {
    if (policyAction === "deny") return hint === "critical" ? "critical" : "high"
    if (policyAction === "ask") return hint ?? "medium"
    return hint ?? "low"
  }

  /**
   * Reversibility heuristic. Read-like and edits-with-diff are reversible;
   * shell commands are assumed irreversible unless flagged otherwise.
   */
  function inferReversible(action: RookBridge.ProposedAction): boolean {
    const tool = action.tool.toLowerCase()
    if (READ_TOOLS.has(tool)) return true
    if (EDIT_TOOLS.has(tool)) return action.diffPreview !== undefined
    return false
  }

  /** Map policy action → bridge decision. Stateless: no approval persistence. */
  function toDecision(
    policyAction: PolicyEngine.Action,
  ): RookBridge.Decision {
    if (policyAction === "allow") return "allow"
    if (policyAction === "deny") return "deny"
    return "needs_approval"
  }

  /**
   * Evaluate a proposed action against the supplied rulesets.
   * Pure function — no I/O, no persistence. Caller is responsible for
   * loading config and merging with defaults.
   */
  export function evaluate(
    action: RookBridge.ProposedAction,
    ruleset: Permission.Ruleset,
  ): RookBridge.GovernanceDecision {
    const { permission, pattern } = toPermissionPattern(action)
    const rule = Permission.evaluate(permission, pattern, ruleset)
    const decision = toDecision(rule.action)
    const risk = inferRisk(rule.action, action.riskHint)
    const reversible = inferReversible(action)

    const reason =
      rule.action === "allow"
        ? `Policy allows ${permission} on ${pattern}.`
        : rule.action === "deny"
          ? `Policy denies ${permission} on ${pattern} (rule: ${rule.permission}/${rule.pattern}).`
          : `Policy requires approval for ${permission} on ${pattern}.`

    return {
      schemaVersion: RookBridge.SCHEMA_VERSION,
      actionId: action.id,
      source: "dax",
      decision,
      risk,
      reason,
      reversible,
    }
  }
}
