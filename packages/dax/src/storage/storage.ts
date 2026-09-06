import { Log } from "../util/log"
import path from "path"
import fs from "fs/promises"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Lock } from "../util/lock"
import { $ } from "bun"
import { NamedError } from "@dax-ai/util/error"
import z from "zod"

export namespace Storage {
  const log = Log.create({ service: "storage" })

  type Migration = (dir: string) => Promise<void>

  export const NotFoundError = NamedError.create(
    "NotFoundError",
    z.object({
      message: z.string(),
    }),
  )

  export const InvalidKeyError = NamedError.create(
    "InvalidKeyError",
    z.object({
      key: z.array(z.string()),
      segment: z.string(),
    }),
  )

  /**
   * Key segments become path segments, so a caller that passes an unvalidated
   * ID - a share import, an HTTP route param - would otherwise be able to walk
   * out of the storage root and read or overwrite anything the process can.
   * Every segment must be one inert name.
   */
  function assertKey(key: string[]) {
    for (const segment of key) {
      if (segment === "" || segment === "." || segment === ".." || /[/\\\0]/.test(segment))
        throw new InvalidKeyError({ key, segment })
    }
  }

  function resolve(dir: string, key: string[]) {
    assertKey(key)
    return path.join(dir, ...key) + ".json"
  }

  const MIGRATIONS: Migration[] = [
    async (dir) => {
      const project = path.resolve(dir, "../project")
      if (!(await Filesystem.isDir(project))) return
      for await (const projectDir of new Bun.Glob("*").scan({
        cwd: project,
        onlyFiles: false,
      })) {
        log.info(`migrating project ${projectDir}`)
        let projectID = projectDir
        const fullProjectDir = path.join(project, projectDir)
        let worktree = "/"

        if (projectID !== "global") {
          for await (const msgFile of new Bun.Glob("storage/session/message/*/*.json").scan({
            cwd: path.join(project, projectDir),
            absolute: true,
          })) {
            const json = await Bun.file(msgFile).json()
            worktree = json.path?.root
            if (worktree) break
          }
          if (!worktree) continue
          if (!(await Filesystem.isDir(worktree))) continue
          const [id] = await $`git rev-list --max-parents=0 --all`
            .quiet()
            .nothrow()
            .cwd(worktree)
            .text()
            .then((x) =>
              x
                .split("\n")
                .filter(Boolean)
                .map((x) => x.trim())
                .toSorted(),
            )
          if (!id) continue
          projectID = id

          await Bun.write(
            path.join(dir, "project", projectID + ".json"),
            JSON.stringify({
              id,
              vcs: "git",
              worktree,
              time: {
                created: Date.now(),
                initialized: Date.now(),
              },
            }),
          )

          log.info(`migrating sessions for project ${projectID}`)
          for await (const sessionFile of new Bun.Glob("storage/session/info/*.json").scan({
            cwd: fullProjectDir,
            absolute: true,
          })) {
            const dest = path.join(dir, "session", projectID, path.basename(sessionFile))
            log.info("copying", {
              sessionFile,
              dest,
            })
            const session = await Bun.file(sessionFile).json()
            await Bun.write(dest, JSON.stringify(session))
            log.info(`migrating messages for session ${session.id}`)
            for await (const msgFile of new Bun.Glob(`storage/session/message/${session.id}/*.json`).scan({
              cwd: fullProjectDir,
              absolute: true,
            })) {
              const dest = path.join(dir, "message", session.id, path.basename(msgFile))
              log.info("copying", {
                msgFile,
                dest,
              })
              const message = await Bun.file(msgFile).json()
              await Bun.write(dest, JSON.stringify(message))

              log.info(`migrating parts for message ${message.id}`)
              for await (const partFile of new Bun.Glob(`storage/session/part/${session.id}/${message.id}/*.json`).scan(
                {
                  cwd: fullProjectDir,
                  absolute: true,
                },
              )) {
                const dest = path.join(dir, "part", message.id, path.basename(partFile))
                const part = await Bun.file(partFile).json()
                log.info("copying", {
                  partFile,
                  dest,
                })
                await Bun.write(dest, JSON.stringify(part))
              }
            }
          }
        }
      }
    },
    async (dir) => {
      for await (const item of new Bun.Glob("session/*/*.json").scan({
        cwd: dir,
        absolute: true,
      })) {
        const session = await Bun.file(item).json()
        if (!session.projectID) continue
        if (!session.summary?.diffs) continue
        const { diffs } = session.summary
        await Bun.file(path.join(dir, "session_diff", session.id + ".json")).write(JSON.stringify(diffs))
        await Bun.file(path.join(dir, "session", session.projectID, session.id + ".json")).write(
          JSON.stringify({
            ...session,
            summary: {
              additions: diffs.reduce((sum: any, x: any) => sum + x.additions, 0),
              deletions: diffs.reduce((sum: any, x: any) => sum + x.deletions, 0),
            },
          }),
        )
      }
    },
  ]

  /**
   * Migration and mkdir are per storage root, so the memo is keyed by the root
   * it describes rather than by the process.
   *
   * This was `lazy(...)`, which computes once and never again. `Global.Path.data`
   * resolves `DAX_TEST_HOME` on every call, so it follows the environment — but
   * the first caller to touch Storage froze `dir` for the life of the process, and
   * every later resolution was discarded. In a real run the home never changes, so
   * that was invisible. Under `bun test`, every test file shares one process: the
   * first file to touch Storage silently owned the storage root, and every other
   * file's sessions, run states and event logs were written into it. Per-file
   * `DAX_TEST_HOME` and per-file temp-dir cleanup both became no-ops, so runs
   * accumulated across the whole suite and any test that enumerates runs — stranded
   * detection, recovery, the gateway listing — read other files' fixtures,
   * including the deliberately malformed ones.
   *
   * Keying by directory changes nothing in production, where `Global.Path.data` is
   * constant and this resolves to exactly one entry with migrations run exactly
   * once, as before.
   */
  const states = new Map<string, Promise<{ dir: string }>>()

  async function initialize(dir: string) {
    await fs.mkdir(dir, { recursive: true })
    const migration = await Bun.file(path.join(dir, "migration"))
      .json()
      .then((x) => parseInt(x))
      .catch(() => 0)
    for (let index = migration; index < MIGRATIONS.length; index++) {
      log.info("running migration", { index })
      const step = MIGRATIONS[index]
      await step(dir).catch(() => log.error("failed to run migration", { index }))
      await Bun.write(path.join(dir, "migration"), (index + 1).toString())
    }
    return { dir }
  }

  function state(): Promise<{ dir: string }> {
    const dir = path.join(Global.Path.data, "storage")
    let existing = states.get(dir)
    if (!existing) {
      existing = initialize(dir)
      states.set(dir, existing)
    }
    return existing
  }

  export async function remove(key: string[]) {
    const dir = await state().then((x) => x.dir)
    const target = resolve(dir, key)
    return withErrorHandling(async () => {
      await fs.unlink(target).catch(() => {})
    })
  }

  export async function dir(): Promise<string> {
    return state().then((x) => x.dir)
  }

  export async function read<T>(key: string[]) {
    const dir = await state().then((x) => x.dir)
    const target = resolve(dir, key)
    return withErrorHandling(async () => {
      using _ = await Lock.read(target)
      const result = await Bun.file(target).json()
      return result as T
    })
  }

  export async function update<T>(key: string[], fn: (draft: T) => void) {
    const dir = await state().then((x) => x.dir)
    const target = resolve(dir, key)
    return withErrorHandling(async () => {
      using _ = await Lock.write(target)
      const content = await Bun.file(target).json()
      fn(content)
      await Bun.write(target, JSON.stringify(content, null, 2))
      return content as T
    })
  }

  export async function write<T>(key: string[], content: T) {
    const dir = await state().then((x) => x.dir)
    const target = resolve(dir, key)
    return withErrorHandling(async () => {
      using _ = await Lock.write(target)
      await Bun.write(target, JSON.stringify(content, null, 2))
    })
  }

  export async function rename(from: string[], to: string[]) {
    const dir = await state().then((x) => x.dir)
    const fromPath = resolve(dir, from)
    const toPath = resolve(dir, to)
    using _ = await Lock.write(toPath)

    // Windows can briefly deny a replace while a file watcher or virus scanner
    // still has the destination open. Coordinate with in-process readers first,
    // then retry only the transient replacement errors. The source remains intact
    // between attempts, so a failed retry never creates a missing canonical file.
    const delays = [10, 25, 50, 100]
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(fromPath, toPath)
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code
        if (!code || !["EACCES", "EBUSY", "EPERM"].includes(code) || attempt >= delays.length) throw error
        await Bun.sleep(delays[attempt])
      }
    }
  }

  async function withErrorHandling<T>(body: () => Promise<T>) {
    return body().catch((e) => {
      if (!(e instanceof Error)) throw e
      const errnoException = e as NodeJS.ErrnoException
      if (errnoException.code === "ENOENT") {
        throw new NotFoundError({ message: `Resource not found: ${errnoException.path}` })
      }
      throw e
    })
  }

  const glob = new Bun.Glob("**/*")
  export async function list(prefix: string[]) {
    const dir = await state().then((x) => x.dir)
    assertKey(prefix)
    try {
      const result = await Array.fromAsync(
        glob.scan({
          cwd: path.join(dir, ...prefix),
          onlyFiles: true,
        }),
      ).then((results) => results.map((x) => [...prefix, ...x.slice(0, -5).split(path.sep)]))
      result.sort()
      return result
    } catch {
      return []
    }
  }
}
