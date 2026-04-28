import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"

describe("pane guard", () => {
  test("no prompt pane component points to a removed artifacts pane mode", () => {
    const root = path.resolve(import.meta.dir, "../../cli/cmd/tui/component/prompt")
    const files = fs
      .readdirSync(root)
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
      .map((file) => path.join(root, file))

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8")
      expect(content.includes('session_pane_mode, "artifacts"')).toBe(false)
    }
  })
})
