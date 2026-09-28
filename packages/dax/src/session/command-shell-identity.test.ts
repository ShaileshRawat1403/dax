import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { CapabilityDescriptor } from "@/capability/capability-types"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"
import { Command } from "@/command"
import { Permission } from "@/governance"
import { Instance } from "@/project/instance"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Sandbox } from "@/shell/sandbox"
import { bindCommandShell, listCommandShellCapabilities, requireCommandShellCapability } from "./command-shell-identity"

let root = ""
let previousHome: string | undefined

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  let rejected = false
  let reason: unknown
  try {
    await promise
  } catch (error) {
    rejected = true
    reason = error
  }
  if (!rejected) throw new Error("Expected command rejection")
  return reason
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "dax-command-shell-identity-"))
  previousHome = process.env.DAX_TEST_HOME
  process.env.DAX_TEST_HOME = root
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await fs.rm(root, { recursive: true, force: true })
})

describe("command-template shell identity", () => {
  test("the descriptor is strict and never an execution grant", () => {
    const [descriptor] = listCommandShellCapabilities()
    expect(listCommandShellCapabilities()).toHaveLength(1)
    expect(descriptor.id).toBe("session.command.shell")
    expect(descriptor.scopeSupport).toBe("opaque")
    expect(descriptor.requiresVerification).toBe(true)
    expect(CapabilityDescriptor.safeParse(descriptor).success).toBe(true)
    expect("grant" in descriptor).toBe(false)
  })

  test("binding rejects forged, changed, or mismatched command snippets", () => {
    const command: Command.Info = { name: "probe", template: "!`one` !`two`", hints: [] }
    const binding = bindCommandShell({
      command,
      selectedName: "probe",
      template: "!`one` !`two`",
      snippets: ["one", "two"],
    })
    const valid = { binding, command, selectedName: "probe", template: "!`one` !`two`", index: 1, snippet: "two" }
    expect(requireCommandShellCapability(valid).id).toBe("session.command.shell")
    expect(() => requireCommandShellCapability({ ...valid, binding: {} })).toThrow(CapabilityIdentityError)
    expect(() => requireCommandShellCapability({ ...valid, snippet: "one" })).toThrow(CapabilityIdentityError)
    expect(() => bindCommandShell({ command, selectedName: "probe", template: "!`one`", snippets: ["two"] })).toThrow(
      CapabilityIdentityError,
    )
    command.name = "replaced"
    expect(() => requireCommandShellCapability(valid)).toThrow(CapabilityIdentityError)
  })

  test("real command dispatch runs only after review and rejects changed identity before effects", async () => {
    await fs.writeFile(
      path.join(root, "dax.json"),
      JSON.stringify({ command: { "identity-probe": { template: "!`echo controlled`" } } }),
    )
    await Instance.provide({
      directory: root,
      async fn() {
        const session = await Session.create({ title: "Command identity producer" })
        const marker = path.join(root, "shell-ran.txt")
        const command = await Command.get("identity-probe")
        expect(command?.source).toBe("command")
        const ask = spyOn(Permission, "ask").mockResolvedValue(undefined as never)
        const wrap = spyOn(Sandbox, "wrap").mockResolvedValue([
          process.execPath,
          "-e",
          `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`,
        ])
        const model = spyOn(Provider, "getModel").mockRejectedValue(new Error("controlled model boundary"))
        const input = { sessionID: session.id, command: "identity-probe", arguments: "", model: "openai/gpt-4o" }
        try {
          expect((await captureRejection(SessionPrompt.command(input))) as Error).toHaveProperty(
            "message",
            "controlled model boundary",
          )
          expect(await Bun.file(marker).text()).toBe("ran")
          expect(ask).toHaveBeenCalledTimes(1)
          expect(wrap).toHaveBeenCalledTimes(1)

          await fs.rm(marker)
          ask.mockRejectedValueOnce(new Error("operator denied"))
          expect((await captureRejection(SessionPrompt.command(input))) as Error).toHaveProperty(
            "message",
            "operator denied",
          )
          expect(await Bun.file(marker).exists()).toBe(false)
          expect(wrap).toHaveBeenCalledTimes(1)

          ask.mockImplementationOnce(
            Object.assign(
              async () => {
                command!.name = "replaced-during-approval"
              },
              { force: Permission.ask.force, schema: Permission.ask.schema },
            ),
          )
          expect(await captureRejection(SessionPrompt.command(input))).toBeInstanceOf(CapabilityIdentityError)
          expect(await Bun.file(marker).exists()).toBe(false)
          expect(wrap).toHaveBeenCalledTimes(1)

          command!.name = "identity-probe"
          wrap.mockImplementationOnce(async () => {
            command!.name = "replaced-during-sandbox"
            return [process.execPath, "-e", "process.exit(9)"]
          })
          expect(await captureRejection(SessionPrompt.command(input))).toBeInstanceOf(CapabilityIdentityError)
          expect(await Bun.file(marker).exists()).toBe(false)
          expect(model).toHaveBeenCalledTimes(1)
        } finally {
          ask.mockRestore()
          wrap.mockRestore()
          model.mockRestore()
        }
      },
    })
  })
})
