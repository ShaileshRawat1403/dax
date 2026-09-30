import { createHash } from "crypto"
import path from "path"
import fs from "fs/promises"
import { fileURLToPath } from "url"
import { Global } from "../global"
import { Log } from "../util/log"
import { NamedError } from "@dax-ai/util/error"

/**
 * Workspace trust for project-scoped configuration.
 *
 * Configuration found below the working directory can name code that DAX will
 * execute: `.dax/plugin/*.ts` is imported and every export called, `plugin`
 * entries are installed from npm and imported, a local `mcp` server is
 * spawned as a child process, and `.dax/tool/*.ts` is imported when tools are
 * discovered. All of that used to happen with no
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
  /**
   * Files under a project's `.dax/tool` and `.dax/tools`, each bound to its
   * content: see `scanProjectTools`. Tool discovery imports these in-process.
   */
  tools: string[]
  /**
   * Set when the project's tool folders could not be read completely. The set
   * of tool files is then unknown, so nothing here can be trusted or approved.
   */
  toolScanFailure?: ToolScanFailure
  /**
   * Files a project plugin import would load, each bound to its content: every
   * file under a project's `.dax/plugin` and `.dax/plugins`, and any other local
   * file a project config names as a plugin. See `scanProjectPlugins`. A
   * `plugins` entry names what to load; this records what it contained.
   */
  pluginFiles: string[]
  /** Set when those plugin files could not be read completely. */
  pluginScanFailure?: ToolScanFailure
}

export type ToolScanFailure = { path: string; code: string }

export type TrustRecord = {
  worktree: string
  digest: string
  trustedAt: number
}

export const empty: Executable = { plugins: [], mcp: [], install: [], tools: [], pluginFiles: [] }

export function isEmpty(value: Executable) {
  return (
    value.plugins.length === 0 &&
    value.mcp.length === 0 &&
    value.install.length === 0 &&
    value.tools.length === 0 &&
    value.toolScanFailure === undefined &&
    value.pluginFiles.length === 0 &&
    value.pluginScanFailure === undefined
  )
}

const TOOL_DIRECTORIES = ["tool", "tools"]
const PLUGIN_DIRECTORIES = ["plugin", "plugins"]

/** One tool-file entry: the path the operator reviews and the content it had. */
function toolEntry(file: string, content: Buffer) {
  return `${file}#sha256:${createHash("sha256").update(content).digest("hex")}`
}

const CONTENT_COMMITMENT = /#sha256:[0-9a-f]{64}$/

/** True only for an entry that binds a path to a real SHA-256 of its content. */
export function isContentCommitment(entry: unknown): entry is string {
  return typeof entry === "string" && CONTENT_COMMITMENT.test(entry)
}

/** Split an entry back into what a report shows. */
export function describeToolEntry(entry: string): { file: string; content: string } {
  const at = entry.lastIndexOf("#sha256:")
  return at < 0 ? { file: entry, content: "" } : { file: entry.slice(0, at), content: entry.slice(at + 8) }
}

/** A project tool folder exists but could not be read completely. */
export class ProjectToolScanError extends Error {
  constructor(public readonly failure: ToolScanFailure) {
    super(`Project tool files could not be scanned: ${failure.code} at ${failure.path}`)
  }
}

function scanFailure(target: string, error: unknown): never {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown"
  throw new ProjectToolScanError({ path: target, code })
}

/**
 * Every file under the given project `.dax` directories' `tool` and `tools`
 * folders, each bound to a SHA-256 of its content.
 *
 * Discovery imports only the top-level `*.js` and `*.ts` files, but a tool can
 * import a sibling helper, so the whole folder is covered: adding, editing or
 * removing any file there changes the set. `node_modules` is skipped, because
 * installing a project's dependencies is a separate trusted item. A file a
 * tool imports from outside these folders is not covered.
 *
 * The result is either the complete inventory or a thrown
 * `ProjectToolScanError`. Only a tool folder that does not exist counts as
 * absent. A folder, entry or file that exists and cannot be resolved, listed,
 * inspected or read is a failure, never an empty or partial inventory: an
 * inventory that silently omitted a file would let that file be imported
 * without ever having been reviewed.
 */
export async function scanProjectTools(directories: readonly string[]): Promise<string[]> {
  return scanFolders(directories, TOOL_DIRECTORIES)
}

async function scanFolders(directories: readonly string[], folderNames: readonly string[]): Promise<string[]> {
  const entries: string[] = []
  const visited = new Set<string>()
  async function walk(folder: string) {
    const real = await fs.realpath(folder).catch((error) => scanFailure(folder, error))
    if (visited.has(real)) return
    visited.add(real)
    const names = await fs.readdir(folder).catch((error) => scanFailure(folder, error))
    for (const name of names.sort()) {
      if (name === "node_modules") continue
      const file = path.join(folder, name)
      // stat follows symlinks: what matters is what an import would load.
      const info = await fs.stat(file).catch((error) => scanFailure(file, error))
      if (info.isDirectory()) {
        await walk(file)
        continue
      }
      if (!info.isFile()) scanFailure(file, { code: "not_a_regular_file" })
      const content = await fs.readFile(file).catch((error) => scanFailure(file, error))
      entries.push(toolEntry(file, content))
    }
  }
  for (const directory of directories) {
    for (const name of folderNames) {
      const folder = path.join(directory, name)
      // lstat reports the link itself, so a dangling link is a failure in walk
      // rather than being mistaken for a folder that is not there.
      const present = await fs.lstat(folder).then(
        () => true,
        (error) => (error?.code === "ENOENT" ? false : scanFailure(folder, error)),
      )
      if (present) await walk(folder)
    }
  }
  return entries.sort()
}

/** The complete inventory, or why it could not be produced. Never partial. */
export async function inspectProjectTools(
  directories: readonly string[],
): Promise<{ tools: string[]; failure?: undefined } | { tools?: undefined; failure: ToolScanFailure }> {
  try {
    return { tools: await scanProjectTools(directories) }
  } catch (error) {
    if (error instanceof ProjectToolScanError) return { failure: error.failure }
    return { failure: { path: directories.join(", "), code: "unknown" } }
  }
}

/**
 * Every local file a project plugin import would load, bound to its content.
 *
 * That is every file under the project `.dax` directories' `plugin` and
 * `plugins` folders, covered whole for the same reason tool folders are, plus
 * each other `file://` specifier the project contributed, such as a relative
 * path in its `plugin` config. A package specifier is not a local file: it
 * stays identified by name and version in `plugins`.
 *
 * A plugin folder that does not exist is absent. A named plugin file that does
 * not exist is a failure, because the project declared it as code to run.
 */
export async function scanProjectPlugins(
  directories: readonly string[],
  specifiers: readonly string[],
): Promise<string[]> {
  const entries = await scanFolders(directories, PLUGIN_DIRECTORIES)
  const covered = new Set(entries.map((entry) => describeToolEntry(entry).file))
  for (const specifier of specifiers) {
    if (!specifier.startsWith("file://")) continue
    let file: string
    try {
      file = fileURLToPath(specifier)
    } catch {
      scanFailure(specifier, { code: "invalid_file_url" })
    }
    if (covered.has(file)) continue
    const info = await fs.stat(file).catch((error) => scanFailure(file, error))
    if (!info.isFile()) scanFailure(file, { code: "not_a_regular_file" })
    const content = await fs.readFile(file).catch((error) => scanFailure(file, error))
    entries.push(toolEntry(file, content))
    covered.add(file)
  }
  return entries.sort()
}

/** The complete plugin-file inventory, or why it could not be produced. */
export async function inspectProjectPlugins(
  directories: readonly string[],
  specifiers: readonly string[],
): Promise<{ files: string[]; failure?: undefined } | { files?: undefined; failure: ToolScanFailure }> {
  try {
    return { files: await scanProjectPlugins(directories, specifiers) }
  } catch (error) {
    if (error instanceof ProjectToolScanError) return { failure: error.failure }
    return { failure: { path: directories.join(", "), code: "unknown" } }
  }
}

/**
 * Content this process has already imported, by file.
 *
 * The runtime caches a module for the life of the process. Once a project file
 * has been imported, importing the same path again returns the cached module,
 * whatever the file now contains. An approval of newer content therefore cannot
 * be honored in this process: the code that would run is the older code. This
 * is process state because the module cache is process state; an instance
 * being disposed and recreated does not clear either.
 */
const loadedContent = new Map<string, string>()

/**
 * Approved project content differs from what this process already imported.
 * Stable and path-free so it can be shown to the operator as it is.
 */
export class ProjectRestartRequiredError extends NamedError.Unknown {
  readonly code = "restart_required"
  constructor(public readonly files: readonly string[]) {
    const message =
      "Project executable files changed after this process loaded them. Restart DAX to run the approved version."
    super({ message })
    this.message = message
  }
}

/** The `tool` and `tools` folders of the given project directories. */
export function projectToolFolders(directories: readonly string[]) {
  return directories.flatMap((directory) => TOOL_DIRECTORIES.map((name) => path.join(directory, name)))
}

/** The `plugin` and `plugins` folders of the given project directories. */
export function projectPluginFolders(directories: readonly string[]) {
  return directories.flatMap((directory) => PLUGIN_DIRECTORIES.map((name) => path.join(directory, name)))
}

/**
 * Refuse to import approved content over content this process already loaded.
 *
 * Every file in the inventory is compared, not only the entry modules: a tool
 * imports its helpers, and re-importing a changed entry would still run its
 * cached helpers. A file this process loaded that is now gone from one of the
 * given folders counts too, since a cached module may still import it. Files
 * never loaded here, including ones added since, import fresh and are fine.
 */
export function requireNotStale(entries: readonly string[], folders: readonly string[]) {
  if (entries.length === 0) return
  const current = new Map(entries.map((entry) => [describeToolEntry(entry).file, describeToolEntry(entry).content]))
  const stale: string[] = []
  for (const [file, content] of loadedContent) {
    const now = current.get(file)
    if (now !== undefined) {
      if (now !== content) stale.push(file)
    } else if (folders.some((folder) => file.startsWith(folder + path.sep))) {
      stale.push(file)
    }
  }
  if (stale.length > 0) throw new ProjectRestartRequiredError(stale.sort())
}

/** Record that this process is about to import exactly this content. */
export function markLoaded(entries: readonly string[]) {
  for (const entry of entries) {
    const { file, content } = describeToolEntry(entry)
    loadedContent.set(file, content)
  }
}

/** True when two scans name the same files with the same content. */
export function sameTools(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((entry, index) => entry === b[index])
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

/**
 * Stable digest of what the operator is being asked to trust.
 *
 * Compatibility with records written before file content was covered: when a
 * worktree has no project tool files and no local project plugin files, the
 * canonical form is exactly the earlier three-field form, so its existing
 * record stays valid. When it has either, their content enters the digest, no
 * earlier record can match, and the whole set is withheld until the operator
 * reviews it again. An earlier record never approved a tool file, and approved
 * a plugin file only by its path, so it is not read as approving content.
 */
export function digest(value: Executable): string {
  const canonical = JSON.stringify({
    plugins: [...value.plugins].sort(),
    mcp: [...value.mcp].sort(),
    install: [...value.install].sort(),
    ...(value.tools.length > 0 ? { tools: [...value.tools].sort() } : {}),
    ...(value.pluginFiles.length > 0 ? { pluginFiles: [...value.pluginFiles].sort() } : {}),
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
  if (!isApprovable(value)) return false
  const record = await read(worktree)
  if (!record) return false
  return record.digest === digest(value)
}

/**
 * An approval must name exactly what it approves. A set whose tool folders
 * could not be read, or that carries a tool entry without a real content
 * digest, names nothing the operator could have reviewed.
 */
export function isApprovable(value: Executable): boolean {
  return (
    value.toolScanFailure === undefined &&
    value.pluginScanFailure === undefined &&
    value.tools.every(isContentCommitment) &&
    value.pluginFiles.every(isContentCommitment)
  )
}

export async function trust(worktree: string, value: Executable): Promise<TrustRecord> {
  if (!isApprovable(value)) {
    const failure = value.toolScanFailure ?? value.pluginScanFailure
    throw new Error(
      failure
        ? `Cannot trust ${path.resolve(worktree)}: its executable files could not be read (${failure.code} at ${failure.path})`
        : `Cannot trust ${path.resolve(worktree)}: an executable file has no content digest`,
    )
  }
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

/**
 * Tool discovery found project tool files it may not import: the worktree is
 * untrusted, or the files differ from what was approved when config loaded.
 * Keep the report current so `dax trust` shows the set that would be approved.
 */
export function noteWithheldTools(tools: readonly string[]) {
  const { toolScanFailure: _cleared, ...rest } = withheld
  withheld = { ...rest, tools: [...tools] }
}

/** Tool discovery could not read the project's tool folders; nothing was imported. */
export function noteWithheldToolScanFailure(failure: ToolScanFailure) {
  withheld = { ...withheld, tools: [], toolScanFailure: failure }
}

/**
 * Plugin loading found the project's plugin files differ from what was approved
 * when config loaded, so it did not import the project's plugins.
 */
export function noteWithheldPlugins(specifiers: readonly string[], files: readonly string[]) {
  const { pluginScanFailure: _cleared, ...rest } = withheld
  withheld = { ...rest, plugins: [...specifiers], pluginFiles: [...files] }
}

/** Plugin loading could not read the project's plugin files; none were imported. */
export function noteWithheldPluginScanFailure(specifiers: readonly string[], failure: ToolScanFailure) {
  withheld = { ...withheld, plugins: [...specifiers], pluginFiles: [], pluginScanFailure: failure }
}
