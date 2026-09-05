import path from "path"
import { mkdir } from "fs/promises"
import { Log } from "../util/log"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import z from "zod"

export namespace Discovery {
  const log = Log.create({ service: "skill-discovery" })

  export type RegistryEntry = {
    name: string
    description: string
    url: string
    author?: string
    stars?: number
  }

  export type RegistryIndex = {
    version: number
    skills: RegistryEntry[]
  }

  const component = z
    .string()
    .min(1)
    .refine(
      (value) =>
        value !== "." &&
        value !== ".." &&
        !/[/\\:\0]/.test(value) &&
        !path.isAbsolute(value) &&
        !path.win32.isAbsolute(value),
    )
  const entry = z.object({ name: component, files: z.array(component) })
  const indexSchema = z.object({ skills: z.array(z.unknown()) })

  export function dir() {
    return path.join(Global.Path.cache, "skills")
  }

  /**
   * Fetches the global skill registry.
   */
  export async function registry(): Promise<RegistryEntry[]> {
    // In a real implementation, this would fetch from a CDN
    // const REGISTRY_URL = "https://dax.ai/skills/registry.json"
    // return fetch(REGISTRY_URL).then(r => r.json()).then(j => j.skills)

    // For the prototype, we return a curated list of high-value skills
    return [
      {
        name: "skill-repro",
        description: "Minimal bug reproduction generator (Built-in)",
        url: "https://dax.ai/skills/core",
        author: "DAX Team",
      },
      {
        name: "performance-audit",
        description: "Analyze bundle sizes and dependency performance bottlenecks",
        url: "https://dax.ai/skills/perf",
        author: "Community",
      },
      {
        name: "security-guard",
        description: "Deep security scan for secrets and vulnerable patterns",
        url: "https://dax.ai/skills/security",
        author: "DAX Security",
      },
      {
        name: "migration-helper",
        description: "Safely migrate between libraries (e.g. Axios to Fetch)",
        url: "https://dax.ai/skills/migration",
        author: "Community",
      },
    ]
  }

  async function get(url: string, dest: string, cache: string): Promise<boolean> {
    if (!Filesystem.containsReal(cache, dest)) return false
    if (await Bun.file(dest).exists()) return true
    return fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          log.error("failed to download", { url, status: response.status })
          return false
        }
        const content = await response.text()
        if (!Filesystem.containsReal(cache, dest)) return false
        await Bun.write(dest, content)
        return true
      })
      .catch((err) => {
        log.error("failed to download", { url, err })
        return false
      })
  }

  export async function pull(url: string): Promise<string[]> {
    const result: string[] = []
    const base = url.endsWith("/") ? url : `${url}/`
    const index = new URL("index.json", base).href
    const cache = dir()
    const host = base.slice(0, -1)

    log.info("fetching index", { url: index })
    const data = await fetch(index)
      .then(async (response) => {
        if (!response.ok) {
          log.error("failed to fetch index", { url: index, status: response.status })
          return undefined
        }
        return response
          .json()
          .then((json) => indexSchema.parse(json))
          .catch((err) => {
            log.error("failed to parse index", { url: index, err })
            return undefined
          })
      })
      .catch((err) => {
        log.error("failed to fetch index", { url: index, err })
        return undefined
      })

    if (!data?.skills || !Array.isArray(data.skills)) {
      log.warn("invalid index format", { url: index })
      return result
    }

    const list = data.skills.flatMap((skill) => {
      const parsed = entry.safeParse(skill)
      if (!parsed.success) {
        log.warn("invalid skill entry", { url: index, skill })
        return []
      }
      return [parsed.data]
    })

    if (!Filesystem.containsReal(Global.Path.cache, cache)) return result
    await mkdir(cache, { recursive: true })

    await Promise.all(
      list.map(async (skill) => {
        const root = path.join(cache, skill.name)
        if (!Filesystem.containsReal(cache, root)) return
        await Promise.all(
          skill.files.map(async (file) => {
            const link = new URL(file, `${host}/${skill.name}/`).href
            const dest = path.join(root, file)
            if (!Filesystem.containsReal(cache, dest)) return
            await mkdir(path.dirname(dest), { recursive: true })
            await get(link, dest, cache)
          }),
        )

        const md = path.join(root, "SKILL.md")
        if (Filesystem.containsReal(cache, md) && (await Bun.file(md).exists())) result.push(root)
      }),
    )

    return result
  }
}
