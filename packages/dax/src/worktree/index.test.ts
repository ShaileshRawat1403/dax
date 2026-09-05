import { expect, test } from "bun:test"
import { $ } from "bun"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "../project/instance"
import { Global } from "../global"
import { Worktree } from "./index"

test("remove requires both git registration and managed-root containment", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-worktree-security-"))
  const previous = process.env.DAX_TEST_HOME
  process.env.DAX_TEST_HOME = home
  const repo = path.join(home, "repo")
  await fs.mkdir(repo)
  try {
    await $`git init -b test-worktree ${repo}`.quiet()
    await $`git -c user.name=Test -c user.email=test@example.com commit --allow-empty -m initial`.cwd(repo).quiet()
    await Instance.provide({
      directory: repo,
      fn: async () => {
        const root = path.join(Global.Path.data, "worktree", Instance.project.id)
        const unregistered = path.join(root, "unregistered")
        await fs.mkdir(unregistered, { recursive: true })
        const sentinel = path.join(unregistered, "keep.txt")
        await Bun.write(sentinel, "keep")
        await expect(Worktree.remove({ directory: unregistered })).rejects.toMatchObject({
          data: { message: "Directory is not a registered git worktree" },
        })
        expect(await Bun.file(sentinel).text()).toBe("keep")

        const outside = path.join(home, "outside")
        await $`git worktree add -b outside ${outside}`.cwd(repo).quiet()
        const alias = path.join(root, "alias")
        await fs.symlink(outside, alias)
        for (const directory of [repo, root, outside, alias]) {
          await expect(Worktree.remove({ directory })).rejects.toMatchObject({
            data: { message: "Cannot remove a directory outside the project's managed worktrees" },
          })
          expect((await fs.stat(directory)).isDirectory()).toBe(true)
        }

        const managed = path.join(root, "managed")
        await $`git worktree add -b managed ${managed}`.cwd(repo).quiet()
        expect(await Worktree.remove({ directory: managed })).toBe(true)
        expect(await fs.stat(managed).catch(() => undefined)).toBeUndefined()
        await Instance.dispose()
      },
    })
  } finally {
    if (previous === undefined) delete process.env.DAX_TEST_HOME
    else process.env.DAX_TEST_HOME = previous
    await fs.rm(home, { recursive: true, force: true })
  }
})
