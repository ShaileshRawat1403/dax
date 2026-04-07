import type { Operator, OperatorContext, OperatorResult } from "./base"
import type { PlannedTask } from "../planner/task-graph"
import { $ } from "bun"

export class GitOperator implements Operator {
  readonly type = "git"

  async execute(task: PlannedTask, ctx: OperatorContext): Promise<OperatorResult> {
    const action = task.context?.action || "commit"
    const args = task.context?.args || []
    const message = task.context?.message || task.description
    
    let command = ""
    let resultOutput = ""
    let success = true
    let error: Error | undefined

    try {
      switch (action) {
        case "add":
          const files = args.length > 0 ? args.join(" ") : "."
          command = `git add ${files}`
          await $`git add ${args.length > 0 ? args : ["."]}`.cwd(ctx.cwd)
          resultOutput = `Staged files: ${files}`
          break
        case "commit":
          command = `git commit -m "${message}"`
          const commitRes = await $`git commit -m ${message}`.cwd(ctx.cwd).nothrow()
          success = commitRes.exitCode === 0
          resultOutput = commitRes.stdout.toString() || commitRes.stderr.toString()
          if (!success) error = new Error(resultOutput)
          break
        case "push":
          command = `git push ${args.join(" ")}`
          const pushRes = await $`git push ${args}`.cwd(ctx.cwd).nothrow()
          success = pushRes.exitCode === 0
          resultOutput = pushRes.stdout.toString() || pushRes.stderr.toString()
          if (!success) error = new Error(resultOutput)
          break
        case "checkout":
          const branch = args[0]
          if (!branch) throw new Error("Branch name required for checkout")
          command = `git checkout ${branch}`
          const checkoutRes = await $`git checkout ${branch}`.cwd(ctx.cwd).nothrow()
          success = checkoutRes.exitCode === 0
          resultOutput = checkoutRes.stdout.toString() || checkoutRes.stderr.toString()
          if (!success) error = new Error(resultOutput)
          break
        case "status":
          command = `git status`
          const statusRes = await $`git status`.cwd(ctx.cwd).text()
          resultOutput = statusRes
          break
        default:
          throw new Error(`Unsupported git action: ${action}`)
      }
    } catch (e) {
      success = false
      error = e instanceof Error ? e : new Error(String(e))
      resultOutput = error.message
    }

    const markdownOutput = `### Git Operation: ${action}\n\n**Command:** \`${command}\` \n\n**Output:**\n\`\`\`\n${resultOutput}\n\`\`\``

    return {
      success,
      output: {
        action,
        command,
        result: resultOutput,
        operator: this.type,
        task: task.id,
        sessionId: ctx.sessionId,
      },
      error,
      markdownOutput,
    }
  }
}
