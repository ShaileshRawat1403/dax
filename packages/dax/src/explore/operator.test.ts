import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { parseExploreArguments, runExploreOperator } from "./operator"

describe("explore operator", () => {
  test("parses path, format, and eli12 flags consistently", () => {
    expect(parseExploreArguments(`apps/api --eli12 --format=json`)).toEqual({
      pathArg: "apps/api",
      eli12: true,
      format: "json",
    })

    expect(parseExploreArguments(`--json`)).toEqual({
      pathArg: undefined,
      eli12: false,
      format: "json",
    })
  })

  test("runs the shared explore operator for table and json output", async () => {
    const root = await mkdtemp()

    await Bun.write(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "repo",
        bin: { repo: "./bin/repo" },
      }),
    )
    await Bun.write(path.join(root, "src", "index.ts"), `import yargs from "yargs"\nyargs([]).scriptName("repo")\n`)
    await Bun.write(path.join(root, "src", "server.ts"), `createServer(() => {}).listen(3000)\n`)
    await Bun.write(path.join(root, "bin", "repo"), "#!/usr/bin/env bun\n")

    const table = await runExploreOperator({ baseDir: root, format: "table", eli12: true })
    expect(table.target).toBe(root)
    expect(table.rendered).toContain("Repository shape")

    const json = await runExploreOperator({ baseDir: root, format: "json" })
    expect(json.rendered).toContain(`"sections"`)
  })
})

async function mkdtemp() {
  const root = await Bun.$`mktemp -d ${path.join(os.tmpdir(), "dax-explore-operator-XXXXXX")}`.text()
  const dir = root.trim()
  await Bun.$`mkdir -p ${path.join(dir, "src")}`.quiet()
  await Bun.$`mkdir -p ${path.join(dir, "bin")}`.quiet()
  return dir
}
