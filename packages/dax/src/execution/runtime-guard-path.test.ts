import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { relativeGuardPath } from "./runtime-guard-path"

function fixture(fn: (paths: { root: string; alias: string; outside: string }) => void) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dax-guard-path-"))
  const root = path.join(home, "project")
  const alias = path.join(home, "project-alias")
  const outside = path.join(home, "outside")
  try {
    fs.mkdirSync(path.join(root, "src"), { recursive: true })
    fs.mkdirSync(outside)
    fs.symlinkSync(root, alias, process.platform === "win32" ? "junction" : "dir")
    fn({ root, alias, outside })
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
}

describe("runtime guard path normalization", () => {
  test("a future file through an alias stays inside its canonical workspace", () =>
    fixture(({ root, alias }) => {
      expect(relativeGuardPath({ filePath: "src/future.txt", directory: alias, worktree: root })).toBe(
        path.join("src", "future.txt"),
      )
      expect(
        relativeGuardPath({ filePath: path.join(alias, "src", "future.txt"), directory: alias, worktree: root }),
      ).toBe(path.join("src", "future.txt"))
    }))

  test("existing files and an alias for the worktree resolve consistently", () =>
    fixture(({ root, alias }) => {
      fs.writeFileSync(path.join(root, "src", "existing.txt"), "existing")
      for (const filePath of ["src/existing.txt", "src/future.txt"]) {
        expect(relativeGuardPath({ filePath, directory: root, worktree: alias })).toBe(
          filePath.split("/").join(path.sep),
        )
      }
    }))

  test("a symlinked ancestor cannot hide an escape from the workspace", () =>
    fixture(({ root, outside }) => {
      fs.symlinkSync(outside, path.join(root, "src", "escape"), process.platform === "win32" ? "junction" : "dir")
      const relative = relativeGuardPath({ filePath: "src/escape/future.txt", directory: root, worktree: root })
      expect(relative.startsWith(`..${path.sep}`)).toBe(true)
    }))

  test("the non-Git global root retains its cross-volume compatibility policy", () =>
    fixture(({ root }) => {
      const target = path.join(root, "src", "future.txt")
      const globalRoot = fs.realpathSync("/")
      expect(relativeGuardPath({ filePath: target, directory: root, worktree: "/" })).toBe(
        path.relative(globalRoot, path.join(fs.realpathSync(path.join(root, "src")), "future.txt")),
      )
    }))

  test("an absent workspace root fails closed", () =>
    fixture(({ root }) => {
      expect(() =>
        relativeGuardPath({ filePath: "src/new.txt", directory: root, worktree: path.join(root, "missing") }),
      ).toThrow()
    }))
})
