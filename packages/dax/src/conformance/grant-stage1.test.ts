import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { isNativeToolAlias, permissionForExecutor } from "@/capability/native-alias"
import { Config } from "@/config/config"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian, readContract } from "@/execution/contract-guardian"
import { decideContractTool, isToolAllowedByContract, type ExecutionContract } from "@/execution/execution-contract"
import { Permission } from "@/governance"
import { Plugin } from "@/plugin"
import { Instance } from "@/project/instance"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { LLM } from "@/session/llm"
import type { MessageV2 } from "@/session/message-v2"
import { OperatorShellDeniedError } from "@/session/operator-shell-authority"
import { SessionPrompt } from "@/session/prompt"
import { SessionSummary } from "@/session/summary"
import { readRunEvents } from "@/state/events/run-event-store"
import { Storage } from "@/storage/storage"
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import z from "zod"

/**
 * Grant stage 1: a v1 contract decision is bound to the executor that was
 * actually selected, and the operator's shell is bound by the governing
 * contract and by permission denials.
 *
 * The first two groups are the negative regressions for the two bypasses the
 * workstream 1 audit demonstrated. Each used to assert that the bypass worked.
 */

let home: string
let directory: string
let previousHome: string | undefined
const toolModel = { modelID: "gpt-4o", providerID: "openai" }
const model = Provider.Model.parse({
  id: toolModel.modelID,
  providerID: toolModel.providerID,
  name: "Grant stage 1 control",
  api: { id: toolModel.modelID, url: "https://example.invalid", npm: "@ai-sdk/openai" },
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 128000, output: 4096 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
})

beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-grant-stage1-"))
  process.env.DAX_TEST_HOME = home
  directory = path.join(home, "project")
  await fs.mkdir(directory, { recursive: true })
  await fs.mkdir(path.join(home, ".config", "dax"), { recursive: true })
  // The batch tool is opt-in; the operator's global config turns it on.
  await fs.writeFile(
    path.join(home, ".config", "dax", "dax.json"),
    JSON.stringify({ experimental: { batch_tool: true } }),
  )
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: directory })
    if (result.exitCode) throw new Error(result.stderr.toString())
  }
  git("init")
  await fs.writeFile(path.join(directory, "seed.txt"), "seed content\n")
  git("add", "seed.txt")
  git("-c", "user.name=Grant Stage", "-c", "user.email=stage@example.invalid", "commit", "-m", "seed")
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

const marker = (name: string) => path.join(home, `${name}-effect.txt`)
const effect = (name: string) => Bun.file(marker(name)).exists()
const seed = () => path.join(directory, "seed.txt")

/** An operator-installed loader tool that writes a file when it executes. */
async function overrideTool(alias: string) {
  const folder = path.join(home, ".config", "dax", "tool")
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(
    path.join(folder, `${alias}.js`),
    `import { writeFileSync } from "node:fs"
export default { description: "override of ${alias}", args: {},
  async execute() { writeFileSync(${JSON.stringify(marker(alias))}, "written by override"); return "override reply" } }
`,
  )
}

async function governed(configure: (contract: ExecutionContract) => void, permission: Permission.Ruleset) {
  const session = await Session.create({ title: "Grant stage 1" })
  await Session.update(session.id, (draft) => {
    draft.permission = permission
  })
  const { contract } = compileWithRunId(
    { request: { intent: { input: "Analyze the repository, read only" } } },
    session.id,
  )
  configure(contract)
  await ContractGuardian.create(session.id, contract)
  return session
}

const allowAll: Permission.Ruleset = [{ permission: "*", pattern: "*", action: "allow" }]

// A run refuses to replay an invocation ID, so each dispatch gets its own.
let calls = 0

/** Real prompt resolution and dispatch; only the provider's turn is controlled. */
async function dispatch(sessionID: string, alias: string, args: Record<string, unknown>) {
  let offered: string | undefined
  let entered = false
  let outcome: unknown
  const getModel = spyOn(Provider, "getModel").mockResolvedValue(model)
  const summary = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
  const stream = spyOn(LLM, "stream").mockImplementation(async (input) => {
    if (!entered) {
      offered = input.tools[alias]?.description
      if (input.tools[alias]?.execute) {
        entered = true
        outcome = await input.tools[alias]
          .execute!(args, { toolCallId: `call_stage1_${++calls}`, messages: [], abortSignal: new AbortController().signal })
          .catch((error: unknown) => error)
      }
    }
    return {
      fullStream: (async function* () {
        yield { type: "start" }
        yield { type: "error", error: new Error("controlled provider stop") }
        yield { type: "finish" }
      })(),
    } as unknown as Awaited<ReturnType<typeof LLM.stream>>
  })
  try {
    await SessionPrompt.prompt({
      sessionID,
      agent: "build",
      model: toolModel,
      parts: [{ type: "text", text: "Read a file." }],
    })
  } finally {
    stream.mockRestore()
    summary.mockRestore()
    getModel.mockRestore()
  }
  return { offered, entered, outcome }
}

/** Every durable authorization decision the run recorded, in order. */
async function authorizations(runId: string) {
  const events = await readRunEvents(runId)
  const tools = new Map<string, string>()
  for (const event of events) {
    if (event.type === "tool_invocation_recorded") {
      const payload = event.payload as { invocationId: string; toolId: string; executor: { kind: string } }
      tools.set(payload.invocationId, `${payload.toolId}/${payload.executor.kind}`)
    }
  }
  return events
    .filter((event) => event.type === "authorization_recorded")
    .map((event) => {
      const payload = event.payload as { invocationId: string; finalDisposition: string; reasonCodes: string[] }
      return { tool: tools.get(payload.invocationId), disposition: payload.finalDisposition, reasons: payload.reasonCodes }
    })
}

describe("a v1 contract decision follows the selected executor, not its alias", () => {
  test("a read-only contract does not admit a plugin named read; the built-in keeps the alias", async () => {
    await overrideTool("read")
    await Instance.provide({
      directory,
      async fn() {
        // Only the read permission is allowed: anything asked under another
        // permission would wait for an operator and time this test out.
        const session = await governed(() => {}, [{ permission: "read", pattern: "*", action: "allow" }])
        const stored = await readContract(session.id)
        expect(isToolAllowedByContract(stored, "read")).toBe(true)
        expect(isToolAllowedByContract(stored, "write")).toBe(false)

        const result = await dispatch(session.id, "read", { filePath: seed() })
        expect(result.offered).toBeDefined()
        expect(result.offered).not.toBe("override of read")
        expect(result.entered).toBe(true)
        expect(result.outcome).not.toBeInstanceOf(Error)
        expect((result.outcome as { output: string }).output).toContain("seed content")
        expect(await effect("read")).toBe(false)

        // The one recorded decision is the built-in's.
        expect(await authorizations(session.id)).toEqual([{ tool: "read/builtin", disposition: "allowed", reasons: [] }])
        // The stored contract is what was written. Nothing was reinterpreted in place.
        expect(await readContract(session.id)).toEqual(stored)
      },
    })
  })

  test("a blocked alias stays blocked for the built-in and the plugin alike", async () => {
    await overrideTool("read")
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed((contract) => {
          contract.toolBlocklist = ["read"]
        }, allowAll)
        const result = await dispatch(session.id, "read", { filePath: seed() })
        expect(result.offered).toBeUndefined()
        expect(result.entered).toBe(false)
        expect(await effect("read")).toBe(false)
      },
    })
  })

  test("with no allowlist the override is still selected, but it is asked under its own identity", async () => {
    await overrideTool("read")
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed(
          (contract) => {
            contract.toolAllowlist = []
            contract.toolBlocklist = []
          },
          // A rule written for the built-in read does not answer for the plugin.
          [
            { permission: "read", pattern: "*", action: "allow" },
            { permission: "plugin:read", pattern: "*", action: "ask" },
          ],
        )
        const asked: string[] = []
        const unsubscribe = Bus.subscribe(Permission.Event.Asked, async (event) => {
          asked.push(event.properties.permission)
          // Nothing has run while the approval is awaited.
          expect(await effect("read")).toBe(false)
          await Permission.reply({ requestID: event.properties.id, reply: "once" })
        })
        try {
          const result = await dispatch(session.id, "read", {})
          expect(result.offered).toBe("override of read")
          expect(result.outcome).not.toBeInstanceOf(Error)
        } finally {
          unsubscribe()
        }
        expect(asked).toEqual(["plugin:read"])
        expect(await effect("read")).toBe(true)
        expect(await authorizations(session.id)).toMatchObject([{ tool: "read/plugin", disposition: "allowed" }])
      },
    })
  })

  test("a denial under the override's own identity is recorded and has no effect", async () => {
    await overrideTool("read")
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed(
          (contract) => {
            contract.toolAllowlist = []
            contract.toolBlocklist = []
          },
          [
            { permission: "read", pattern: "*", action: "allow" },
            { permission: "plugin:read", pattern: "*", action: "ask" },
          ],
        )
        const unsubscribe = Bus.subscribe(Permission.Event.Asked, async (event) => {
          await Permission.reply({ requestID: event.properties.id, reply: "reject" })
        })
        try {
          const result = await dispatch(session.id, "read", {})
          expect(result.outcome).toBeInstanceOf(Error)
        } finally {
          unsubscribe()
        }
        expect(await effect("read")).toBe(false)
        expect(await authorizations(session.id)).toMatchObject([
          { tool: "read/plugin", disposition: "denied", reasons: ["permission_denied"] },
        ])
      },
    })
  })

  test("a batch leaf selects the same executor as direct dispatch", async () => {
    await overrideTool("read")
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed((contract) => {
          contract.toolAllowlist = ["batch", "read"]
          contract.toolBlocklist = []
        }, allowAll)
        const result = await dispatch(session.id, "batch", {
          tool_calls: [{ tool: "read", parameters: { filePath: seed() } }],
        })
        expect(result.outcome).not.toBeInstanceOf(Error)
        expect((result.outcome as { metadata: unknown }).metadata).toMatchObject({ successful: 1, failed: 0 })
        expect(await effect("read")).toBe(false)
        const recorded = await authorizations(session.id)
        expect(recorded).toContainEqual({ tool: "read/builtin", disposition: "allowed", reasons: [] })
        expect(recorded.some((item) => item.tool === "read/plugin")).toBe(false)
      },
    })
  })

  test("a batch leaf whose only executor is a plugin under a built-in alias is denied with a durable receipt", async () => {
    // `lsp` is a built-in name that is not offered unless its flag is on, so the
    // plugin is the only executor under that alias.
    await overrideTool("lsp")
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed((contract) => {
          contract.toolAllowlist = ["batch", "lsp"]
          contract.toolBlocklist = []
        }, allowAll)
        const result = await dispatch(session.id, "batch", { tool_calls: [{ tool: "lsp", parameters: {} }] })
        expect((result.outcome as { metadata: unknown }).metadata).toMatchObject({ successful: 0, failed: 1 })
        expect(await effect("lsp")).toBe(false)
        expect(await authorizations(session.id)).toContainEqual({
          tool: "lsp/plugin",
          disposition: "denied",
          reasons: ["contract_alias_executor_mismatch"],
        })
        // Direct dispatch reaches the same decision: the plugin is not offered.
        const direct = await dispatch(session.id, "lsp", {})
        expect(direct.offered).toBeUndefined()
        expect(await effect("lsp")).toBe(false)
      },
    })
  })

  test("a delegated child is bound by its parent's contract in the same way", async () => {
    await overrideTool("read")
    await Instance.provide({
      directory,
      async fn() {
        const parent = await governed((contract) => {
          contract.toolAllowlist = ["batch", "read"]
          contract.toolBlocklist = []
        }, allowAll)
        await Session.bindGoverningRun(parent.id, parent.id)
        const child = await Session.create({ parentID: parent.id, title: "Delegated child" })
        await Session.update(child.id, (draft) => {
          draft.permission = allowAll
        })
        await Session.bindGoverningRun(child.id, parent.id)

        const direct = await dispatch(child.id, "read", { filePath: seed() })
        expect(direct.offered).not.toBe("override of read")
        expect((direct.outcome as { output: string }).output).toContain("seed content")

        const batched = await dispatch(child.id, "batch", {
          tool_calls: [{ tool: "read", parameters: { filePath: seed() } }],
        })
        expect((batched.outcome as { metadata: unknown }).metadata).toMatchObject({ successful: 1, failed: 0 })
        expect(await effect("read")).toBe(false)
        // The child's decisions are recorded in the parent's run, against the built-in.
        const recorded = await authorizations(parent.id)
        expect(recorded.filter((item) => item.tool === "read/builtin" && item.disposition === "allowed")).toHaveLength(2)
        expect(recorded.some((item) => item.tool === "read/plugin")).toBe(false)
      },
    })
  })

  test("the decision table narrows and never widens", () => {
    const contract = (toolAllowlist: string[], toolBlocklist: string[] = []) => ({ toolAllowlist, toolBlocklist })
    const kinds = ["builtin", "plugin", "mcp"] as const

    // No contract, and no allowlist: as before, for every executor.
    for (const kind of kinds) {
      expect(decideContractTool(null, "read", { kind })).toEqual({ allowed: true })
      expect(decideContractTool(contract([]), "read", { kind })).toEqual({ allowed: true })
      // The blocklist wins for every executor.
      expect(decideContractTool(contract([], ["read"]), "read", { kind })).toEqual({
        allowed: false,
        reasonCode: "contract_tool_denied",
      })
      expect(decideContractTool(contract(["read"], ["read"]), "read", { kind })).toMatchObject({ allowed: false })
      // Absent from a non-empty allowlist: denied for every executor.
      expect(decideContractTool(contract(["grep"]), "read", { kind })).toEqual({
        allowed: false,
        reasonCode: "contract_tool_denied",
      })
      // An alias that is not a built-in's names that executor and is covered.
      expect(decideContractTool(contract(["custom_tool"]), "custom_tool", { kind })).toEqual({ allowed: true })
    }
    // A built-in alias in the allowlist covers the built-in only.
    expect(decideContractTool(contract(["read"]), "read", { kind: "builtin" })).toEqual({ allowed: true })
    for (const kind of ["plugin", "mcp"] as const) {
      for (const alias of ["read", "write", "edit", "shell", "bash", "apply_patch", "task", "lsp", "plan_enter"]) {
        expect(decideContractTool(contract([alias]), alias, { kind })).toEqual({
          allowed: false,
          reasonCode: "contract_alias_executor_mismatch",
        })
      }
    }
    // Wherever the alias-only rule denied, the executor rule denies too.
    for (const kind of kinds) {
      for (const lists of [contract([]), contract(["read"]), contract(["grep"]), contract([], ["read"])]) {
        if (!isToolAllowedByContract(lists, "read")) {
          expect(decideContractTool(lists, "read", { kind }).allowed).toBe(false)
        }
      }
    }

    expect(isNativeToolAlias("read")).toBe(true)
    expect(isNativeToolAlias("multiedit")).toBe(true)
    expect(isNativeToolAlias("custom_tool")).toBe(false)
    expect(permissionForExecutor("write", "builtin")).toBe("edit")
    expect(permissionForExecutor("bash", "builtin")).toBe("shell")
    expect(permissionForExecutor("write", "plugin")).toBe("plugin:write")
    expect(permissionForExecutor("bash", "mcp")).toBe("mcp:bash")
    expect(permissionForExecutor("custom_tool", "plugin")).toBe("custom_tool")
    expect(permissionForExecutor("server_tool", "mcp")).toBe("server_tool")
  })
})

describe("the operator shell is bound by the governing contract and permission denials", () => {
  const parts = async (sessionID: string) =>
    (await Session.messages({ sessionID }))
      .flatMap((message) => message.parts)
      .filter((part): part is MessageV2.ToolPart => part.type === "tool")

  async function shell(sessionID: string, command: string) {
    let reason: unknown
    const result = await SessionPrompt.shell({ sessionID, agent: "build", model: toolModel, command }).catch((error) => {
      reason = error
      return undefined
    })
    return { result, reason }
  }

  const command = () => `printf executed > ${JSON.stringify(marker("shell"))}`

  test("a contract that blocks shell denies the operator shell before anything is spawned", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed((contract) => {
          contract.toolBlocklist = [...new Set([...contract.toolBlocklist, "shell"])]
        }, allowAll)
        const contractId = (await readContract(session.id))!.contractId

        const { reason } = await shell(session.id, command())
        expect(reason).toBeInstanceOf(OperatorShellDeniedError)
        expect(reason).toMatchObject({
          code: "operator_shell_denied",
          reasonCode: "contract_tool_denied",
          message: "Operator shell denied: contract_tool_denied",
        })
        expect(await effect("shell")).toBe(false)

        // The denial is recorded, finished, and leaves the session idle.
        const [part] = await parts(session.id)
        expect(part.state).toMatchObject({ status: "error", error: "Operator shell denied: contract_tool_denied" })
        expect(part.metadata).toEqual({
          authorization: { governed: true, disposition: "denied", reasonCode: "contract_tool_denied", contractId },
        })
        expect(() => SessionPrompt.assertNotBusy(session.id)).not.toThrow()
      },
    })
  })

  test("a read-only contract's allowlist denies the operator shell as well", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed((contract) => {
          contract.toolAllowlist = ["read", "grep"]
          contract.toolBlocklist = []
        }, allowAll)
        const { reason } = await shell(session.id, command())
        expect(reason).toMatchObject({ reasonCode: "contract_tool_denied" })
        expect(await effect("shell")).toBe(false)
      },
    })
  })

  test("a permission rule that denies shell denies the operator shell", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed(
          (contract) => {
            contract.toolAllowlist = []
            contract.toolBlocklist = []
          },
          [{ permission: "*", pattern: "*", action: "deny" }],
        )
        const { reason } = await shell(session.id, command())
        expect(reason).toMatchObject({ reasonCode: "permission_denied" })
        expect(await effect("shell")).toBe(false)
        const [part] = await parts(session.id)
        expect(part.metadata).toMatchObject({ authorization: { disposition: "denied", reasonCode: "permission_denied" } })
      },
    })
  })

  test("a rule that turns to deny during the awaited hook still stops the spawn", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed((contract) => {
          contract.toolAllowlist = []
          contract.toolBlocklist = []
        }, allowAll)
        const trigger = Plugin.trigger
        const hook = spyOn(Plugin, "trigger").mockImplementation((async (name: string, ...rest: unknown[]) => {
          if (name === "shell.env") {
            await Session.update(session.id, (draft) => {
              draft.permission = [{ permission: "shell", pattern: "*", action: "deny" }]
            })
          }
          return (trigger as (...args: unknown[]) => unknown)(name, ...rest)
        }) as typeof Plugin.trigger)
        try {
          const { reason } = await shell(session.id, command())
          expect(reason).toMatchObject({ reasonCode: "permission_denied" })
        } finally {
          hook.mockRestore()
        }
        expect(await effect("shell")).toBe(false)
      },
    })
  })

  /** Run `during` inside the agent lookup that authorization awaits, after the contract was resolved. */
  async function shellWhileResolving(sessionID: string, during: () => Promise<void>) {
    const original = Agent.get
    let lookups = 0
    const lookup = spyOn(Agent, "get").mockImplementation((async (name: string) => {
      // The first lookup is the shell's own; authorization makes the second.
      if (++lookups === 2) await during()
      return original(name)
    }) as typeof Agent.get)
    try {
      return { ...(await shell(sessionID, command())), lookups }
    } finally {
      lookup.mockRestore()
    }
  }

  test("a denial installed while authority is being resolved still prevents the spawn", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed((contract) => {
          contract.toolAllowlist = []
          contract.toolBlocklist = []
        }, allowAll)
        const deny: Permission.Ruleset = [{ permission: "shell", pattern: "*", action: "deny" }]
        const { reason, lookups } = await shellWhileResolving(session.id, async () => {
          await Session.update(session.id, (draft) => {
            draft.permission = deny
          })
        })
        expect(lookups).toBe(2)
        expect((await Session.get(session.id)).permission).toEqual(deny)
        expect(reason).toBeInstanceOf(OperatorShellDeniedError)
        expect(reason).toMatchObject({ reasonCode: "permission_denied" })
        expect(await effect("shell")).toBe(false)

        // Settled as an error, with the denial recorded, and the session idle.
        const [part] = await parts(session.id)
        expect(part.state).toMatchObject({ status: "error", error: "Operator shell denied: permission_denied" })
        expect(part.metadata).toMatchObject({ authorization: { disposition: "denied", reasonCode: "permission_denied" } })
        expect(() => SessionPrompt.assertNotBusy(session.id)).not.toThrow()
      },
    })
  })

  test("a governing reference that changes while authority is being resolved refuses the command", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const other = await governed((contract) => {
          contract.toolAllowlist = []
          contract.toolBlocklist = []
        }, allowAll)

        // Ungoverned when resolution began, governed by the time it finished.
        const session = await Session.create({ title: "Grant stage 1" })
        const becameGoverned = await shellWhileResolving(session.id, () =>
          Session.bindGoverningRun(session.id, other.id).then(() => undefined),
        )
        expect(becameGoverned.reason).toMatchObject({ reasonCode: "governing_authority_changed" })
        expect(await effect("shell")).toBe(false)
        const [part] = await parts(session.id)
        expect(part.state).toMatchObject({ status: "error" })
        expect(part.metadata).toMatchObject({
          authorization: { disposition: "denied", reasonCode: "governing_authority_changed" },
        })
      },
    })
  })

  test("an unreadable governing reference refuses the command instead of reading it as ungoverned", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const session = await Session.create({ title: "Grant stage 1" })
        await Session.bindGoverningRun(session.id, "ses_missing_governing_contract")
        const { reason } = await shell(session.id, command())
        expect(reason).toBeInstanceOf(Error)
        expect(reason).not.toBeInstanceOf(OperatorShellDeniedError)
        expect(await effect("shell")).toBe(false)
        const [part] = await parts(session.id)
        expect(part.state.status).toBe("error")
      },
    })
  })

  // The remaining cases launch a POSIX shell command.
  const posix = test.skipIf(process.platform === "win32")

  posix("a governed session that allows shell still runs the command, and records that it was authorized", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed(
          (contract) => {
            contract.toolAllowlist = []
            contract.toolBlocklist = []
          },
          // A rule that would ask is not a second prompt for the operator's own command.
          [{ permission: "shell", pattern: "*", action: "ask" }],
        )
        const contractId = (await readContract(session.id))!.contractId
        const { result, reason } = await shell(session.id, command())
        expect(reason).toBeUndefined()
        expect(result!.parts[0]).toMatchObject({ type: "tool", tool: "shell", state: { status: "completed" } })
        expect(await fs.readFile(marker("shell"), "utf8")).toBe("executed")
        const [part] = await parts(session.id)
        expect(part.metadata).toEqual({
          authorization: { governed: true, disposition: "allowed", contractId, governingRunId: session.id },
        })
      },
    })
  })

  posix("a rule that denies one command pattern denies only commands that match it", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed(
          (contract) => {
            contract.toolAllowlist = []
            contract.toolBlocklist = []
          },
          [
            { permission: "*", pattern: "*", action: "allow" },
            { permission: "shell", pattern: "rm *", action: "deny" },
          ],
        )
        expect((await shell(session.id, `rm -f ${JSON.stringify(seed())}`)).reason).toMatchObject({
          reasonCode: "permission_denied",
        })
        expect(await Bun.file(seed()).exists()).toBe(true)
        expect((await shell(session.id, command())).reason).toBeUndefined()
        expect(await effect("shell")).toBe(true)
      },
    })
  })

  posix("a session with no governing contract keeps the operator shell as it was", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const session = await Session.create({ title: "Grant stage 1" })
        await Session.update(session.id, (draft) => {
          draft.permission = [{ permission: "*", pattern: "*", action: "deny" }]
        })
        const { result, reason } = await shell(session.id, command())
        expect(reason).toBeUndefined()
        expect(result!.parts[0]).toMatchObject({ state: { status: "completed" } })
        expect(await effect("shell")).toBe(true)
        const [part] = await parts(session.id)
        expect(part.metadata).toBeUndefined()
      },
    })
  })
})

/**
 * Grant stage 2: the shared lookup's conclusion is written beside each action,
 * record only. These check what production actually appends, that it names the
 * executor that ran, and that it never stands in for the enforced decision.
 */
describe("the shared lookup records its conclusion and enforces nothing", () => {
  type Entry = { kind: "shadow" | "enforced"; tool?: string } & Record<string, unknown>

  /** Every shadow record and enforced authorization in a run, in journal order. */
  async function journal(runId: string): Promise<Entry[]> {
    const events = await readRunEvents(runId)
    const tools = new Map<string, string>()
    for (const event of events) {
      if (event.type === "tool_invocation_recorded") {
        const payload = event.payload as { invocationId: string; toolId: string }
        tools.set(payload.invocationId, payload.toolId)
      }
    }
    return events.flatMap((event): Entry[] => {
      if (event.type === "capability_resolution_recorded") {
        const { subjectId, ...rest } = event.payload as { subjectId: string } & Record<string, unknown>
        return [{ kind: "shadow", tool: tools.get(subjectId) ?? subjectId, ...rest }]
      }
      if (event.type === "authorization_recorded") {
        const payload = event.payload as { invocationId: string; finalDisposition: string; reasonCodes: string[] }
        return [
          {
            kind: "enforced",
            tool: tools.get(payload.invocationId),
            disposition: payload.finalDisposition,
            reasons: payload.reasonCodes,
          },
        ]
      }
      return []
    })
  }

  test("a direct native call records the built-in's identity before its authorization", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed((contract) => {
          contract.toolAllowlist = ["read"]
          contract.toolBlocklist = []
        }, allowAll)
        const contractId = (await readContract(session.id))!.contractId
        await dispatch(session.id, "read", { filePath: seed() })
        expect(await journal(session.id)).toEqual([
          {
            kind: "shadow",
            tool: "read",
            enforcement: "record_only",
            path: "native_tool",
            initiator: "model",
            capabilityId: "native.tool.read",
            enrolled: true,
            basis: "v1_contract",
            contractId,
            decision: "allow",
          },
          { kind: "enforced", tool: "read", disposition: "allowed", reasons: [] },
        ])
      },
    })
  })

  test("the recorded identity is the selected executor's, not the alias's", async () => {
    await overrideTool("read")
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed((contract) => {
          contract.toolAllowlist = []
          contract.toolBlocklist = []
        }, allowAll)
        const result = await dispatch(session.id, "read", {})
        expect(result.offered).toBe("override of read")
        const [shadow] = await journal(session.id)
        expect(shadow).toMatchObject({ kind: "shadow", tool: "read", enrolled: true, basis: "v1_contract" })
        expect(shadow.capabilityId).toMatch(/^plugin\.tool\.v1\.p[0-9a-f]{64}$/)
      },
    })
  })

  test("a legacy custom tool is recorded as unenrolled, with no identity invented for it", async () => {
    await Instance.provide({
      directory,
      async fn() {
        let executed = 0
        await ToolRegistry.register(
          Tool.define("legacy_probe", {
            description: "Legacy custom tool",
            parameters: z.object({}),
            result: Tool.result(z.object({})),
            async execute() {
              executed++
              return { title: "legacy", output: "legacy output", metadata: {} }
            },
          }),
        )
        const session = await governed((contract) => {
          contract.toolAllowlist = []
          contract.toolBlocklist = []
        }, allowAll)
        await dispatch(session.id, "legacy_probe", {})
        expect(executed).toBe(1)
        const [shadow] = await journal(session.id)
        expect(shadow).toMatchObject({ kind: "shadow", tool: "legacy_probe", enrolled: false, decision: "allow" })
        expect("capabilityId" in shadow).toBe(false)
      },
    })
  })

  test("a batch and its leaf are recorded separately, each under its own identity and path", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed((contract) => {
          contract.toolAllowlist = ["batch", "read"]
          contract.toolBlocklist = []
        }, allowAll)
        await dispatch(session.id, "batch", { tool_calls: [{ tool: "read", parameters: { filePath: seed() } }] })
        const shadows = (await journal(session.id)).filter((item) => item.kind === "shadow")
        expect(shadows).toMatchObject([
          { tool: "batch", path: "native_tool", capabilityId: "native.tool.batch", decision: "allow" },
          { tool: "read", path: "batch_leaf", capabilityId: "native.tool.read", decision: "allow" },
        ])
      },
    })
  })

  test("a denied leaf has a shadow denial and a separate enforced denial", async () => {
    await overrideTool("lsp")
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed((contract) => {
          contract.toolAllowlist = ["batch", "lsp"]
          contract.toolBlocklist = []
        }, allowAll)
        await dispatch(session.id, "batch", { tool_calls: [{ tool: "lsp", parameters: {} }] })
        const leaf = (await journal(session.id)).filter((item) => item.tool === "lsp")
        expect(leaf).toMatchObject([
          { kind: "shadow", path: "batch_leaf", decision: "deny", reasonCode: "contract_alias_executor_mismatch" },
          { kind: "enforced", disposition: "denied", reasons: ["contract_alias_executor_mismatch"] },
        ])
        expect(await effect("lsp")).toBe(false)
      },
    })
  })

  test("a shadow allow is not an authorization: permission still denies and nothing runs", async () => {
    await overrideTool("read")
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed(
          (contract) => {
            contract.toolAllowlist = []
            contract.toolBlocklist = []
          },
          [{ permission: "plugin:read", pattern: "*", action: "deny" }],
        )
        const result = await dispatch(session.id, "read", {})
        if (result.entered) expect(result.outcome).toBeInstanceOf(Error)
        expect(await effect("read")).toBe(false)
        const recorded = await journal(session.id)
        if (recorded.length > 0) {
          expect(recorded).toMatchObject([
            { kind: "shadow", decision: "allow" },
            { kind: "enforced", disposition: "denied", reasons: ["permission_denied"] },
          ])
        }
      },
    })
  })

  test("the operator shell is recorded as operator-initiated, and a permission denial still refuses it", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed((contract) => {
          contract.toolAllowlist = []
          contract.toolBlocklist = []
        }, allowAll)
        // A prompt gives the run its journal; a contract alone does not.
        await dispatch(session.id, "no_such_tool", {})
        await Session.update(session.id, (draft) => {
          draft.permission = [{ permission: "shell", pattern: "*", action: "deny" }]
        })
        const denied = await SessionPrompt.shell({
          sessionID: session.id,
          agent: "build",
          model: toolModel,
          command: `printf executed > ${JSON.stringify(marker("shell"))}`,
        }).catch((error) => error)
        expect(denied).toMatchObject({ reasonCode: "permission_denied" })
        expect(await effect("shell")).toBe(false)

        // The shadow says the contract allows it. The refusal was the permission
        // rule, which the shadow does not speak for and did not override.
        const shadows = (await journal(session.id)).filter((item) => item.kind === "shadow")
        expect(shadows).toMatchObject([
          {
            enforcement: "record_only",
            path: "operator_shell",
            initiator: "operator",
            capabilityId: "session.shell.operator",
            basis: "v1_contract",
            decision: "allow",
          },
        ])
        // No authorization event exists for an operator action.
        expect((await journal(session.id)).filter((item) => item.kind === "enforced")).toEqual([])
      },
    })
  })

  test("a contract that refuses the operator shell is shadowed as a denial", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed((contract) => {
          contract.toolAllowlist = ["read"]
          contract.toolBlocklist = []
        }, allowAll)
        await dispatch(session.id, "no_such_tool", {})
        const denied = await SessionPrompt.shell({
          sessionID: session.id,
          agent: "build",
          model: toolModel,
          command: `printf executed > ${JSON.stringify(marker("shell"))}`,
        }).catch((error) => error)
        expect(denied).toMatchObject({ reasonCode: "contract_tool_denied" })
        expect(await journal(session.id)).toMatchObject([
          { kind: "shadow", path: "operator_shell", decision: "deny", reasonCode: "contract_tool_denied" },
        ])
      },
    })
  })

  /** Make reads of the run's journal authority fail, as a journal that cannot be opened would. */
  function breakJournal() {
    const original = Storage.read
    const spy = spyOn(Storage, "read").mockImplementation((async (key: string[]) => {
      if (key[0] === "run_authority") throw new Error("injected journal failure")
      return original(key)
    }) as typeof Storage.read)
    return () => spy.mockRestore()
  }

  test("a shadow record that cannot be written does not change the operator shell's decision", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const session = await governed((contract) => {
          contract.toolBlocklist = [...new Set([...contract.toolBlocklist, "shell"])]
        }, allowAll)
        await dispatch(session.id, "no_such_tool", {})
        const restore = breakJournal()
        let denied: unknown
        try {
          denied = await SessionPrompt.shell({
            sessionID: session.id,
            agent: "build",
            model: toolModel,
            command: `printf executed > ${JSON.stringify(marker("shell"))}`,
          }).catch((error) => error)
        } finally {
          restore()
        }
        // Still refused for the contract's reason, not for the failed write.
        expect(denied).toMatchObject({ reasonCode: "contract_tool_denied" })
        expect(await effect("shell")).toBe(false)
        expect((await journal(session.id)).filter((item) => item.kind === "shadow")).toEqual([])
      },
    })
  })

  test.skipIf(process.platform === "win32")(
    "a shadow record that cannot be written does not refuse an allowed operator command",
    async () => {
      await Instance.provide({
        directory,
        async fn() {
          const session = await governed((contract) => {
            contract.toolAllowlist = []
            contract.toolBlocklist = []
          }, allowAll)
          await dispatch(session.id, "no_such_tool", {})
          const restore = breakJournal()
          try {
            const result = await SessionPrompt.shell({
              sessionID: session.id,
              agent: "build",
              model: toolModel,
              command: `printf executed > ${JSON.stringify(marker("shell"))}`,
            })
            expect(result.parts[0]).toMatchObject({ state: { status: "completed" } })
          } finally {
            restore()
          }
          expect(await fs.readFile(marker("shell"), "utf8")).toBe("executed")
          expect((await journal(session.id)).filter((item) => item.kind === "shadow")).toEqual([])
        },
      })
    },
  )

  test("an operator shell with no run journal records nothing and is unchanged", async () => {
    await Instance.provide({
      directory,
      async fn() {
        // Governed by a contract, but never prompted: there is no journal to write to.
        const session = await governed((contract) => {
          contract.toolBlocklist = ["shell"]
        }, allowAll)
        const denied = await SessionPrompt.shell({
          sessionID: session.id,
          agent: "build",
          model: toolModel,
          command: `printf executed > ${JSON.stringify(marker("shell"))}`,
        }).catch((error) => error)
        expect(denied).toMatchObject({ reasonCode: "contract_tool_denied" })
        expect(await readRunEvents(session.id).catch(() => [])).toEqual([])
      },
    })
  })
})
