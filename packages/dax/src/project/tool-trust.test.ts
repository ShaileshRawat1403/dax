import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describeWithheld } from "@/cli/cmd/trust"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { ToolRegistry } from "@/tool/registry"
import * as ProjectTrust from "./trust"

/**
 * Workspace trust for a repository's tool files. Each tool writes a marker when
 * its module is loaded, so "was it imported" is observed as a filesystem effect
 * rather than inferred from what discovery returned.
 *
 * A module stays in the runtime's cache once imported, so every phase that
 * checks for an import effect uses a file this process has not imported before.
 */

let home = ""
let directory = ""
let previousHome: string | undefined

beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-tool-trust-"))
  process.env.DAX_TEST_HOME = home
  directory = path.join(home, "project")
  await fs.mkdir(path.join(directory, ".dax"), { recursive: true })
  await fs.mkdir(path.join(home, ".config", "dax"), { recursive: true })
  const result = Bun.spawnSync(["git", "init"], { cwd: directory })
  if (result.exitCode) throw new Error(result.stderr.toString())
  await Instance.disposeAll()
  Config.global.reset()
})

afterEach(async () => {
  await Instance.disposeAll()
  Config.global.reset()
  ProjectTrust.setWithheld(ProjectTrust.empty)
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await fs.rm(home, { recursive: true, force: true })
})

const marker = (name: string) => path.join(home, `${name}-imported.txt`)
const imported = (name: string) => Bun.file(marker(name)).exists()

function source(name: string, reply = name) {
  return `require("node:fs").writeFileSync(${JSON.stringify(marker(name))}, "imported")
export default { description: ${JSON.stringify(name)}, args: {}, async execute() { return ${JSON.stringify(reply)} } }
`
}

async function projectTool(name: string, options: { folder?: string; extension?: string; reply?: string } = {}) {
  const folder = path.join(directory, ".dax", options.folder ?? "tool")
  await fs.mkdir(folder, { recursive: true })
  const file = path.join(folder, `${name}.${options.extension ?? "js"}`)
  await fs.writeFile(file, source(name, options.reply))
  return file
}

async function globalTool(name: string) {
  const folder = path.join(home, ".config", "dax", "tool")
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(folder, `${name}.js`), source(name))
}

/** One fresh instance, as a restart would give. */
async function session<T>(fn: (root: string) => Promise<T>): Promise<T> {
  await Instance.disposeAll()
  return Instance.provide({
    directory,
    fn: () => fn(ProjectTrust.root(Instance.worktree, Instance.directory)),
  })
}

/** Approve exactly what a fresh config load reports as withheld. */
async function approve() {
  await session(async (root) => {
    await Config.get()
    await ProjectTrust.trust(root, ProjectTrust.getWithheld())
  })
}

describe("workspace trust for project tool files", () => {
  test("an untrusted project's tool files are never imported, in either folder or language", async () => {
    await projectTool("alpha")
    await projectTool("beta", { folder: "tools", extension: "ts" })
    await session(async (root) => {
      expect(root).toBe(directory)
      // Repeated discovery, and everything that leads to it, imports nothing.
      for (let attempt = 0; attempt < 3; attempt++) {
        const ids = await ToolRegistry.ids()
        expect(ids).not.toContain("alpha")
        expect(ids).not.toContain("beta")
        await ToolRegistry.tools({ providerID: "openai", modelID: "gpt-4o" })
      }
      expect(await imported("alpha")).toBe(false)
      expect(await imported("beta")).toBe(false)

      // The report names each file and binds it to its content.
      const withheld = ProjectTrust.getWithheld()
      expect(withheld.tools.map((entry) => path.basename(ProjectTrust.describeToolEntry(entry).file))).toEqual([
        "alpha.js",
        "beta.ts",
      ])
      for (const entry of withheld.tools) {
        const { file, content } = ProjectTrust.describeToolEntry(entry)
        expect(content).toBe(createHash("sha256").update(await fs.readFile(file)).digest("hex"))
      }
      expect(await ProjectTrust.isTrusted(root, withheld)).toBe(false)
      const lines = describeWithheld(withheld)
      expect(lines).toHaveLength(2)
      expect(lines[0]).toContain("alpha.js")
      expect(lines[0]).toContain("imported and run in-process")
    })
  })

  test("an operator-owned global tool still loads in an untrusted project", async () => {
    await projectTool("alpha")
    await globalTool("operator")
    await session(async () => {
      const ids = await ToolRegistry.ids()
      expect(ids).toContain("operator")
      expect(ids).not.toContain("alpha")
      expect(await imported("operator")).toBe(true)
      expect(await imported("alpha")).toBe(false)
    })
  })

  test("approved tool files are discovered and imported after a restart", async () => {
    await projectTool("alpha")
    await approve()
    expect(await imported("alpha")).toBe(false)
    await session(async (root) => {
      expect(await ToolRegistry.ids()).toContain("alpha")
      expect(await imported("alpha")).toBe(true)
      expect(ProjectTrust.getWithheld().tools).toEqual([])
      expect(await ProjectTrust.status(root)).toBeDefined()
    })
  })

  test("a file edited after approval is withheld at once and again after a restart", async () => {
    const file = await projectTool("alpha")
    await approve()
    await session(async (root) => {
      // Approved and config loaded, but not yet discovered: edit it now.
      await Config.get()
      await fs.writeFile(file, source("alpha", "edited reply"))
      expect(await ToolRegistry.ids()).not.toContain("alpha")
      expect(await imported("alpha")).toBe(false)
      const [entry] = ProjectTrust.getWithheld().tools
      expect(ProjectTrust.describeToolEntry(entry).content).toBe(
        createHash("sha256").update(await fs.readFile(file)).digest("hex"),
      )
      expect(await ProjectTrust.status(root)).toBeDefined()
    })
    await session(async (root) => {
      expect(await ToolRegistry.ids()).not.toContain("alpha")
      expect(await imported("alpha")).toBe(false)
      expect(await ProjectTrust.isTrusted(root, ProjectTrust.getWithheld())).toBe(false)
    })
    // Reviewing the edited content approves it.
    await approve()
    await session(async () => {
      expect(await ToolRegistry.ids()).toContain("alpha")
      expect(await imported("alpha")).toBe(true)
    })
  })

  test("a file added to a trusted project withholds the project's tools until reviewed", async () => {
    await projectTool("alpha")
    await approve()
    await session(async () => {
      await Config.get()
      await projectTool("added")
      const ids = await ToolRegistry.ids()
      expect(ids).not.toContain("added")
      expect(ids).not.toContain("alpha")
      expect(await imported("added")).toBe(false)
      expect(await imported("alpha")).toBe(false)
      expect(ProjectTrust.getWithheld().tools).toHaveLength(2)
    })
    await session(async () => {
      expect(await ToolRegistry.ids()).not.toContain("added")
      expect(await imported("added")).toBe(false)
    })
    await approve()
    await session(async () => {
      const ids = await ToolRegistry.ids()
      expect(ids).toContain("added")
      expect(ids).toContain("alpha")
      expect(await imported("added")).toBe(true)
    })
  })

  test("a changed helper beside the tools, and a removed file, both invalidate approval", async () => {
    await projectTool("alpha")
    const helper = path.join(directory, ".dax", "tool", "lib", "helper.js")
    await fs.mkdir(path.dirname(helper), { recursive: true })
    await fs.writeFile(helper, "export const value = 1\n")
    await approve()
    await fs.writeFile(helper, "export const value = 2\n")
    await session(async () => {
      expect(await ToolRegistry.ids()).not.toContain("alpha")
      expect(await imported("alpha")).toBe(false)
    })
    await approve()
    await fs.rm(helper)
    await session(async () => {
      expect(await ToolRegistry.ids()).not.toContain("alpha")
      expect(await imported("alpha")).toBe(false)
    })
  })

  test("revoking trust withholds the tools again", async () => {
    await projectTool("alpha")
    await approve()
    await session(async (root) => {
      await ProjectTrust.revoke(root)
    })
    await session(async (root) => {
      expect(await ToolRegistry.ids()).not.toContain("alpha")
      expect(await imported("alpha")).toBe(false)
      expect(await ProjectTrust.status(root)).toBeUndefined()
      expect(ProjectTrust.getWithheld().tools).toHaveLength(1)
    })
  })

  test("an earlier trust record stays valid without tool files and never approves one", async () => {
    // The digest a record held before tool files were covered.
    const legacy = { plugins: ["pkg@1.0.0"], mcp: ["local"], install: ["/repo/.dax"] }
    const legacyDigest = createHash("sha256")
      .update(JSON.stringify({ plugins: legacy.plugins, mcp: legacy.mcp, install: legacy.install }))
      .digest("hex")
    expect(ProjectTrust.digest({ ...legacy, tools: [] })).toBe(legacyDigest)
    expect(ProjectTrust.digest({ ...legacy, tools: ["/repo/.dax/tool/a.js#sha256:00"] })).not.toBe(legacyDigest)

    // A worktree trusted for a local MCP server, recorded the earlier way.
    await fs.writeFile(
      path.join(directory, "dax.json"),
      JSON.stringify({ mcp: { local: { type: "local", command: ["true"], enabled: false } } }),
    )
    await session(async (root) => {
      await Config.get()
      const withheld = ProjectTrust.getWithheld()
      expect(withheld).toMatchObject({ mcp: ["local"], tools: [] })
      const record = await ProjectTrust.trust(root, withheld)
      expect(record.digest).toBe(
        createHash("sha256")
          .update(JSON.stringify({ plugins: withheld.plugins, mcp: ["local"], install: withheld.install }))
          .digest("hex"),
      )
    })
    await session(async () => {
      expect(Object.keys((await Config.get()).mcp ?? {})).toEqual(["local"])
      expect(ProjectTrust.getWithheld().mcp).toEqual([])
    })

    // A tool file appears. The earlier record approved none, so the whole set is withheld.
    await projectTool("alpha")
    await session(async () => {
      expect(Object.keys((await Config.get()).mcp ?? {})).toEqual([])
      expect(ProjectTrust.getWithheld().mcp).toEqual(["local"])
      expect(await ToolRegistry.ids()).not.toContain("alpha")
      expect(await imported("alpha")).toBe(false)
    })
  })
})
