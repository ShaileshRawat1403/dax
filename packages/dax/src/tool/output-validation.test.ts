import { describe, expect, mock, spyOn, test } from "bun:test"
import z from "zod"
import { Todo } from "../session/todo"
import { Tool } from "./tool"
import { InvalidTool } from "./invalid"
import { TodoReadTool } from "./todo"
import { Truncate } from "./truncation"
import { ShellResultSchema } from "./shell"
import { ApplyPatchTool } from "./apply_patch"
import { ReadTool } from "./read"
import { Instance } from "../project/instance"
import os from "node:os"
import path from "node:path"
import { mkdirSync, rmSync } from "node:fs"

const context = {
  sessionID: "ses_output_validation",
  messageID: "msg_output_validation",
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: mock(() => {}),
  ask: mock(async () => {}),
  authorize: mock(async () => {}),
} as unknown as Tool.Context

function malformedRuntimeValue<T>(value: unknown): T {
  return value as T
}

describe("tool result runtime validation", () => {
  test("shell owns and enforces its domain result contract", async () => {
    const valid = {
      title: "Lists files",
      output: "README.md",
      metadata: { exit: 0, output: "README.md", description: "Lists files" },
    }
    const genericEnvelopeValidButDomainInvalid = {
      ...valid,
      metadata: { exit: "zero", output: "README.md", description: "Lists files" },
    }

    expect(ShellResultSchema.safeParse(valid).success).toBeTrue()
    expect(Tool.parseResult("shell", genericEnvelopeValidButDomainInvalid)).toMatchObject({
      metadata: { exit: "zero" },
    })
    expect(ShellResultSchema.safeParse(genericEnvelopeValidButDomainInvalid).success).toBeFalse()
  })

  test("apply_patch owns files and diagnostics metadata semantics", async () => {
    const applyPatch = await ApplyPatchTool.init()
    const valid = {
      title: "Success",
      output: "Success",
      metadata: {
        diff: "diff --git a/a b/a",
        files: [
          {
            filePath: "/workspace/a.ts",
            relativePath: "a.ts",
            type: "update",
            diff: "diff --git a/a b/a",
            before: "before",
            after: "after",
            additions: 1,
            deletions: 1,
          },
        ],
        diagnostics: {},
      },
    }

    expect(applyPatch.result.safeParse(valid).success).toBeTrue()
    expect(
      applyPatch.result.safeParse({ ...valid, metadata: { ...valid.metadata, files: "not-an-array" } }).success,
    ).toBeFalse()
    expect(
      applyPatch.result.safeParse({
        ...valid,
        metadata: { ...valid.metadata, diagnostics: { "/workspace/a.ts": [{}] } },
      }).success,
    ).toBeFalse()
  })

  test("apply_patch add results omit absent movePath and cross both result schemas", async () => {
    const directory = path.join(os.tmpdir(), `dax-apply-patch-result-${Date.now()}-${Math.random()}`)
    mkdirSync(directory, { recursive: true })
    try {
      await Instance.provide({
        directory,
        async fn() {
          const applyPatch = await ApplyPatchTool.init()
          const result = await applyPatch.execute(
            { patchText: "*** Begin Patch\n*** Add File: added.txt\n+hello\n*** End Patch" },
            context,
          )
          expect(result.metadata.files).toHaveLength(1)
          expect(result.metadata.files[0]).not.toHaveProperty("movePath")
          const domainMetadata = { ...result.metadata } as Record<string, unknown>
          delete domainMetadata.truncated
          delete domainMetadata.outputPath
          expect(applyPatch.result.safeParse({ ...result, metadata: domainMetadata }).success).toBeTrue()
          expect(Tool.Result.safeParse(result).success).toBeTrue()
        },
      })
    } finally {
      await Instance.disposeAll()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("read owns truncation, loaded paths, and attachment semantics", async () => {
    const read = await ReadTool.init()
    const valid = {
      title: "README.md",
      output: "<file>content</file>",
      metadata: { preview: "content", truncated: false, loaded: ["/workspace/AGENTS.md"] },
      attachments: [
        {
          id: "part_1",
          sessionID: context.sessionID,
          messageID: context.messageID,
          type: "file" as const,
          mime: "text/plain",
          url: "data:text/plain;base64,Y29udGVudA==",
        },
      ],
    }

    expect(read.result.safeParse(valid).success).toBeTrue()
    expect(read.result.safeParse({ ...valid, metadata: { ...valid.metadata, truncated: "false" } }).success).toBeFalse()
    expect(read.result.safeParse({ ...valid, metadata: { ...valid.metadata, loaded: 42 } }).success).toBeFalse()
    expect(
      read.result.safeParse({ ...valid, attachments: [{ ...valid.attachments[0], type: "not-file" }] }).success,
    ).toBeFalse()
  })

  test("a generic-envelope-valid but domain-invalid result cannot become successful output", async () => {
    const probe = Tool.define("shell-domain-probe", {
      description: "test tool",
      parameters: z.object({}),
      result: ShellResultSchema,
      async execute() {
        return malformedRuntimeValue<z.output<typeof ShellResultSchema>>({
          title: "Lists files",
          output: "README.md",
          metadata: { exit: "zero", output: "README.md", description: "Lists files" },
        })
      },
    })
    const info = await probe.init()

    await expect(info.execute({}, context)).rejects.toMatchObject({
      name: "ToolResultValidationError",
      toolID: "shell-domain-probe",
    })
  })

  test("a valid built-in result reaches the caller", async () => {
    const info = await InvalidTool.init()

    await expect(info.execute({ tool: "read", error: "missing path" }, context)).resolves.toMatchObject({
      title: "Invalid Tool",
      output: expect.stringContaining("missing path"),
      metadata: { truncated: false },
    })
  })

  test("reinitializing a static built-in does not rewrap its validated executor", async () => {
    await InvalidTool.init()
    const info = await InvalidTool.init()

    await expect(info.execute({ tool: "read", error: "missing path" }, context)).resolves.toMatchObject({
      title: "Invalid Tool",
      metadata: { truncated: false },
    })
  })

  test("a built-in with nested domain metadata reaches the caller", async () => {
    const get = spyOn(Todo, "get").mockResolvedValue([
      { id: "todo_1", content: "validate result", status: "pending", priority: "high" },
    ])
    try {
      const info = await TodoReadTool.init()
      const result = await info.execute({}, context)

      expect(result).toMatchObject({
        title: "1 todos",
        metadata: {
          todos: [{ id: "todo_1", content: "validate result", status: "pending", priority: "high" }],
          truncated: false,
        },
      })
    } finally {
      get.mockRestore()
    }
  })

  test("a structured domain result with nested metadata and an attachment reaches the caller", async () => {
    const rich = Tool.define("rich-result", {
      description: "test tool",
      parameters: z.object({}),
      result: Tool.result(
        z.object({ artifacts: z.array(z.object({ id: z.string(), paths: z.array(z.string()) }).strict()) }).strict(),
      ),
      async execute() {
        return {
          title: "Artifact",
          output: "created",
          metadata: { artifacts: [{ id: "artifact_1", paths: ["src/index.ts"] }] },
          attachments: [
            {
              id: "part_1",
              sessionID: context.sessionID,
              messageID: context.messageID,
              type: "file" as const,
              mime: "text/plain",
              url: "data:text/plain;base64,Y3JlYXRlZA==",
            },
          ],
        }
      },
    })
    const info = await rich.init()
    const result = await info.execute({}, context)

    expect(result).toMatchObject({
      title: "Artifact",
      metadata: {
        artifacts: [{ id: "artifact_1", paths: ["src/index.ts"] }],
        truncated: false,
      },
      attachments: [{ id: "part_1", mime: "text/plain" }],
    })
  })

  test("a malformed result rejects instead of becoming a successful tool result", async () => {
    const malformedResultSchema = Tool.result(z.object({ count: z.number().int() }).strict())
    const malformed = Tool.define("malformed-result", {
      description: "test tool",
      parameters: z.object({ value: z.string() }),
      result: malformedResultSchema,
      async execute() {
        return malformedRuntimeValue<z.output<typeof malformedResultSchema>>({ title: "bad", output: 42, metadata: {} })
      },
    })
    const info = await malformed.init()

    await expect(info.execute({ value: "ok" }, context)).rejects.toMatchObject({
      name: "ToolResultValidationError",
      toolID: "malformed-result",
    })
  })

  test("input validation still stops the tool body", async () => {
    let executed = false
    const tool = Tool.define("input-still-validated", {
      description: "test tool",
      parameters: z.object({ value: z.string() }),
      result: Tool.result(z.object({}).strict()),
      async execute() {
        executed = true
        return { title: "ok", output: "ok", metadata: {} }
      },
    })
    const info = await tool.init()

    await expect(info.execute(malformedRuntimeValue<{ value: string }>({ value: 42 }), context)).rejects.toThrow(
      /invalid arguments/i,
    )
    expect(executed).toBeFalse()
  })

  test("truncation runs only after the domain result validates", async () => {
    const truncate = spyOn(Truncate, "output")
    const malformedResultSchema = Tool.result(z.object({}).strict())
    const malformed = Tool.define("malformed-before-truncate", {
      description: "test tool",
      parameters: z.object({}),
      result: malformedResultSchema,
      async execute() {
        return malformedRuntimeValue<z.output<typeof malformedResultSchema>>({ title: "bad", output: null, metadata: {} })
      },
    })
    try {
      const info = await malformed.init()
      await expect(info.execute({}, context)).rejects.toMatchObject({ name: "ToolResultValidationError" })
      expect(truncate).not.toHaveBeenCalled()
    } finally {
      truncate.mockRestore()
    }
  })

  test("canonical result capture occurs after validation but before presentation truncation", async () => {
    const truncate = spyOn(Truncate, "output").mockResolvedValue({
      content: "short model output",
      truncated: true,
      outputPath: "/tmp/dax-output.txt",
    })
    let captured: Tool.Result | undefined
    const captureContext: Tool.Context = {
      ...context,
      captureValidatedResult(result) {
        captured = result
      },
    }
    const tool = Tool.define("pre-truncation-capture", {
      description: "test tool",
      parameters: z.object({}),
      result: Tool.result(z.object({ value: z.string() }).strict()),
      async execute() {
        return { title: "capture", output: "complete executor result", metadata: { value: "domain" } }
      },
    })

    try {
      const info = await tool.init()
      const result = await info.execute({}, captureContext)
      expect(captured).toEqual({
        title: "capture",
        output: "complete executor result",
        metadata: { value: "domain" },
      })
      expect(result).toMatchObject({
        output: "short model output",
        metadata: { value: "domain", truncated: true, outputPath: "/tmp/dax-output.txt" },
      })
    } finally {
      truncate.mockRestore()
    }
  })
})
