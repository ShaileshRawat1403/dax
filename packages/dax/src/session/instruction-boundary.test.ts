import { expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "../project/instance"
import { InstructionPrompt } from "./instruction"

test("instruction discovery does not read a sibling directory that shares the project prefix", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "dax-instruction-"))
  const root = path.join(base, "proj")
  const sibling = path.join(base, "proj-secrets")
  await mkdir(root, { recursive: true })
  await mkdir(sibling, { recursive: true })
  await writeFile(path.join(sibling, "AGENTS.md"), "internal-only credentials\n")

  try {
    await Instance.provide({
      directory: root,
      fn: async () => {
        const results = await InstructionPrompt.resolve([], path.join(sibling, "source.ts"), "msg_boundary")
        expect(results).toEqual([])
      },
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
