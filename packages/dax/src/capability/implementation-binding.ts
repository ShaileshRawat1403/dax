import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

/**
 * Stage 4a: what a grant's implementation binding can establish.
 *
 * `exact`: the bound content is the code that runs. Only a compiled DAX binary
 * qualifies, and only through its running image: the embedded bundle is read
 * from the process's own memory, so replacing the file on disk changes nothing
 * the binding describes. The native runtime is identified by the revision
 * compiled into it.
 *
 * `external`: a reviewed external source whose implementation DAX cannot see.
 * This is a narrow exception for remote MCP servers, granted only with the
 * operator's explicit acknowledgement, and never counted as exact.
 *
 * Everything else has no supported form and cannot be bound or granted: a
 * source run of DAX, plugin and loader modules (their dependency closure cannot
 * be established without analysing JavaScript), local MCP servers, worker
 * CLIs and verification commands (a launched program's behaviour depends on
 * what it loads, and nothing yet protects it between check and launch).
 * Launched executables are still described by content, so a reviewer sees
 * exactly what would start, but the description authorizes nothing.
 */
export type Attestation = "exact" | "external"

export type BoundFacts = { attestation: Attestation; facts: unknown }

declare global {
  const DAX_BUILD_COMMIT: string
}

/** The compiled binary's embedded filesystem root, as Bun names it per platform. */
function embeddedRoot(): string | undefined {
  const main = Bun.main
  if (main.startsWith("/$bunfs/")) return path.posix.dirname(main)
  if (/^[A-Za-z]:[\\/]~BUN[\\/]/.test(main)) return path.win32.dirname(main)
  return undefined
}

/** Every embedded file by name, length and content, in a fixed order. */
function digestTree(root: string): string {
  const hash = createHash("sha256")
  const walk = (dir: string, prefix: string) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name)
      const relative = prefix ? `${prefix}/${name}` : name
      if (fs.statSync(full).isDirectory()) {
        walk(full, relative)
        continue
      }
      const bytes = fs.readFileSync(full)
      hash.update(`${relative}\0${bytes.length}\0`).update(bytes)
    }
  }
  walk(root, "")
  return `sha256:${hash.digest("hex")}`
}

export type DaxExecutable =
  | { form: "compiled"; commit: string; runtime: string; bundle: string }
  | { form: "development" }
  | { form: "unknown" }

let executable: DaxExecutable | undefined

/**
 * The running DAX implementation. For a compiled binary, the digest of the
 * bundle embedded in the running image and the runtime revision built into it.
 * A source run is development and is never bound: its loaded modules and
 * dependencies are not established by any digest available here.
 */
export function daxExecutable(): DaxExecutable {
  if (executable) return executable
  try {
    const root = embeddedRoot()
    if (!root) {
      executable = { form: "development" }
      return executable
    }
    const commit = typeof DAX_BUILD_COMMIT === "string" ? DAX_BUILD_COMMIT : ""
    executable = commit
      ? { form: "compiled", commit, runtime: Bun.revision, bundle: digestTree(root) }
      : { form: "unknown" }
  } catch {
    executable = { form: "unknown" }
  }
  return executable
}

/** Bound facts for a DAX-native capability: exact for a compiled binary, otherwise none. */
export function nativeBinding(id: string, current: DaxExecutable): BoundFacts | undefined {
  if (current.form !== "compiled") return undefined
  return { attestation: "exact", facts: { kind: "native", id, executable: current } }
}

export type ExecutableFacts =
  | {
      form: "described"
      /** The absolute path the launch starts, as resolved. */
      path: string
      /** The file that path leads to, and its content. */
      target: string
      digest: string
    }
  | { form: "unresolved" }

/**
 * Describes the executable a launch would start, by content, resolving the
 * command exactly as the launch does: with the launch's own PATH and working
 * directory. A description is not a binding; no launched program has a
 * supported form yet.
 */
export function executableFacts(command: string, launch?: { PATH?: string; cwd?: string }): ExecutableFacts {
  const resolved = /[\\/]/.test(command)
    ? path.resolve(launch?.cwd ?? process.cwd(), command)
    : Bun.which(command, {
        ...(launch?.PATH !== undefined ? { PATH: launch.PATH } : {}),
        ...(launch?.cwd ? { cwd: launch.cwd } : {}),
      })
  if (!resolved) return { form: "unresolved" }
  try {
    const real = fs.realpathSync(resolved)
    if (!fs.statSync(real).isFile()) return { form: "unresolved" }
    const digest = `sha256:${createHash("sha256").update(fs.readFileSync(real)).digest("hex")}`
    return { form: "described", path: resolved, target: real, digest }
  } catch {
    return { form: "unresolved" }
  }
}
