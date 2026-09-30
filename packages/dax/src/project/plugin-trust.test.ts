import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { describeWithheld } from "@/cli/cmd/trust"
import { Config } from "@/config/config"
import { Plugin } from "@/plugin"
import { Instance } from "@/project/instance"
import * as ProjectTrust from "./trust"

/**
 * Content binding for a repository's plugin files. Each plugin writes a marker
 * when its module is loaded, so an import is observed as a filesystem effect.
 *
 * A module stays in the runtime's cache once imported, so every phase that
 * checks for an import effect uses a file this process has not imported before.
 */

let home = ""
let directory = ""
let previousHome: string | undefined

beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-plugin-trust-"))
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

function source(name: string, note = "") {
  return `require("node:fs").writeFileSync(${JSON.stringify(marker(name))}, "imported")
export const ${name}Plugin = async () => ({}) // ${note}
`
}

async function folderPlugin(name: string, options: { folder?: string; note?: string } = {}) {
  const folder = path.join(directory, ".dax", options.folder ?? "plugin")
  await fs.mkdir(folder, { recursive: true })
  const file = path.join(folder, `${name}.js`)
  await fs.writeFile(file, source(name, options.note))
  return file
}

/** A plugin the project's config names by relative path, outside the plugin folders. */
async function declaredPlugin(name: string) {
  const file = path.join(directory, "lib", `${name}.js`)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, source(name))
  await fs.writeFile(path.join(directory, "dax.json"), JSON.stringify({ plugin: [`./lib/${name}.js`] }))
  return file
}

async function globalPlugin(name: string) {
  const folder = path.join(home, ".config", "dax", "plugin")
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

async function approve() {
  await session(async (root) => {
    await Config.get()
    await ProjectTrust.trust(root, ProjectTrust.getWithheld())
  })
}

const sha256 = async (file: string) => createHash("sha256").update(await fs.readFile(file)).digest("hex")

function failScan(method: "readdir" | "stat" | "readFile", under: string) {
  const original = fs[method] as (...args: unknown[]) => Promise<unknown>
  const spy = spyOn(fs, method).mockImplementation((async (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith(under)) {
      throw Object.assign(new Error("injected EACCES"), { code: "EACCES" })
    }
    return original(...args)
  }) as never)
  return () => spy.mockRestore()
}

describe("content binding for project plugin files", () => {
  test("an untrusted project's plugins are never imported, and the report binds each file to its content", async () => {
    const alpha = await folderPlugin("alpha")
    const beta = await folderPlugin("beta", { folder: "plugins" })
    const gamma = await declaredPlugin("gamma")
    await session(async (root) => {
      for (let attempt = 0; attempt < 2; attempt++) await Plugin.list()
      for (const name of ["alpha", "beta", "gamma"]) expect(await imported(name)).toBe(false)

      const withheld = ProjectTrust.getWithheld()
      expect(withheld.plugins.sort()).toEqual([alpha, beta, gamma].map((file) => pathToFileURL(file).href).sort())
      expect(withheld.pluginFiles).toEqual(
        [
          `${alpha}#sha256:${await sha256(alpha)}`,
          `${beta}#sha256:${await sha256(beta)}`,
          `${gamma}#sha256:${await sha256(gamma)}`,
        ].sort(),
      )
      expect(await ProjectTrust.isTrusted(root, withheld)).toBe(false)
      // Each local plugin is reported once, with the content being approved.
      const lines = describeWithheld(withheld)
      expect(lines).toHaveLength(3)
      for (const line of lines) expect(line).toContain("imported and run in-process; sha256 ")
    })
  })

  test("an operator-owned global plugin still loads in an untrusted project", async () => {
    await folderPlugin("alpha")
    await globalPlugin("operator")
    await session(async () => {
      await Plugin.list()
      expect(await imported("operator")).toBe(true)
      expect(await imported("alpha")).toBe(false)
    })
  })

  test("approved plugins are imported after a restart", async () => {
    await folderPlugin("alpha")
    await declaredPlugin("gamma")
    await approve()
    expect(await imported("alpha")).toBe(false)
    await session(async () => {
      await Plugin.list()
      expect(await imported("alpha")).toBe(true)
      expect(await imported("gamma")).toBe(true)
      expect(ProjectTrust.getWithheld()).toEqual(ProjectTrust.empty)
    })
  })

  for (const kind of ["folder", "declared"] as const) {
    test(`a ${kind} plugin edited after approval is withheld at load and again after a restart`, async () => {
      const file = kind === "folder" ? await folderPlugin("alpha") : await declaredPlugin("alpha")
      await approve()
      await session(async () => {
        // Approved and config loaded, but not yet imported: edit it now.
        await Config.get()
        await fs.writeFile(file, source("alpha", "edited"))
        await Plugin.list()
        expect(await imported("alpha")).toBe(false)
        expect(ProjectTrust.getWithheld().pluginFiles).toEqual([`${file}#sha256:${await sha256(file)}`])
        expect(ProjectTrust.getWithheld().plugins).toEqual([pathToFileURL(file).href])
      })
      await session(async (root) => {
        await Plugin.list()
        expect(await imported("alpha")).toBe(false)
        expect(await ProjectTrust.isTrusted(root, ProjectTrust.getWithheld())).toBe(false)
      })
      // Reviewing the edited content approves it.
      await approve()
      await session(async () => {
        await Plugin.list()
        expect(await imported("alpha")).toBe(true)
      })
    })
  }

  test("a changed helper, an added file and a removed file each invalidate approval", async () => {
    await folderPlugin("alpha")
    const helper = path.join(directory, ".dax", "plugin", "lib", "helper.js")
    await fs.mkdir(path.dirname(helper), { recursive: true })
    await fs.writeFile(helper, "export const value = 1\n")
    await approve()

    await fs.writeFile(helper, "export const value = 2\n")
    await session(async () => {
      await Plugin.list()
      expect(await imported("alpha")).toBe(false)
    })

    await approve()
    await session(async () => {
      // Added after config load: the approved plugin is withheld with it.
      await Config.get()
      await folderPlugin("added")
      await Plugin.list()
      expect(await imported("alpha")).toBe(false)
      expect(await imported("added")).toBe(false)
    })

    await approve()
    await fs.rm(helper)
    await session(async () => {
      await Plugin.list()
      expect(await imported("alpha")).toBe(false)
      expect(await imported("added")).toBe(false)
    })
  })

  test("revoking trust withholds the plugins again", async () => {
    await folderPlugin("alpha")
    await approve()
    await session(async (root) => {
      await ProjectTrust.revoke(root)
    })
    await session(async (root) => {
      await Plugin.list()
      expect(await imported("alpha")).toBe(false)
      expect(await ProjectTrust.status(root)).toBeUndefined()
      expect(ProjectTrust.getWithheld().pluginFiles).toHaveLength(1)
    })
  })

  test("a record that approved a plugin file by path alone no longer approves it", async () => {
    const file = await folderPlugin("alpha")
    // The record an earlier version wrote for this worktree: the path, no content.
    const byPath = { ...ProjectTrust.empty, plugins: [pathToFileURL(file).href] }
    expect(ProjectTrust.digest(byPath)).toBe(
      createHash("sha256")
        .update(JSON.stringify({ plugins: byPath.plugins, mcp: [], install: [] }))
        .digest("hex"),
    )
    await session(async (root) => {
      await ProjectTrust.trust(root, byPath)
    })
    await session(async (root) => {
      await Plugin.list()
      expect(await imported("alpha")).toBe(false)
      expect(await ProjectTrust.status(root)).toBeDefined()
      expect(ProjectTrust.getWithheld().pluginFiles).toHaveLength(1)
    })
  })

  test("a record with no local plugin files keeps its earlier digest and stays valid", async () => {
    // A package plugin and a local MCP server are identified as before.
    const earlier = { plugins: ["some-pkg@1.2.3"], mcp: ["local"], install: ["/repo/.dax"] }
    expect(ProjectTrust.digest({ ...earlier, tools: [], pluginFiles: [] })).toBe(
      createHash("sha256").update(JSON.stringify(earlier)).digest("hex"),
    )

    await fs.writeFile(
      path.join(directory, "dax.json"),
      JSON.stringify({ mcp: { local: { type: "local", command: ["true"], enabled: false } } }),
    )
    await session(async (root) => {
      await Config.get()
      const withheld = ProjectTrust.getWithheld()
      expect(withheld).toMatchObject({ mcp: ["local"], pluginFiles: [], tools: [] })
      const record = await ProjectTrust.trust(root, withheld)
      expect(record.digest).toBe(
        createHash("sha256")
          .update(JSON.stringify({ plugins: [], mcp: ["local"], install: withheld.install }))
          .digest("hex"),
      )
    })
    await session(async () => {
      expect(Object.keys((await Config.get()).mcp ?? {})).toEqual(["local"])
    })
  })

  test("a plugin file that cannot be read is a failure: nothing imported, nothing approvable", async () => {
    const file = await folderPlugin("alpha")
    const restore = failScan("readFile", path.join(directory, ".dax", "plugin"))
    try {
      await session(async (root) => {
        await Plugin.list()
        expect(await imported("alpha")).toBe(false)
        const withheld = ProjectTrust.getWithheld()
        expect(withheld.pluginScanFailure).toEqual({ path: file, code: "EACCES" })
        expect(withheld.pluginFiles).toEqual([])
        expect(ProjectTrust.isApprovable(withheld)).toBe(false)
        let refusal: unknown
        await ProjectTrust.trust(root, withheld).catch((error) => {
          refusal = error
        })
        expect(refusal).toBeInstanceOf(Error)
        expect(await ProjectTrust.status(root)).toBeUndefined()
        expect(describeWithheld(withheld).at(-1)).toContain("could not be read (EACCES)")
      })
    } finally {
      restore()
    }
  })

  test("a named plugin file that does not exist is a failure, not an absent plugin", async () => {
    const file = await declaredPlugin("gamma")
    await fs.rm(file)
    await session(async () => {
      await Config.get()
      expect(ProjectTrust.getWithheld().pluginScanFailure).toEqual({ path: file, code: "ENOENT" })
      expect(ProjectTrust.isApprovable(ProjectTrust.getWithheld())).toBe(false)
      expect((await Config.get()).plugin ?? []).toEqual([])
    })
  })

  for (const method of ["readdir", "stat", "readFile"] as const) {
    test(`${method} failing only at the load recheck withholds an approved plugin`, async () => {
      await folderPlugin("alpha")
      await approve()
      await session(async () => {
        await Config.get()
        expect((await Config.projectPlugins()).approved).toHaveLength(1)
        const restore = failScan(method, path.join(directory, ".dax", "plugin"))
        try {
          await Plugin.list()
        } finally {
          restore()
        }
        expect(await imported("alpha")).toBe(false)
        expect(ProjectTrust.getWithheld().pluginScanFailure).toMatchObject({ code: "EACCES" })
      })
    })
  }

  test("a project with no plugin folder is normal: no failure and nothing withheld", async () => {
    await session(async () => {
      await Plugin.list()
      expect(await ProjectTrust.inspectProjectPlugins([path.join(directory, ".dax")], [])).toEqual({ files: [] })
      expect((await Config.projectPlugins()).approved).toEqual([])
      expect(ProjectTrust.getWithheld()).toEqual(ProjectTrust.empty)
    })
  })
})
