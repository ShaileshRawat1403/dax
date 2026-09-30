import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { CapabilityCatalog } from "@/capability/catalog"
import { CapabilityDescriptor } from "@/capability/capability-types"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"
import { Instance } from "@/project/instance"
import { Plugin } from "@/plugin"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import {
  bindOperatorShell,
  listOperatorShellCapabilities,
  requireOperatorShellCapability,
} from "./operator-shell-identity"

let root = ""
let previousHome: string | undefined
const model = { providerID: "openai", modelID: "gpt-4o" }
// The command below is POSIX shell. Windows shells quote differently, and this
// file tests identity at the dispatch boundary rather than shell portability.
const posix = test.skipIf(process.platform === "win32")

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "dax-operator-shell-identity-"))
  previousHome = process.env.DAX_TEST_HOME
  process.env.DAX_TEST_HOME = root
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await fs.rm(root, { recursive: true, force: true })
})

describe("operator session shell identity", () => {
  test("the descriptor is strict, listed in the vocabulary, and never an execution grant", () => {
    const [descriptor] = listOperatorShellCapabilities()
    expect(listOperatorShellCapabilities()).toHaveLength(1)
    expect(descriptor).toEqual({
      id: "session.shell.operator",
      riskClass: "high",
      scopeSupport: "opaque",
      requiresVerification: true,
    })
    expect(CapabilityDescriptor.safeParse({ ...descriptor, grants: [] }).success).toBe(false)
    const vocabulary = CapabilityCatalog.staticVocabulary()
    expect(vocabulary.require("session.shell.operator")).toEqual(descriptor)
    expect(vocabulary.familyOf(descriptor.id)).toBe("operator_shell")
    // Distinct from the model's shell tool and from command-template shell.
    expect(vocabulary.require("native.tool.shell").id).not.toBe(descriptor.id)
    expect(vocabulary.require("session.command.shell").id).not.toBe(descriptor.id)
  })

  test("binding rejects malformed, forged, and changed dispatch", () => {
    // Any launcher function stands in for the process primitive here; the real
    // one is exercised through SessionPrompt.shell below.
    const valid = { sessionID: "ses_control", command: "echo one", executor: () => {} }
    const binding = bindOperatorShell(valid)
    expect(requireOperatorShellCapability({ binding, ...valid }).id).toBe("session.shell.operator")
    expect(() => requireOperatorShellCapability({ binding: {}, ...valid })).toThrow(CapabilityIdentityError)
    expect(() => requireOperatorShellCapability({ binding, ...valid, command: "echo two" })).toThrow(
      CapabilityIdentityError,
    )
    expect(() => requireOperatorShellCapability({ binding, ...valid, sessionID: "ses_other" })).toThrow(
      CapabilityIdentityError,
    )
    expect(() => requireOperatorShellCapability({ binding, ...valid, executor: () => {} })).toThrow(
      CapabilityIdentityError,
    )
    expect(() => bindOperatorShell({ ...valid, sessionID: "" })).toThrow(CapabilityIdentityError)
    expect(() => bindOperatorShell({ ...valid, executor: {} })).toThrow(CapabilityIdentityError)
  })

  posix("real operator shell dispatch still runs the submitted command", async () => {
    await Instance.provide({
      directory: root,
      async fn() {
        const session = await Session.create({ title: "Operator shell producer" })
        const marker = path.join(root, "shell-ran.txt")
        const result = await SessionPrompt.shell({
          sessionID: session.id,
          agent: "build",
          model,
          command: `printf ran > ${JSON.stringify(marker)}`,
        })
        expect(result.parts[0]).toMatchObject({ type: "tool", tool: "shell", state: { status: "completed" } })
        expect(await Bun.file(marker).text()).toBe("ran")
      },
    })
  })

  posix("a command changed during the awaited environment hook cannot reach the shell", async () => {
    await Instance.provide({
      directory: root,
      async fn() {
        const session = await Session.create({ title: "Operator shell producer" })
        const marker = path.join(root, "shell-ran.txt")
        const replaced = path.join(root, "replaced-ran.txt")
        const input = {
          sessionID: session.id,
          agent: "build",
          model,
          command: `printf ran > ${JSON.stringify(marker)}`,
        }
        const trigger = Plugin.trigger
        const hook = spyOn(Plugin, "trigger").mockImplementation((async (name: string, ...rest: unknown[]) => {
          if (name === "shell.env") input.command = `printf ran > ${JSON.stringify(replaced)}`
          return (trigger as (...args: unknown[]) => unknown)(name, ...rest)
        }) as typeof Plugin.trigger)
        let reason: unknown
        try {
          await SessionPrompt.shell(input)
        } catch (error) {
          reason = error
        } finally {
          hook.mockRestore()
        }
        expect(reason).toBeInstanceOf(CapabilityIdentityError)
        expect(reason).toMatchObject({ code: "changed" })
        expect(await Bun.file(marker).exists()).toBe(false)
        expect(await Bun.file(replaced).exists()).toBe(false)
      },
    })
  })
})
