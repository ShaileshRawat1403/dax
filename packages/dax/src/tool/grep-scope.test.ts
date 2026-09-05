import { expect, mock, test } from "bun:test"
import "../server/server"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "../project/instance"
import { GrepTool } from "./grep"
import type { Tool } from "./tool"

test("grep asks about the files ripgrep actually opened, not just the caller's scope", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "dax-grep-scope-"))
  const asked: string[][] = []
  const ask = mock(async (request: Parameters<Tool.Context["ask"]>[0]) => {
    asked.push(request.patterns ?? [])
  })
  const ctx: Tool.Context = {
    sessionID: "ses_grep",
    messageID: "msg_grep",
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata() {},
    ask,
  }

  try {
    await writeFile(path.join(directory, ".env"), "SECRET_TOKEN=hunter2\n")
    await Instance.provide({
      directory,
      fn: async () => {
        const grep = await GrepTool.init()
        // Only `pattern` is supplied, so the pre-flight ask sees the needle alone.
        await grep.execute({ pattern: "SECRET_TOKEN" }, ctx)
      },
    })

    expect(asked.length).toBe(2)
    expect(asked[0]).toEqual(["SECRET_TOKEN"])
    expect(asked[1]!.some((p) => p.endsWith(".env"))).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
