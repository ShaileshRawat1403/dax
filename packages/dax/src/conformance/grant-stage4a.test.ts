import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { mcpCapability, pluginCapability } from "@/capability/dynamic-identity"
import {
  matchesReviewedVerification,
  proposeGrants,
  type ReviewCatalogSnapshot,
  type ReviewToolEntry,
} from "@/capability/grant-proposal"
import { captureReviewSnapshot } from "@/capability/grant-review-snapshot"
import { daxExecutable, executableFacts, nativeBinding } from "@/capability/implementation-binding"
import { nativeCapabilities } from "@/capability/registry"
import { Config } from "@/config/config"
import { compileWithRunId } from "@/execution/compiler"
import type { ExecutionContract } from "@/execution/execution-contract"
import { MCP } from "@/mcp"
import { Instance } from "@/project/instance"
import { runCheck } from "@/sdlc/check-runner"
import { CheckDefinition } from "@/sdlc/check-types"
import { bindVerificationCommand, describeVerificationDispatch } from "@/sdlc/verification-identity"
import { runSandboxedWorkerCheck } from "@/worker/worker-sandbox"

/**
 * Grant stage 4a: implementation bindings and verification selection.
 *
 * Exact binding exists only for a compiled DAX binary, from its running image.
 * The one external exception is a remote MCP server the operator acknowledged.
 * Every other implementation (a source run, plugin and loader modules, local
 * MCP servers, workers, verification commands) has no supported form and is
 * never granted. Launched executables are described by content, resolved as
 * the launch resolves them. Nothing here is enforced: the stage 3 barrier
 * still holds every reviewed run.
 */

let home: string
let directory: string
let previousHome: string | undefined

beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "dax-grant-stage4a-")))
  process.env.DAX_TEST_HOME = home
  directory = path.join(home, "project")
  await fs.mkdir(path.join(directory, "sub"), { recursive: true })
  await fs.mkdir(path.join(home, ".config", "dax", "tool"), { recursive: true })
  expect(Bun.spawnSync(["git", "init", "--quiet", directory]).exitCode).toBe(0)
  await Instance.disposeAll()
  Config.global.reset()
})
afterEach(async () => {
  await Instance.disposeAll()
  Config.global.reset()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await fs.rm(home, { recursive: true, force: true })
})

const within = <T>(fn: () => Promise<T>) => Instance.provide({ directory, fn })
const digest = (bytes: Uint8Array | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`
const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name)

/** Compiles a standalone program with this toolchain, as a release build does. */
async function compile(source: string, outfile: string, define: Record<string, string> = {}) {
  const entry = `${outfile}.ts`
  await fs.writeFile(entry, source)
  const args = Object.entries(define).flatMap(([key, value]) => ["--define", `${key}=${value}`])
  const proc = Bun.spawn([process.execPath, "build", "--compile", ...args, entry, "--outfile", outfile], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, , stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (code !== 0) throw new Error(stderr)
  return process.platform === "win32" && !outfile.endsWith(".exe") ? `${outfile}.exe` : outfile
}

/** Rewrites a file with different bytes of the same length and fixed timestamps. */
async function sameSizeEdit(file: string, from: string, to: string) {
  expect(to.length).toBe(from.length)
  const fixed = new Date("2026-01-01T00:00:00Z")
  await fs.utimes(file, fixed, fixed)
  const stat = await fs.stat(file)
  const bytes = await fs.readFile(file)
  await fs.writeFile(file, Buffer.from(bytes.toString("latin1").replace(from, to), "latin1"))
  await fs.utimes(file, fixed, fixed)
  const after = await fs.stat(file)
  expect(after.size).toBe(stat.size)
  expect(after.mtimeMs).toBe(stat.mtimeMs)
}

describe("exact binding is the compiled binary's running image", () => {
  test("replacing the binary on disk does not change what the running process binds", async () => {
    const binding = path.resolve(import.meta.dir, "../capability/implementation-binding.ts")
    const program = (marker: string) => `
import { existsSync } from "node:fs"
import { daxExecutable } from ${JSON.stringify(binding)}
const MARKER = ${JSON.stringify(marker)}
const go = process.argv[2]
if (go) while (!existsSync(go)) await Bun.sleep(25)
console.log(JSON.stringify({ marker: MARKER, executable: daxExecutable() }))
`
    const define = { DAX_BUILD_COMMIT: '"probe-commit"' }
    const a = await compile(program("ORIGINAL-A"), path.join(home, "probe-a"), define)
    const b = await compile(program("REPLACED-B"), path.join(home, "probe-b"), define)
    const run = async (file: string, go?: string) => {
      const proc = Bun.spawn([file, ...(go ? [go] : [])], { stdout: "pipe", stderr: "pipe" })
      return proc
    }
    const report = async (proc: Bun.Subprocess<"ignore", "pipe", "pipe">) => {
      const [code, out, err] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      if (code !== 0) throw new Error(err)
      return JSON.parse(out.trim()) as {
        marker: string
        executable: { form: string; bundle?: string; runtime?: string }
      }
    }
    const original = await report(await run(a))
    const replacement = await report(await run(b))
    expect(original.executable.form).toBe("compiled")
    expect(original.executable.runtime).toBe(Bun.revision)
    expect(replacement.executable.bundle).not.toBe(original.executable.bundle)

    // Start A, replace its file with B, then let it bind.
    const go = path.join(home, "go")
    const running = await run(a, go)
    await Bun.sleep(300)
    await fs.rename(a, `${a}.old`)
    await fs.copyFile(b, a)
    await fs.writeFile(go, "")
    const result = await report(running)
    expect(result.marker).toBe("ORIGINAL-A")
    expect(result.executable.bundle).toBe(original.executable.bundle)
    expect(digest(await fs.readFile(a))).toBe(digest(await fs.readFile(b)))
  }, 120_000)

  test("a source run is development and binds nothing natively", () => {
    expect(daxExecutable()).toEqual({ form: "development" })
    expect(nativeBinding("native.tool.shell", daxExecutable())).toBeUndefined()
    expect(nativeBinding("native.tool.shell", { form: "unknown" })).toBeUndefined()
    expect(
      nativeBinding("native.tool.shell", { form: "compiled", commit: "c", runtime: "r", bundle: "sha256:b" })
        ?.attestation,
    ).toBe("exact")
  })
})

describe("nothing without a supported form is granted, acknowledged or not", () => {
  test("plugins, local MCP, workers, verification and development builds are unbindable; only remote MCP is external", async () => {
    const snap = snapshot((value) => {
      value.tools.push(mcpTool("local", "probe"), mcpTool("remote", "probe"))
      value.mcpServers.local = {
        type: "local",
        command: ["server"],
        environment: [],
        executable: { form: "described", path: "/bin/server", target: "/bin/server", digest: digest("server") },
      }
      value.mcpServers.remote = { type: "remote", url: "https://remote.invalid/mcp", headers: [] }
      value.worker = {
        descriptor: {
          id: "worker.profile.codex",
          riskClass: "high",
          scopeSupport: "opaque",
          requiresVerification: true,
        },
        facts: {
          profile: "codex",
          executable: { form: "described", path: "/bin/codex", target: "/bin/codex", digest: digest("codex") },
        },
      }
      value.verification = {
        descriptor: {
          id: "verification.command.direct",
          riskClass: "high",
          scopeSupport: "opaque",
          requiresVerification: false,
        },
        runner: "direct",
        cwd: ".",
        commands: [
          {
            argv: ["/bin/check"],
            executable: { form: "described", path: "/bin/check", target: "/bin/check", digest: digest("check") },
          },
        ],
      }
    })
    const lint = pluginCapability(["directory", "/plugins/lint.js", "default"]).descriptor.id
    const local = mcpCapability(["mcp", "local", "probe"]).descriptor.id
    const remote = mcpCapability(["mcp", "remote", "probe"]).descriptor.id
    const everything = [lint, local, remote, "worker.profile.codex", "verification.command.direct"]

    const acknowledged = await propose(contract(), snap, everything)
    expect(acknowledged.unbindable.map((item) => item.capabilityId)).toEqual(
      expect.arrayContaining([lint, local, "worker.profile.codex", "verification.command.direct"]),
    )
    const granted = acknowledged.candidate.capabilityGrants.map((grant) =>
      grant.subject.kind === "capability" ? grant.subject.capabilityId : "",
    )
    expect(granted).toEqual(expect.arrayContaining(["native.tool.shell", remote]))
    for (const id of [lint, local, "worker.profile.codex", "verification.command.direct"])
      expect(granted).not.toContain(id)
    expect(acknowledged.bindings.find((item) => item.subject === remote)?.attestation).toBe("external")
    expect(acknowledged.bindings.find((item) => item.subject === "native.tool.shell")?.attestation).toBe("exact")

    // Without acknowledgement, the remote server waits for it; native stays exact.
    const silent = await propose(contract(), snap, [])
    expect(silent.needsTrust.map((item) => item.capabilityId)).toEqual([remote])

    // A development build binds no native capability, and acknowledging one changes nothing.
    const development = await propose(
      contract(),
      snapshot((value) => {
        value.daxExecutable = { form: "development" }
      }),
      ["native.tool.shell"],
    )
    expect(development.unbindable.map((item) => item.capabilityId)).toContain("native.tool.shell")
    expect(development.candidate.capabilityGrants).toEqual([])

    // A source selector reaches only a remote server.
    const selected = await proposeGrants({
      runId: contract().runId,
      contract: contract(),
      snapshot: snap,
      inputs: {
        toolAllowlist: [],
        toolBlocklist: [],
        workflowClass: "generic",
        acknowledgedExternal: ["mcp_source:resource:remote", "mcp_source:resource:local"],
        sourceSelections: [
          { server: "remote", family: "resource" },
          { server: "local", family: "resource" },
        ],
      },
    })
    expect(selected.unbindable).toContainEqual({ capabilityId: "mcp_source:resource:local" })
    // A selection the operator did not also acknowledge waits for it.
    const unacknowledged = await proposeGrants({
      runId: contract().runId,
      contract: contract(),
      snapshot: snap,
      inputs: {
        toolAllowlist: [],
        toolBlocklist: [],
        workflowClass: "generic",
        sourceSelections: [{ server: "remote", family: "resource" }],
      },
    })
    expect(unacknowledged.needsTrust).toContainEqual({ capabilityId: "mcp_source:resource:remote" })
    expect(unacknowledged.candidate.capabilityGrants.some((grant) => grant.subject.kind === "mcp_source")).toBe(false)
    expect(selected.candidate.capabilityGrants).toContainEqual({
      subject: { kind: "mcp_source", server: "remote", family: "resource" },
      decision: "allow",
      scope: { kind: "run" },
      acknowledgesExternalTrust: true,
    })
  })

  test("a loader module with hidden dependencies, or one cached before discovery, is never bound", async () => {
    const folder = path.join(home, ".config", "dax", "tool")
    await fs.writeFile(path.join(home, "helper.cjs"), `module.exports = "uncommitted helper"`)
    await fs.writeFile(
      path.join(folder, "hidden.js"),
      `import { createRequire } from "node:module"
const load = createRequire(${JSON.stringify(path.join(home, "anchor.js"))})
export default { description: load(${JSON.stringify(path.join(home, "helper.cjs"))}), args: {}, async execute() { return "x" } }`,
    )
    const cached = path.join(folder, "cachedprobe.js")
    await fs.writeFile(cached, `export default { description: "probe", args: {}, async execute() { return "ONE" } }`)
    await import(cached)
    await fs.writeFile(cached, `export default { description: "probe", args: {}, async execute() { return "TWO" } }`)
    await within(async () => {
      const snap = await captureReviewSnapshot({ workflowClass: "generic" })
      const ids = snap.tools.flatMap((item) => (item.family === "plugin" ? [item.descriptor.id] : []))
      expect(
        snap.tools
          .filter((item) => item.family === "plugin")
          .map((item) => item.alias)
          .sort(),
      ).toEqual(["cachedprobe", "hidden"])
      const compiled = contract()
      const proposal = await propose(
        compiled,
        { ...snap, daxExecutable: { form: "compiled", commit: "c", runtime: "r", bundle: "sha256:b" } },
        ids,
      )
      expect(proposal.unbindable.map((item) => item.capabilityId)).toEqual(expect.arrayContaining(ids))
      expect(proposal.bindings.some((item) => ids.includes(item.subject))).toBe(false)
    })
  })
})

describe("launched executables are described by content, as the launch resolves them", () => {
  test("a same-size edit with its timestamps restored changes the description", async () => {
    const file = path.join(home, exe("probe-tool"))
    await fs.writeFile(file, "binary-v1")
    await fs.chmod(file, 0o755)
    const before = executableFacts(file)
    await sameSizeEdit(file, "binary-v1", "binary-v2")
    const after = executableFacts(file)
    expect(before.form).toBe("described")
    expect(after.form).toBe("described")
    if (before.form !== "described" || after.form !== "described") return
    expect(after.digest).not.toBe(before.digest)
    expect(after.digest).toBe(digest(await fs.readFile(file)))
  })

  test("a local MCP server starts, and is described as, the executable its configured PATH selects", async () => {
    const ambient = path.join(home, "ambient")
    const configured = path.join(home, "configured")
    await fs.mkdir(ambient)
    await fs.mkdir(configured)
    const name = "stage4a-mcp"
    const server = (marker: string) => `
import { createInterface } from "node:readline"
await Bun.write(${JSON.stringify(path.join(home, "started-"))} + ${JSON.stringify(marker)}, process.argv0)
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line)
  if (request.id === undefined) continue
  const result = request.method === "initialize"
    ? { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: ${JSON.stringify(marker)}, version: "1" } }
    : request.method === "tools/list" ? { tools: [{ name: "probe", description: ${JSON.stringify(marker)}, inputSchema: { type: "object", properties: {} } }] } : {}
  console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }))
}`
    await compile(server("ambient"), path.join(ambient, name))
    const selected = await compile(server("configured"), path.join(configured, name))
    const previousPath = process.env.PATH
    process.env.PATH = `${ambient}${path.delimiter}${previousPath}`
    await fs.writeFile(
      path.join(home, ".config", "dax", "dax.json"),
      JSON.stringify({
        mcp: {
          probe: {
            type: "local",
            command: [name],
            environment: { PATH: `${configured}${path.delimiter}${previousPath}` },
          },
        },
      }),
    )
    try {
      await within(async () => {
        const snap = await captureReviewSnapshot({ workflowClass: "generic" })
        expect(snap.tools.filter((item) => item.family === "mcp_tool")).toHaveLength(1)
        const material = snap.mcpServers.probe
        expect(material?.type).toBe("local")
        if (material?.type !== "local") return
        expect(material.executable).toEqual(executableFacts(selected))
        expect(MCP.launchFacts("probe")).toEqual(material.executable)
        // The transport started the very path that was described, not a name it resolved again.
        expect(material.executable.form).toBe("described")
        if (material.executable.form !== "described") return
        expect(await Bun.file(path.join(home, "started-configured")).text()).toBe(material.executable.path)
        expect(await Bun.file(path.join(home, "started-ambient")).exists()).toBe(false)
      })
    } finally {
      process.env.PATH = previousPath
    }
  }, 60_000)
})

describe("verification binds the runner that dispatches, the argument vector, the directory and the executable", () => {
  function check(command: string, args: string[], cwd: string) {
    return CheckDefinition.parse({ id: "probe", kind: "test", label: "probe", command, args, cwd })
  }

  test("the plan proposes a runner by workflow; only a genuine dispatch establishes it", async () => {
    const tool = path.join(home, exe("probe-tool"))
    await fs.writeFile(tool, "binary-v1")
    await fs.chmod(tool, 0o755)
    const planned = (workflowClass: string) =>
      ({
        workflowClass,
        runtimePolicy: { postconditions: { validationCommands: [`${tool} --check`] } },
      }) as unknown as Pick<ExecutionContract, "workflowClass" | "providerHint" | "runtimePolicy">
    await within(async () => {
      const direct = (await captureReviewSnapshot(planned("generic"))).verification!
      expect(direct.runner).toBe("direct")
      expect(direct.descriptor.id).toBe("verification.command.direct")
      expect(direct.cwd).toBe(".")
      expect(direct.commands).toEqual([{ argv: [tool, "--check"], executable: executableFacts(tool) }])
      expect((await captureReviewSnapshot(planned("worker_run"))).verification?.runner).toBe("sandboxed")

      const dispatched = (
        args: string[],
        cwd = directory,
        runner: "direct" | "sandboxed" = "direct",
        executor: object = runCheck,
      ) =>
        describeVerificationDispatch(
          bindVerificationCommand({ runner, check: check(tool, args, cwd), executor }),
          Instance.worktree,
        )

      const genuine = dispatched(["--check"])
      expect(genuine).toEqual({
        runner: "direct",
        argv: [tool, "--check"],
        cwd: ".",
        executable: executableFacts(tool),
      })
      expect(matchesReviewedVerification(direct, genuine!)).toBe(true)
      expect(matchesReviewedVerification(direct, dispatched(["--fix"])!)).toBe(false)
      expect(matchesReviewedVerification(direct, dispatched(["--check"], path.join(directory, "sub"))!)).toBe(false)
      expect(
        matchesReviewedVerification(direct, dispatched(["--check"], directory, "sandboxed", runSandboxedWorkerCheck)!),
      ).toBe(false)
      // A runner name that does not match the genuine dispatch function establishes nothing.
      expect(dispatched(["--check"], directory, "sandboxed", runCheck)).toBeUndefined()
      expect(dispatched(["--check"], directory, "direct", async () => undefined)).toBeUndefined()
      expect(dispatched(["--check"], home)).toBeUndefined()

      await sameSizeEdit(tool, "binary-v1", "binary-v2")
      expect(matchesReviewedVerification(direct, dispatched(["--check"])!)).toBe(false)

      // Described, matched, and still not grantable: a launched program has no supported form yet.
      const proposal = await propose(contract(), { ...snapshot(), verification: direct }, [
        "verification.command.direct",
      ])
      expect(proposal.unbindable.map((item) => item.capabilityId)).toContain("verification.command.direct")
    })
  })
})

// ---- synthetic catalog -------------------------------------------------------

function contract(): ExecutionContract {
  const { contract } = compileWithRunId({ request: { intent: { input: "Inspect source." } } }, "ses_grant_stage4a")
  contract.toolAllowlist = []
  contract.toolBlocklist = []
  return contract
}

function mcpTool(server: string, name: string): ReviewToolEntry {
  return {
    family: "mcp_tool",
    alias: `${server}_${name}`,
    descriptor: mcpCapability(["mcp", server, name]).descriptor,
    server,
    name,
    definition: "d1",
  }
}

type MutableSnapshot = ReviewCatalogSnapshot & {
  tools: ReviewToolEntry[]
  mcpServers: Record<string, ReviewCatalogSnapshot["mcpServers"][string]>
}

function snapshot(change?: (value: MutableSnapshot) => void): ReviewCatalogSnapshot {
  const { descriptor, source } = pluginCapability(["directory", "/plugins/lint.js", "default"])
  const value: MutableSnapshot = {
    daxExecutable: { form: "compiled", commit: "c0ffee", runtime: "r1", bundle: `sha256:${"d".repeat(64)}` },
    tools: [
      { family: "native", alias: "shell", descriptor: nativeCapabilities.require("native.tool.shell") },
      { family: "plugin", alias: "lint", descriptor, source, metadata: "m1" },
    ],
    mcpServers: {},
    session: [],
    workflow: [],
  }
  change?.(value)
  return value
}

function propose(value: ExecutionContract, snap: ReviewCatalogSnapshot, acknowledgedExternal: readonly string[]) {
  return proposeGrants({
    runId: value.runId,
    contract: value,
    snapshot: snap,
    inputs: {
      toolAllowlist: value.toolAllowlist,
      toolBlocklist: value.toolBlocklist,
      workflowClass: value.workflowClass,
      acknowledgedExternal,
    },
  })
}
