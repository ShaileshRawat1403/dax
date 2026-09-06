import { createHash } from "crypto"
import path from "path"
import fs from "fs/promises"
import { Global } from "../global"
import { Log } from "../util/log"

/**
 * Workspace trust for project-scoped configuration.
 *
 * Configuration found below the working directory can name code that DAX will
 * execute: `.dax/plugin/*.ts` is imported and every export called, `plugin`
 * entries are installed from npm and imported, and a local `mcp` server is
 * spawned as a child process. All of that used to happen on startup with no
 * prompt, so cloning a repository and running `dax` inside it was arbitrary
 * code execution with the operator's full authority.
 *
 * Executable project configuration is now withheld until the operator trusts
 * the worktree, and the decision is bound to a digest of exactly what was
 * withheld. Add a plugin to a trusted repo and the digest changes, so the
 * decision is asked for again rather than silently inherited.
 */
const log = Log.create({ service: "project-trust" })

export type Executable = {
  /** Plugin specifiers - `file://` URLs and npm packages - from project config. */
  plugins: string[]
  /** Names of local (process-spawning) MCP servers declared by project config. */
  mcp: string[]
  /** Directories whose dependencies would be installed with `bun install`. */
  install: string[]
}

export type TrustRecord = {
  worktree: string
  digest: string
  trustedAt: number
}

export const empty: Executable = { plugins: [], mcp: [], install: [] }

export function isEmpty(value: Executable) {
  return value.plugins.length === 0 && value.mcp.length === 0 && value.install.length === 0
}

/**
 * The unit trust is granted to. `Instance.worktree` is the filesystem root for
 * a directory that is not inside a repository, and a record keyed on "/" would
 * trust every such directory at once, so fall back to the directory itself.
 */
export function root(worktree: string, directory: string): string {
  const resolved = path.resolve(worktree)
  return resolved === path.parse(resolved).root ? path.resolve(directory) : resolved
}

/** Stable digest of what the operator is being asked to trust. */
export function digest(value: Executable): string {
  const canonical = JSON.stringify({
    plugins: [...value.plugins].sort(),
    mcp: [...value.mcp].sort(),
    install: [...value.install].sort(),
  })
  return createHash("sha256").update(canonical).digest("hex")
}

function recordPath(worktree: string) {
  const key = createHash("sha256").update(path.resolve(worktree)).digest("hex").slice(0, 32)
  return path.join(Global.Path.data, "trust", `${key}.json`)
}

async function read(worktree: string): Promise<TrustRecord | undefined> {
  return Bun.file(recordPath(worktree))
    .json()
    .then((x) => x as TrustRecord)
    .catch(() => undefined)
}

/** True when this exact set of executable configuration was already trusted. */
export async function isTrusted(worktree: string, value: Executable): Promise<boolean> {
  if (isEmpty(value)) return true
  const record = await read(worktree)
  if (!record) return false
  return record.digest === digest(value)
}

export async function trust(worktree: string, value: Executable): Promise<TrustRecord> {
  const record: TrustRecord = {
    worktree: path.resolve(worktree),
    digest: digest(value),
    trustedAt: Date.now(),
  }
  const target = recordPath(worktree)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await Bun.write(target, JSON.stringify(record, null, 2))
  log.info("worktree trusted", { worktree: record.worktree, digest: record.digest })
  return record
}

export async function revoke(worktree: string): Promise<void> {
  await fs.unlink(recordPath(worktree)).catch(() => {})
  log.info("worktree trust revoked", { worktree: path.resolve(worktree) })
}

export async function status(worktree: string) {
  return read(worktree)
}

/**
 * What the current session withheld, for the CLI and the interface to report.
 * Populated during config load; empty when the worktree is trusted.
 */
let withheld: Executable = empty

export function setWithheld(value: Executable) {
  withheld = value
}

export function getWithheld(): Executable {
  return withheld
}
