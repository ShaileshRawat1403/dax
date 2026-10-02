import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { mcpCapability, pluginCapability } from "@/capability/dynamic-identity"
import {
  checkBinding,
  matchesReviewedVerification,
  proposeGrants,
  type ReviewCatalogSnapshot,
  type ReviewToolEntry,
} from "@/capability/grant-proposal"
import { captureReviewSnapshot } from "@/capability/grant-review-snapshot"
import { daxExecutable, executableFacts, moduleFacts } from "@/capability/implementation-binding"
import { nativeCapabilities } from "@/capability/registry"
import { Config } from "@/config/config"
import { compileWithRunId } from "@/execution/compiler"
import type { ExecutionContract } from "@/execution/execution-contract"
import { Instance } from "@/project/instance"
import { runCheck } from "@/sdlc/check-runner"
import { CheckDefinition } from "@/sdlc/check-types"
import { bindVerificationCommand, describeVerificationDispatch } from "@/sdlc/verification-identity"
import { ToolRegistry } from "@/tool/registry"
import { runSandboxedWorkerCheck } from "@/worker/worker-sandbox"

/**
 * Grant stage 4a: implementation bindings and verification selection.
 *
 * Only the compiled DAX binary is bound exactly. Everything else DAX can see is
 * a reviewed external source, granted only with the operator's acknowledgement,
 * or has no supported form and is never granted. Bindings compare content,
 * never size or modification time. Nothing here is enforced: the stage 3
 * barrier still holds every reviewed run.
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
  await fs.mkdir(path.join(home, ".config", "dax"), { recursive: true })
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

/** A directly launchable file that is not a script: what a supported executable looks like. */
async function binary(name: string, content = "binary-v1") {
  const file = path.join(home, process.platform === "win32" ? `${name}.exe` : name)
  await fs.writeFile(file, Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from(content)]))
  await fs.chmod(file, 0o755)
  return file
}

/** Rewrites a file with different bytes of the same length and puts its timestamps back. */
async function sameSizeEdit(file: string, from: string, to: string) {
  expect(to.length).toBe(from.length)
  // Whole seconds, which every filesystem here stores exactly.
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

describe("bindings compare content, never size or modification time", () => {
  test("a same-size edit to an executable with its timestamps restored changes its binding", async () => {
    const file = await binary("probe-tool")
    const before = executableFacts(file)
    expect(before.form).toBe("binary")
    await sameSizeEdit(file, "binary-v1", "binary-v2")
    const after = executableFacts(file)
    expect(after.form).toBe("binary")
    if (before.form !== "binary" || after.form !== "binary") return
    expect(after.digest).not.toBe(before.digest)
    expect(after.digest).toBe(digest(await fs.readFile(file)))
  })

  test("a loader module is bound as this process loaded it, not as the file now reads", async () => {
    const folder = path.join(home, ".config", "dax", "tool")
    await fs.mkdir(folder, { recursive: true })
    const file = path.join(folder, "probe.js")
    const original = `export default { description: "v1", args: {}, async execute() { return "one" } }`
    await fs.writeFile(file, original)
    await within(async () => {
      await captureReviewSnapshot({ workflowClass: "generic" })
      expect(await ToolRegistry.loadedModule(file)).toEqual({ form: "self_contained", digest: digest(original) })
      // The loaded code is unchanged by a same-size edit with restored timestamps,
      // and the binding keeps describing it rather than the new bytes.
      await sameSizeEdit(file, `return "one"`, `return "two"`)
      const recaptured = await captureReviewSnapshot({ workflowClass: "generic" })
      const probe = recaptured.tools.find((item) => item.alias === "probe")
      expect(probe?.family).toBe("plugin")
      if (probe?.family !== "plugin") return
      expect(probe.module).toEqual({ form: "self_contained", digest: digest(original) })
      expect(digest(await fs.readFile(file))).not.toBe(digest(original))
    })
  })

  test("a same-size change to bound module content is a changed binding", async () => {
    const snap = snapshot()
    const proposal = await propose(contract(), snap, externalIds(snap))
    const lintId = pluginCapability(["directory", "/plugins/lint.js", "default"]).descriptor.id
    const index = proposal.candidate.capabilityGrants.findIndex(
      (grant) => grant.subject.kind === "capability" && grant.subject.capabilityId === lintId,
    )
    expect(index).toBeGreaterThanOrEqual(0)
    const edited = snapshot((value) => {
      value.tools[1] = plugin("lint", "/plugins/lint.js", `sha256:${"b".repeat(64)}`)
    })
    expect(
      await checkBinding(proposal.bindings[index]!, proposal.candidate.capabilityGrants[index]!.subject, edited),
    ).toBe("changed")
  })
})

describe("only supported execution forms can be bound", () => {
  test("launchers, scripts and unresolved commands are unsupported; a direct binary is external", async () => {
    expect(executableFacts(process.execPath)).toEqual({ form: "unsupported", reason: "launcher" })
    for (const launcher of ["node", "npx", "uvx", "python3", "bash"]) {
      const facts = executableFacts(launcher)
      expect(facts.form).toBe("unsupported")
    }
    const script = path.join(home, "probe-script")
    await fs.writeFile(script, "#!/bin/sh\necho hi\n")
    await fs.chmod(script, 0o755)
    if (process.platform !== "win32") expect(executableFacts(script)).toEqual({ form: "unsupported", reason: "script" })
    expect(executableFacts(path.join(home, "missing-tool"))).toEqual({ form: "unsupported", reason: "unresolved" })
    const file = await binary("probe-tool")
    expect(executableFacts(file)).toEqual({
      form: "binary",
      path: await fs.realpath(file),
      digest: digest(await fs.readFile(file)),
    })
  })

  test("a module is supported only when everything it imports is a runtime builtin", () => {
    const facts = (source: string) => moduleFacts(new TextEncoder().encode(source), "/tool/probe.ts")
    expect(facts(`import fs from "node:fs"; import { $ } from "bun"; export default {}`).form).toBe("self_contained")
    expect(facts(`const fs = await import("node:fs"); export default {}`).form).toBe("self_contained")
    expect(facts(`import helper from "./helper"; export default helper`)).toEqual({
      form: "unsupported",
      reason: "imports",
    })
    expect(facts(`import z from "zod"; export default z`)).toEqual({ form: "unsupported", reason: "imports" })
    expect(facts(`const name = "./x"; export default await import(name)`)).toEqual({
      form: "unsupported",
      reason: "imports",
    })
    expect(facts(`export default require(process.env.X!)`)).toEqual({ form: "unsupported", reason: "imports" })
  })

  test("unsupported forms are never granted, external ones need the operator's acknowledgement", async () => {
    const snap = snapshot((value) => {
      value.tools.push(
        { ...plugin("pkg", "/plugins/pkg.js"), module: null } as ReviewToolEntry,
        mcpTool("beta", "probe"),
        mcpTool("gamma", "probe"),
      )
      value.mcpServers.beta = {
        type: "local",
        command: ["npx", "beta-server"],
        environment: [],
        executable: { form: "unsupported", reason: "launcher" },
      }
      value.mcpServers.gamma = { type: "remote", url: "https://gamma.invalid/mcp", headers: ["Authorization"] }
    })
    const pkg = pluginCapability(["directory", "/plugins/pkg.js", "default"]).descriptor.id
    const beta = mcpCapability(["mcp", "beta", "probe"]).descriptor.id
    const gamma = mcpCapability(["mcp", "gamma", "probe"]).descriptor.id

    const unacknowledged = await propose(contract(), snap, [])
    expect(unacknowledged.unbindable.map((item) => item.capabilityId)).toEqual(expect.arrayContaining([pkg, beta]))
    expect(unacknowledged.needsTrust.map((item) => item.capabilityId)).toContain(gamma)
    // A compiled binary binds native tools exactly, with no acknowledgement.
    expect(unacknowledged.candidate.capabilityGrants).toContainEqual({
      subject: { kind: "capability", capabilityId: "native.tool.shell" },
      decision: "allow",
      scope: { kind: "run" },
    })
    expect(unacknowledged.bindings.every((binding) => binding.attestation === "exact")).toBe(true)

    // Acknowledging an unsupported form grants nothing; acknowledging a remote
    // server grants it, marked as external trust and never as exact.
    const acknowledged = await propose(contract(), snap, [pkg, beta, gamma])
    const granted = acknowledged.candidate.capabilityGrants.find(
      (grant) => grant.subject.kind === "capability" && grant.subject.capabilityId === gamma,
    )
    expect(granted?.acknowledgesExternalTrust).toBe(true)
    expect(acknowledged.bindings.find((binding) => binding.subject === gamma)?.attestation).toBe("external")
    expect(
      acknowledged.candidate.capabilityGrants.some(
        (grant) => grant.subject.kind === "capability" && [pkg, beta].includes(grant.subject.capabilityId),
      ),
    ).toBe(false)
  })

  test("a development or unknown DAX build never binds native capabilities exactly", async () => {
    const development = snapshot((value) => {
      value.daxExecutable = { form: "development", commit: "c0ffee", clean: true }
    })
    const proposal = await propose(contract(), development, [])
    expect(proposal.needsTrust.map((item) => item.capabilityId)).toContain("native.tool.shell")
    expect(proposal.candidate.capabilityGrants).toEqual([])
    const trusted = await propose(contract(), development, ["native.tool.shell"])
    expect(trusted.candidate.capabilityGrants).toContainEqual({
      subject: { kind: "capability", capabilityId: "native.tool.shell" },
      decision: "allow",
      scope: { kind: "run" },
      acknowledgesExternalTrust: true,
    })
    const unknown = await propose(
      contract(),
      snapshot((value) => {
        value.daxExecutable = { form: "unknown" }
      }),
      ["native.tool.shell"],
    )
    expect(unknown.unbindable.map((item) => item.capabilityId)).toContain("native.tool.shell")

    // This suite runs from source: the running build is development, at HEAD.
    const running = await daxExecutable()
    expect(running.form).toBe("development")
    const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: import.meta.dir })
      .stdout.toString()
      .trim()
    if (running.form === "development") expect(running.commit).toBe(head)
  })
})

describe("verification binds the runner that dispatches, the argument vector, the directory and the executable", () => {
  function check(command: string, args: string[], cwd: string) {
    return CheckDefinition.parse({ id: "probe", kind: "test", label: "probe", command, args, cwd })
  }

  test("the plan proposes a runner by workflow; only a genuine dispatch establishes it", async () => {
    const tool = await binary("probe-tool")
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

      // A different argument vector or directory is not the reviewed command.
      expect(matchesReviewedVerification(direct, dispatched(["--fix"])!)).toBe(false)
      expect(matchesReviewedVerification(direct, dispatched(["--check"], path.join(directory, "sub"))!)).toBe(false)
      // The sandboxed runner is not the direct one the plan named.
      expect(
        matchesReviewedVerification(direct, dispatched(["--check"], directory, "sandboxed", runSandboxedWorkerCheck)!),
      ).toBe(false)
      // A runner name that does not match the genuine dispatch function establishes nothing.
      expect(dispatched(["--check"], directory, "sandboxed", runCheck)).toBeUndefined()
      expect(dispatched(["--check"], directory, "direct", async () => undefined)).toBeUndefined()
      // Outside the worktree is not a reviewable directory.
      expect(dispatched(["--check"], home)).toBeUndefined()

      // Same name, same size, different content: not the reviewed executable.
      await sameSizeEdit(tool, "binary-v1", "binary-v2")
      expect(matchesReviewedVerification(direct, dispatched(["--check"])!)).toBe(false)
    })
  })

  test("a plan run through a launcher has no supported form and proposes no verification grant", async () => {
    const snap = snapshot((value) => {
      value.verification = {
        descriptor: nativeCapabilities.list().find(() => false) ?? verificationDescriptor(),
        runner: "direct",
        cwd: ".",
        commands: [{ argv: ["bun", "test"], executable: { form: "unsupported", reason: "launcher" } }],
      }
    })
    const proposal = await propose(contract(), snap, ["verification.command.direct"])
    expect(proposal.unbindable.map((item) => item.capabilityId)).toContain("verification.command.direct")
    expect(
      proposal.candidate.capabilityGrants.some(
        (grant) => grant.subject.kind === "capability" && grant.subject.capabilityId === "verification.command.direct",
      ),
    ).toBe(false)
  })
})

// ---- synthetic catalog -------------------------------------------------------

function verificationDescriptor() {
  return {
    id: "verification.command.direct",
    riskClass: "high",
    scopeSupport: "opaque",
    requiresVerification: false,
  } as const
}

function contract(): ExecutionContract {
  const { contract } = compileWithRunId({ request: { intent: { input: "Inspect source." } } }, "ses_grant_stage4a")
  contract.toolAllowlist = []
  contract.toolBlocklist = []
  return contract
}

function plugin(alias: string, file: string, moduleDigest = `sha256:${"a".repeat(64)}`): ReviewToolEntry {
  const { descriptor, source } = pluginCapability(["directory", file, "default"])
  return {
    family: "plugin",
    alias,
    descriptor,
    source,
    metadata: "m1",
    module: { form: "self_contained", digest: moduleDigest },
  }
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
  const value: MutableSnapshot = {
    daxExecutable: { form: "compiled", commit: "c0ffee", digest: `sha256:${"d".repeat(64)}` },
    tools: [
      { family: "native", alias: "shell", descriptor: nativeCapabilities.require("native.tool.shell") },
      plugin("lint", "/plugins/lint.js"),
    ],
    mcpServers: {},
    session: [],
    workflow: [],
  }
  change?.(value)
  return value
}

const externalIds = (snap: ReviewCatalogSnapshot) =>
  snap.tools.flatMap((entry) => (entry.family === "plugin" || entry.family === "mcp_tool" ? [entry.descriptor.id] : []))

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
