// Runs one project load in a process of its own, for tests that need to observe
// what a full restart executes. Prints one JSON line: what ran, or the error.
//
//   bun run test/fixture/project-trust-process.ts <directory> tool <tool id>
//   bun run test/fixture/project-trust-process.ts <directory> plugin
import { Instance } from "@/project/instance"
import { Plugin } from "@/plugin"
import { ToolRegistry } from "@/tool/registry"
import type { Tool } from "@/tool/tool"

const [directory, kind, toolId] = process.argv.slice(2)

const result = await Instance.provide({
  directory,
  async fn() {
    try {
      if (kind === "plugin") {
        await Plugin.list()
        return { loaded: true }
      }
      const tools = await ToolRegistry.tools({ providerID: "openai", modelID: "gpt-4o" })
      const tool = tools.find((item) => item.id === toolId)
      if (!tool) return { offered: false }
      const identity = ToolRegistry.executionIdentity(tool)
      const ctx = {
        sessionID: "ses_trust_process",
        messageID: "msg_trust_process",
        agent: "build",
        abort: new AbortController().signal,
        messages: [],
        metadata() {},
        async ask() {},
        async authorize() {},
      } as unknown as Tool.Context
      const output = await identity.execute.call(identity.receiver, {} as never, ctx)
      return { offered: true, output: (output as { output: string }).output }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), code: (error as { code?: string }).code }
    }
  },
})
await Instance.disposeAll()
process.stdout.write(`TRUST_PROCESS_RESULT ${JSON.stringify(result)}\n`)
process.exit(0)
