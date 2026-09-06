import { expect, test } from "bun:test"
import { Instance } from "../project/instance"
import { SystemPrompt } from "./system"
import type { Provider } from "../provider/provider"

test("environment reports project facts without implying that the directory tree is empty", async () => {
  await Instance.provide({
    directory: import.meta.dir,
    fn: async () => {
      const model = { api: { id: "test-model" }, providerID: "test-provider" } as Provider.Model
      const prompt = (await SystemPrompt.environment(model)).join("\n")
      expect(prompt).toContain(`Working directory: ${Instance.directory}`)
      expect(prompt).toContain("test-provider/test-model")
      expect(prompt).toContain("Current git branch:")
      expect(prompt).not.toContain("<directories>")
      await Instance.dispose()
    },
  })
})
