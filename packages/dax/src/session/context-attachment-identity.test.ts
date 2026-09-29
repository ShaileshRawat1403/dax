import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { CapabilityDescriptor } from "@/capability/capability-types"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"
import { Instance } from "@/project/instance"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import {
  bindContextAttachment,
  listContextAttachmentCapabilities,
  requireContextAttachment,
} from "./context-attachment-identity"

let root = ""
let previousHome: string | undefined

const model = Provider.Model.parse({
  id: "gpt-4o",
  providerID: "openai",
  name: "Controlled attachment model",
  api: { id: "gpt-4o", url: "https://example.invalid", npm: "@ai-sdk/openai" },
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
  limit: { context: 128_000, output: 4_096 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
})

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "dax-context-attachment-"))
  previousHome = process.env.DAX_TEST_HOME
  process.env.DAX_TEST_HOME = root
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await fs.rm(root, { recursive: true, force: true })
})

describe("prompt-time local context identity", () => {
  test("strict descriptors describe effects but do not grant access", () => {
    const descriptors = listContextAttachmentCapabilities()
    expect(descriptors.map((item) => item.id)).toEqual([
      "session.context.attachment.stat",
      "session.context.attachment.read",
      "session.context.attachment.list",
      "session.context.attachment.media",
    ])
    for (const descriptor of descriptors) {
      expect(CapabilityDescriptor.safeParse(descriptor).success).toBe(true)
      expect(descriptor.scopeSupport).toBe("filesystem")
      expect("grant" in descriptor).toBe(false)
    }
  })

  test("a bound effect rejects another source, executor, operation, or changed input", () => {
    const part = { type: "file", url: "file:///a.txt", mime: "text/plain", filename: "a.txt" }
    const executor = {}
    const binding = bindContextAttachment({ part, filepath: "/a.txt", operation: "read", executor })
    const check = { binding, part, filepath: "/a.txt", operation: "read" as const, executor }
    expect(requireContextAttachment(check).id).toBe("session.context.attachment.read")
    expect(() => requireContextAttachment({ ...check, binding: {} })).toThrow(CapabilityIdentityError)
    expect(() => requireContextAttachment({ ...check, executor: {} })).toThrow(CapabilityIdentityError)
    expect(() => requireContextAttachment({ ...check, operation: "list" })).toThrow(CapabilityIdentityError)
    expect(() => requireContextAttachment({ ...check, filepath: "/b.txt" })).toThrow(CapabilityIdentityError)
    part.url = "file:///b.txt"
    expect(() => requireContextAttachment(check)).toThrow(CapabilityIdentityError)
  })

  test("real prompt producer reads text, lists a directory, and embeds media without model dispatch", async () => {
    const folder = path.join(root, "project")
    await fs.mkdir(folder)
    const textPath = path.join(folder, "notes.txt")
    const mediaPath = path.join(folder, "image.png")
    await fs.writeFile(path.join(folder, "listed-only.txt"), "directory-only marker")
    await fs.writeFile(textPath, "controlled attachment text")
    await fs.writeFile(mediaPath, Buffer.from([0, 1, 2, 3]))
    await Instance.provide({
      directory: folder,
      async fn() {
        const session = await Session.create({ title: "Attachment producer" })
        const getModel = spyOn(Provider, "getModel").mockResolvedValue(model)
        try {
          const message = await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            noReply: true,
            parts: [
              { type: "file", url: pathToFileURL(textPath).href, mime: "text/plain", filename: "notes.txt" },
              { type: "file", url: pathToFileURL(folder).href, mime: "text/plain", filename: "project" },
              { type: "file", url: pathToFileURL(mediaPath).href, mime: "image/png", filename: "image.png" },
            ],
          })
          expect(
            message.parts.some((part) => part.type === "text" && part.text.includes("controlled attachment text")),
          ).toBe(true)
          expect(message.parts.some((part) => part.type === "text" && part.text.includes("listed-only.txt"))).toBe(true)
          expect(
            message.parts.some((part) => part.type === "file" && part.url.startsWith("data:image/png;base64,")),
          ).toBe(true)
          expect(getModel).toHaveBeenCalledTimes(1)
        } finally {
          getModel.mockRestore()
        }
      },
    })
  })

  test("the existing sensitive-path denial still precedes the real ReadTool effect", async () => {
    const folder = path.join(root, "project")
    await fs.mkdir(folder)
    const secret = path.join(folder, ".env")
    await fs.writeFile(secret, "PRIVATE_TEST_VALUE")
    await Instance.provide({
      directory: folder,
      async fn() {
        const session = await Session.create({ title: "Blocked attachment" })
        const getModel = spyOn(Provider, "getModel").mockResolvedValue(model)
        const message = await SessionPrompt.prompt({
          sessionID: session.id,
          model: { providerID: "openai", modelID: "gpt-4o" },
          noReply: true,
          parts: [{ type: "file", url: pathToFileURL(secret).href, mime: "text/plain", filename: ".env" }],
        })
        expect(message.parts.some((part) => part.type === "text" && part.text.includes("[Blocked:"))).toBe(true)
        expect(message.parts.some((part) => part.type === "text" && part.text.includes("PRIVATE_TEST_VALUE"))).toBe(
          false,
        )
        expect(getModel).not.toHaveBeenCalled()
        getModel.mockRestore()
      },
    })
  })
})
