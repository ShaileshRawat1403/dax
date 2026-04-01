export const EXPLORE_TOOLS = [
  "read",
  "glob",
  "grep",
  "list",
  "webfetch",
  "websearch",
  "codesearch",
  "lsp",
  "invalid",
] as const

export const PLAN_TOOLS = ["task", "todowrite", "question", "skill", "plan_enter", "plan_exit"] as const

export const EXECUTE_TOOLS = ["write", "edit", "apply_patch", "shell", "batch"] as const

export const VERIFY_TOOLS = ["read", "grep", "list", "glob", "lsp"] as const

export type ExploreTool = (typeof EXPLORE_TOOLS)[number]
export type PlanTool = (typeof PLAN_TOOLS)[number]
export type ExecuteTool = (typeof EXECUTE_TOOLS)[number]
export type VerifyTool = (typeof VERIFY_TOOLS)[number]

export const MUTATING_SHELL_PATTERNS = [
  "rm *",
  "mv *",
  "cp *",
  "mkdir *",
  "git commit *",
  "git push *",
  "git checkout *",
  "git merge *",
  "git rebase *",
  "npm install *",
  "npm uninstall *",
  "npm update *",
  "npm publish *",
  "bun install *",
  "bun add *",
  "bun remove *",
  "yarn add *",
  "yarn remove *",
  "pnpm add *",
  "pnpm remove *",
  "cargo add *",
  "cargo remove *",
  "cargo install *",
  "pip install *",
  "pip uninstall *",
  "chmod *",
  "chown *",
  "patch *",
]
