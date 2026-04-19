const DEFAULT_BRANCHES = new Set(["main", "master", "trunk"])

export type BranchGuardTone = "warning" | "muted"

export function isDefaultBranch(branch?: string) {
  if (!branch) return false
  return DEFAULT_BRANCHES.has(branch.trim().toLowerCase())
}

export function deriveFeatureBranchNudge(input: {
  branch?: string
  workflowMode?: string
  hasConcreteChanges?: boolean
}) {
  if (!isDefaultBranch(input.branch)) return

  const mode = input.workflowMode ?? "plan"

  if (mode === "plan" && input.hasConcreteChanges) {
    return {
      title: "Planning on a dirty release line",
      detail:
        "You are still on main and there are already concrete changes in play. Branch now so the release line stays trustworthy before this turns into implementation work.",
      tone: "muted" as BranchGuardTone,
    }
  }

  if (mode === "plan" || mode === "explore" || mode === "docs") return

  if (input.hasConcreteChanges) {
    return {
      title: "Move this work off main",
      detail:
        "You already have concrete changes while on main. Create a feature branch before pushing, opening a PR, or continuing larger edits. After any push, check GitHub CI before you trust the result.",
      tone: "warning" as BranchGuardTone,
    }
  }

  return {
    title: "Create a feature branch first",
    detail:
      "You are on main and in a mutating workflow. Branch before larger edits or release-sensitive work so you do not disrupt main. After any push, check GitHub CI before you treat the change as healthy.",
    tone: "warning" as BranchGuardTone,
  }
}
