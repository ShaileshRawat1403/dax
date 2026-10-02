import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

/**
 * Stage 4a: what a grant's implementation binding can establish.
 *
 * `exact` means the bound content is the content that executes, protected
 * against substitution between checking and execution. Only the compiled DAX
 * binary is exact: its code is the process image, hashed once at startup.
 *
 * `external` means a reviewed external source: its identity and content are
 * bound as far as DAX can see them, but what actually runs is not attested.
 * Remote MCP servers, source runs of DAX, local plugin files, local MCP
 * executables, worker binaries and verification executables are external. A
 * grant may cover one only with the operator's explicit acknowledgement, and
 * it never counts as exact.
 *
 * Anything outside the supported forms below is unavailable and is never
 * granted: interpreted programs, package launchers, package plugins, modules
 * that import anything beyond runtime builtins, and unresolvable executables.
 * Checks always compare content; nothing is trusted because its size or
 * modification time is unchanged.
 */
export type Attestation = "exact" | "external"

export type BoundFacts = { attestation: Attestation; facts: unknown }

declare global {
  const DAX_BUILD_COMMIT: string
}

function sha256File(file: string): string {
  return `sha256:${createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`
}

/** Streams the file, so hashing a large binary does not hold the event loop. */
async function sha256FileAsync(file: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer)
  return `sha256:${hash.digest("hex")}`
}

/** The compiled binary's own embedded filesystem, as Bun names it per platform. */
function isCompiledBinary() {
  return Bun.main.startsWith("/$bunfs/") || /^[A-Za-z]:[\\/]~BUN[\\/]/.test(Bun.main)
}

export type DaxExecutable =
  | { form: "compiled"; commit: string; digest: string }
  | { form: "development"; commit: string; clean: boolean }
  | { form: "unknown" }

let executable: Promise<DaxExecutable> | undefined

async function computeDaxExecutable(): Promise<DaxExecutable> {
  try {
    if (isCompiledBinary()) {
      const commit = typeof DAX_BUILD_COMMIT === "string" ? DAX_BUILD_COMMIT : ""
      return commit
        ? { form: "compiled", commit, digest: await sha256FileAsync(process.execPath) }
        : { form: "unknown" }
    }
    const cwd = path.dirname(Bun.main)
    const run = async (args: string[]) => {
      const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" })
      const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
      return code === 0 ? text.trim() : undefined
    }
    const [commit, status] = await Promise.all([
      run(["rev-parse", "HEAD"]),
      run(["status", "--porcelain", "--untracked-files=no"]),
    ])
    return commit && status !== undefined ? { form: "development", commit, clean: status === "" } : { form: "unknown" }
  } catch {
    return { form: "unknown" }
  }
}

/**
 * The running DAX implementation, computed once per process. The entry point
 * starts this at startup, so a compiled binary is hashed as it was launched;
 * the running code is that image from then on. A source run is development:
 * the commit and whether the tracked tree was clean, which neither covers
 * dependencies nor attests what was loaded.
 */
export function daxExecutable(): Promise<DaxExecutable> {
  executable ??= computeDaxExecutable()
  return executable
}

/** Bound facts for a DAX-native capability, or undefined when the executable is unknown. */
export function nativeBinding(id: string, current: DaxExecutable): BoundFacts | undefined {
  if (current.form === "unknown") return undefined
  return {
    attestation: current.form === "compiled" ? "exact" : "external",
    facts: { kind: "native", id, executable: current },
  }
}

/** Launchers and interpreters: what they run is chosen by arguments, options or imports. */
const UNSUPPORTED_LAUNCHERS = new Set([
  "node",
  "nodejs",
  "bun",
  "bunx",
  "deno",
  "npx",
  "npm",
  "pnpm",
  "pnpx",
  "yarn",
  "python",
  "python3",
  "pip",
  "pipx",
  "uv",
  "uvx",
  "ruby",
  "perl",
  "php",
  "java",
  "sh",
  "bash",
  "zsh",
  "pwsh",
  "powershell",
  "cmd",
  "env",
])

export type ExecutableFacts =
  | { form: "binary"; path: string; digest: string }
  | { form: "unsupported"; reason: "unresolved" | "launcher" | "script" }

/**
 * A directly launched executable. Supported only when it resolves to a real
 * file that is neither a known launcher nor a script with an interpreter line:
 * for those, the program that actually runs is chosen elsewhere.
 */
export function executableFacts(command: string, cwd?: string): ExecutableFacts {
  const resolved = Bun.which(command, cwd ? { cwd } : undefined)
  if (!resolved) return { form: "unsupported", reason: "unresolved" }
  let real: string
  try {
    real = fs.realpathSync(resolved)
  } catch {
    return { form: "unsupported", reason: "unresolved" }
  }
  const base = path
    .basename(real)
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/, "")
  const named = path
    .basename(command)
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/, "")
  if (UNSUPPORTED_LAUNCHERS.has(base) || UNSUPPORTED_LAUNCHERS.has(named))
    return { form: "unsupported", reason: "launcher" }
  try {
    const head = Buffer.alloc(2)
    const fd = fs.openSync(real, "r")
    try {
      fs.readSync(fd, head, 0, 2, 0)
    } finally {
      fs.closeSync(fd)
    }
    if (head.toString("latin1") === "#!") return { form: "unsupported", reason: "script" }
    return { form: "binary", path: real, digest: sha256File(real) }
  } catch {
    return { form: "unsupported", reason: "unresolved" }
  }
}

/** Builtins a self-contained module may import. */
function isRuntimeBuiltin(specifier: string) {
  return specifier.startsWith("node:") || specifier.startsWith("bun:") || specifier === "bun"
}

export type ModuleFacts =
  | { form: "self_contained"; digest: string }
  | { form: "unsupported"; reason: "imports" | "unreadable" | "changed_during_load" }

/**
 * A local module file, described by the exact bytes given. Supported only when
 * every import is a runtime builtin: anything else would load code this digest
 * does not cover. Dynamic imports and requires must be literal builtins too.
 */
export function moduleFacts(bytes: Uint8Array, file: string): ModuleFacts {
  const source = new TextDecoder().decode(bytes)
  const loader = /\.tsx?$/.test(file) ? (file.endsWith("x") ? "tsx" : "ts") : file.endsWith(".jsx") ? "jsx" : "js"
  let imports: { path: string; kind: string }[]
  try {
    imports = new Bun.Transpiler({ loader }).scanImports(source)
  } catch {
    return { form: "unsupported", reason: "imports" }
  }
  if (imports.some((item) => !isRuntimeBuiltin(item.path))) return { form: "unsupported", reason: "imports" }
  // A computed import() or require() is invisible to the scan above.
  const calls = source.match(/\b(?:import|require)\s*\(/g)?.length ?? 0
  const scannedCalls = imports.filter((item) => item.kind === "dynamic-import" || item.kind === "require-call").length
  if (calls !== scannedCalls) return { form: "unsupported", reason: "imports" }
  return { form: "self_contained", digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` }
}
