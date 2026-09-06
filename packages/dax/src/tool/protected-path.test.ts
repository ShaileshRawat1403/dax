import { expect, mock, test } from "bun:test"
import "../server/server"
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "../project/instance"
import { WriteTool } from "./write"
import { EditTool } from "./edit"
import { ApplyPatchTool } from "./apply_patch"
import { assertUnprotectedWrite } from "./protected-path"
import type { Tool } from "./tool"

test("all file mutation tools reject protected targets before any approval or write", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dax-protected-"))
  const ask = mock(async () => {}) // Even an operator ruleset that allows everything cannot bypass this.
  const ctx: Tool.Context = {
    sessionID: "ses_protected",
    messageID: "msg_protected",
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata() {},
    ask,
    async authorize() {},
  }
  try {
    await Instance.provide({
      directory,
      fn: async () => {
        try {
          const write = await WriteTool.init()
          const edit = await EditTool.init()
          const patch = await ApplyPatchTool.init()
          const targets = [
            ".dax/plugin/x.ts",
            "dax.json",
            "nested/dax.jsonc",
            "AGENTS.md",
            ".claude/rules.md",
            ".git/hooks/pre-commit",
            ".DAX/plugin/x.ts",
          ]
          for (const target of targets) {
            await expect(write.execute({ filePath: target, content: "payload" }, ctx)).rejects.toThrow("forbidden")
            await expect(edit.execute({ filePath: target, oldString: "", newString: "payload" }, ctx)).rejects.toThrow(
              "forbidden",
            )
            await expect(
              patch.execute(
                {
                  patchText: `*** Begin Patch\n*** Add File: safe.txt\n+safe\n*** Add File: ${target}\n+payload\n*** End Patch`,
                },
                ctx,
              ),
            ).rejects.toThrow("forbidden")
            await expect(
              patch.execute({ patchText: `*** Begin Patch\n*** Delete File: ${target}\n*** End Patch` }, ctx),
            ).rejects.toThrow("forbidden")
            await expect(
              patch.execute(
                {
                  patchText: `*** Begin Patch\n*** Update File: safe.txt\n*** Move to: ${target}\n@@\n-safe\n+payload\n*** End Patch`,
                },
                ctx,
              ),
            ).rejects.toThrow("forbidden")
          }
          expect(ask).not.toHaveBeenCalled()
          expect(await Bun.file(path.join(directory, "safe.txt")).exists()).toBe(false)
          await mkdir(path.join(directory, ".dax"))
          await symlink(path.join(directory, ".dax"), path.join(directory, "alias"))
          await expect(write.execute({ filePath: "alias/plugins/new.ts", content: "payload" }, ctx)).rejects.toThrow(
            "forbidden",
          )
          expect(ask).not.toHaveBeenCalled()
          await expect(assertUnprotectedWrite(path.join(directory, "src/new.ts"))).resolves.toBeUndefined()
        } finally {
          await Instance.dispose()
        }
      },
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
