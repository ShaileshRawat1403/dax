import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { CapabilityDescriptor } from "@/capability/capability-types"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"
import { Command } from "@/command"
import { Instance } from "@/project/instance"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { SessionPrompt } from "./prompt"
import {
  bindTemplateContext,
  listTemplateContextCapabilities,
  requireTemplateContext,
} from "./template-context-identity"

let root = ""
let previousHome: string | undefined

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("Expected rejection")
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "dax-template-context-"))
  previousHome = process.env.DAX_TEST_HOME
  process.env.DAX_TEST_HOME = root
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await fs.rm(root, { recursive: true, force: true })
})

describe("command-template context lookup identity", () => {
  test("the descriptor describes only the stat effect, never permission", () => {
    const descriptors = listTemplateContextCapabilities()
    expect(descriptors).toHaveLength(1)
    expect(descriptors[0].id).toBe("session.context.template.stat")
    expect(descriptors[0].scopeSupport).toBe("filesystem")
    expect(CapabilityDescriptor.safeParse(descriptors[0]).success).toBe(true)
    expect("grant" in descriptors[0]).toBe(false)
  })

  test("a binding rejects a forged token, changed reference, path, or executor", () => {
    const executor = async () => undefined
    const input = { reference: "notes.md", filepath: "/repo/notes.md", executor }
    const binding = bindTemplateContext(input)
    expect(requireTemplateContext({ binding, ...input }).id).toBe("session.context.template.stat")
    expect(() => requireTemplateContext({ binding: {}, ...input })).toThrow(CapabilityIdentityError)
    expect(() => requireTemplateContext({ binding, ...input, reference: "other.md" })).toThrow(CapabilityIdentityError)
    expect(() => requireTemplateContext({ binding, ...input, filepath: "/repo/other.md" })).toThrow(
      CapabilityIdentityError,
    )
    expect(() => requireTemplateContext({ binding, ...input, executor: async () => undefined })).toThrow(
      CapabilityIdentityError,
    )
    expect(() => bindTemplateContext({ ...input, filepath: "" })).toThrow(CapabilityIdentityError)
  })

  test("the real prompt-part producer classifies existing file and directory references", async () => {
    await fs.writeFile(path.join(root, "notes.md"), "controlled context")
    await fs.mkdir(path.join(root, "folder"))
    await Instance.provide({
      directory: root,
      async fn() {
        const notes = path.join(root, "notes.md")
        const folder = path.join(root, "folder")
        const parts = await SessionPrompt.resolvePromptParts(
          `Inspect @${notes}, @${folder} and @${path.join(root, "missing.md")}; repeat @${notes}`,
        )
        expect(parts.filter((part) => part.type === "file").map((part) => [part.filename, part.mime])).toEqual([
          [notes, "text/plain"],
          [folder, "application/x-directory"],
        ])
        expect(parts.filter((part) => part.type === "text")).toHaveLength(1)
      },
    })
  })

  test("parallel lookup completion cannot reorder template references", async () => {
    const notes = path.join(root, "notes.md")
    const folder = path.join(root, "folder")
    await fs.writeFile(notes, "controlled context")
    await fs.mkdir(folder)
    await Instance.provide({
      directory: root,
      async fn() {
        const original = fs.stat
        let releaseNotes!: () => void
        const folderFinished = new Promise<void>((resolve) => {
          releaseNotes = resolve
        })
        const completed: string[] = []
        const probe = spyOn(fs, "stat").mockImplementation((async (filepath) => {
          if (filepath === notes) await folderFinished
          const result = await original(filepath)
          if (filepath === notes || filepath === folder) completed.push(String(filepath))
          if (filepath === folder) releaseNotes()
          return result
        }) as typeof fs.stat)
        try {
          const parts = await SessionPrompt.resolvePromptParts(`Inspect @${notes}, @${folder} and repeat @${notes}`)
          expect(completed).toEqual([folder, notes])
          expect(parts.filter((part) => part.type === "file").map((part) => part.filename)).toEqual([notes, folder])
        } finally {
          probe.mockRestore()
        }
      },
    })
  })

  test("an executor change during the awaited stat rejects before a prompt part is returned", async () => {
    await fs.writeFile(path.join(root, "notes.md"), "controlled context")
    await Instance.provide({
      directory: root,
      async fn() {
        const original = fs.stat
        const probe = spyOn(fs, "stat")
        const changedDuringStat = async (filepath: Parameters<typeof fs.stat>[0]) => {
          probe.mockRestore()
          return original(filepath)
        }
        probe.mockImplementation(changedDuringStat as typeof fs.stat)
        try {
          expect(
            await captureRejection(SessionPrompt.resolvePromptParts(`Inspect @${path.join(root, "notes.md")}`)),
          ).toBeInstanceOf(CapabilityIdentityError)
        } finally {
          probe.mockRestore()
        }
      },
    })
  })

  test("identity failures are not converted into missing-file or agent fallback", async () => {
    await Instance.provide({
      directory: root,
      async fn() {
        const probe = spyOn(fs, "stat").mockRejectedValueOnce(new CapabilityIdentityError("stale"))
        try {
          expect(
            await captureRejection(SessionPrompt.resolvePromptParts(`Inspect @${path.join(root, "missing.md")}`)),
          ).toBeInstanceOf(CapabilityIdentityError)
        } finally {
          probe.mockRestore()
        }
      },
    })
  })

  test("real command dispatch stops before message creation when template lookup identity fails", async () => {
    const filepath = path.join(root, "notes.md")
    await fs.writeFile(filepath, "controlled context")
    await fs.writeFile(
      path.join(root, "dax.json"),
      JSON.stringify({ command: { "context-probe": { template: `Inspect @${filepath}` } } }),
    )
    await Instance.provide({
      directory: root,
      async fn() {
        const session = await Session.create({ title: "Template identity producer" })
        expect(await Command.get("context-probe")).toBeDefined()
        const model = spyOn(Provider, "getModel").mockResolvedValue({} as never)
        const stat = spyOn(fs, "stat").mockRejectedValueOnce(new CapabilityIdentityError("stale"))
        try {
          expect(
            await captureRejection(
              SessionPrompt.command({
                sessionID: session.id,
                command: "context-probe",
                arguments: "",
                model: "openai/gpt-4o",
              }),
            ),
          ).toBeInstanceOf(CapabilityIdentityError)
          expect(model).toHaveBeenCalledTimes(1)
          expect(await Session.messages({ sessionID: session.id })).toEqual([])
        } finally {
          model.mockRestore()
          stat.mockRestore()
        }
      },
    })
  })
})
