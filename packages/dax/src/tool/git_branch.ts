import z from "zod"
import { Tool } from "./tool"
import { $ } from "bun"
import { Instance } from "../project/instance"

// Basic git branch name safety: no whitespace, no control chars, no .., no ~^:?*[\
const VALID_BRANCH_RE = /^[^\s~^:?*[\\\x00-\x1f\x7f]+$/

export const GitBranchTool = Tool.define("git_branch", async () => {
  return {
    description: "Create or switch to a git branch for isolated development.",
    parameters: z.object({
      name: z
        .string()
        .min(1, "Branch name cannot be empty")
        .regex(VALID_BRANCH_RE, "Branch name contains invalid characters")
        .refine((v) => !v.includes(".."), { message: "Branch name cannot contain '..'" })
        .describe("The name of the branch to create or switch to"),
      create: z
        .boolean()
        .optional()
        .describe("Whether to create the branch if it doesn't exist (default: false)"),
    }),
    async execute(params) {
      const { name, create } = params
      const cwd = Instance.worktree

      if (create) {
        const created = await $`git checkout -b ${name}`.cwd(cwd).quiet().nothrow()
        if (created.exitCode === 0) {
          return {
            title: `Created branch ${name}`,
            output: `Created and switched to branch "${name}"`,
            metadata: { branch: name },
          }
        }
        // Branch already exists — switch to it
        const switched = await $`git checkout ${name}`.cwd(cwd).quiet().nothrow()
        if (switched.exitCode !== 0) {
          throw new Error(
            `Failed to create or switch to branch "${name}": ${switched.stderr.toString().trim()}`,
          )
        }
        return {
          title: `Switched to ${name}`,
          output: `Switched to existing branch "${name}"`,
          metadata: { branch: name },
        }
      }

      const result = await $`git checkout ${name}`.cwd(cwd).quiet().nothrow()
      if (result.exitCode !== 0) {
        throw new Error(
          `Failed to switch to branch "${name}": ${result.stderr.toString().trim()}`,
        )
      }
      return {
        title: `Switched to ${name}`,
        output: `Switched to branch "${name}"`,
        metadata: { branch: name },
      }
    },
  }
})
