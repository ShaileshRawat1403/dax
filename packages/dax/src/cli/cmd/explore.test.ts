import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { exploreRepository, renderExploreResult } from "../../explore/repo-explore"

describe("explore command surface", () => {
  test("runs the Explore pipeline and returns the fixed structured report", async () => {
    const root = await mkdtemp()

    await Bun.write(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "repo",
        bin: { repo: "./bin/repo" },
        dependencies: {
          "@ai-sdk/openai": "1.0.0",
          "@modelcontextprotocol/sdk": "1.0.0",
        },
      }),
    )
    await Bun.write(path.join(root, "src", "index.ts"), `import yargs from "yargs"\nyargs([]).scriptName("repo")\n`)
    await Bun.write(path.join(root, "src", "session.ts"), `while (true) { SessionStatus.set("s", { type: "busy" }); const stream = await LLM.stream({}); }\n`)
    await Bun.write(path.join(root, "src", "integrations.ts"), `await fetch("https://api.example.com/status")\n`)
    await Bun.write(path.join(root, "bin", "repo"), "#!/usr/bin/env bun\n")

    const result = await exploreRepository(root)

    expect(result.sections.map((section) => section.key)).toEqual([
      "repository_shape",
      "entry_points",
      "execution_graph",
      "orchestration_loop",
      "integrations",
      "important_files",
      "suggested_reading_order",
      "unknowns_follow_up_targets",
    ])

    const rendered = renderExploreResult(result)
    expect(rendered).toContain("Repository shape")
    expect(rendered).toContain("Entry points")
    expect(rendered).toContain("Execution graph")
    expect(rendered).toContain("Integrations")
    expect(rendered).toContain("Suggested reading order")
  })
})

async function mkdtemp() {
  const root = await Bun.$`mktemp -d ${path.join(os.tmpdir(), "dax-explore-command-XXXXXX")}`.text()
  const dir = root.trim()
  await Bun.$`mkdir -p ${path.join(dir, "src")}`.quiet()
  await Bun.$`mkdir -p ${path.join(dir, "bin")}`.quiet()
  return dir
}
