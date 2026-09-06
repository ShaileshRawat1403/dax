import { expect, mock, spyOn, test } from "bun:test"
import "../server/server"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "../project/instance"
import { FileTime } from "../file/time"
import { LSP } from "../lsp"
import { EditTool } from "./edit"
import type { Tool } from "./tool"

test("empty-oldString edits require a fresh read and show the existing content in the diff", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dax-edit-security-"))
  const filepath = path.join(directory, "existing.txt")
  const ask = mock(async (_request: Parameters<Tool.Context["ask"]>[0]) => {})
  const ctx: Tool.Context = {
    sessionID: "ses_edit", messageID: "msg_edit", agent: "build",
    abort: new AbortController().signal, messages: [], metadata() {}, ask, async authorize() {},
  }
  const touch = spyOn(LSP, "touchFile").mockResolvedValue()
  const diagnostics = spyOn(LSP, "diagnostics").mockResolvedValue({})
  try {
    await Bun.write(filepath, "original\n")
    await Instance.provide({ directory, fn: async () => {
      try {
        const edit = await EditTool.init()
        const input = { filePath: filepath, oldString: "", newString: "replacement\n" }
        await expect(edit.execute(input, ctx)).rejects.toThrow("must read file")
        expect(await Bun.file(filepath).text()).toBe("original\n")
        expect(ask).not.toHaveBeenCalled()
        FileTime.read(ctx.sessionID, filepath)
        await edit.execute(input, ctx)
        expect(await Bun.file(filepath).text()).toBe("replacement\n")
        expect(ask.mock.calls[0][0].metadata.diff).toContain("-original")
      } finally {
        await Instance.dispose()
      }
    } })
  } finally {
    touch.mockRestore()
    diagnostics.mockRestore()
    await rm(directory, { recursive: true, force: true })
  }
})
