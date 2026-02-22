import { test, expect, describe } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Filesystem } from "../../src/util/filesystem"
import { File } from "../../src/file"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("Filesystem.contains", () => {
  test("allows paths within project", () => {
    expect(Filesystem.contains("/project", "/project/src")).toBe(true)
    expect(Filesystem.contains("/project", "/project/src/file.ts")).toBe(true)
    expect(Filesystem.contains("/project", "/project")).toBe(true)
  })

  test("blocks ../ traversal", () => {
    expect(Filesystem.contains("/project", "/project/../etc")).toBe(false)
    expect(Filesystem.contains("/project", "/project/src/../../etc")).toBe(false)
    expect(Filesystem.contains("/project", "/etc/passwd")).toBe(false)
  })

  test("blocks absolute paths outside project", () => {
    expect(Filesystem.contains("/project", "/etc/passwd")).toBe(false)
    expect(Filesystem.contains("/project", "/tmp/file")).toBe(false)
    expect(Filesystem.contains("/home/user/project", "/home/user/other")).toBe(false)
  })

  test("handles prefix collision edge cases", () => {
    expect(Filesystem.contains("/project", "/project-other/file")).toBe(false)
    expect(Filesystem.contains("/project", "/projectfile")).toBe(false)
  })
})

describe("Filesystem.containsReal", () => {
  test("returns true for legitimate child paths", async () => {
    await using tmp = await tmpdir()
    expect(Filesystem.containsReal(tmp.path, path.join(tmp.path, "src"))).toBe(true)
    expect(Filesystem.containsReal(tmp.path, path.join(tmp.path, "src", "file.ts"))).toBe(true)
    expect(Filesystem.containsReal(tmp.path, tmp.path)).toBe(true)
  })

  test("returns false for lexical traversal", async () => {
    await using tmp = await tmpdir()
    // realpath resolves ".." so this becomes a check against an external path
    expect(Filesystem.containsReal(tmp.path, path.join(tmp.path, "../etc"))).toBe(false)
    expect(Filesystem.containsReal(tmp.path, path.join(tmp.path, "src/../../etc"))).toBe(false)
  })

  test("returns false for absolute paths outside project", async () => {
    await using tmp1 = await tmpdir()
    await using tmp2 = await tmpdir()
    expect(Filesystem.containsReal(tmp1.path, tmp2.path)).toBe(false)
    expect(Filesystem.containsReal(tmp1.path, path.join(tmp2.path, "file"))).toBe(false)
  })

  test("non-existent parent path returns false", () => {
    const nonExistentPath = "/non-existent-project-path-12345"
    // This will fail because resolvePathRecursively will throw ENOENT up to the root
    expect(Filesystem.containsReal(nonExistentPath, path.join(nonExistentPath, "file"))).toBe(false)
  })
})

/*
 * Integration tests for File.read() and File.list() path traversal protection.
 *
 * These tests verify the HTTP API code path is protected. The HTTP endpoints
 * in server.ts (GET /file/content, GET /file) call File.read()/File.list()
 * directly - they do NOT go through ReadTool or the agent permission layer.
 *
 * This is a SEPARATE code path from ReadTool, which has its own checks.
 */
describe("File.read path traversal protection", () => {
  test("rejects ../ traversal attempting to read /etc/passwd", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "allowed.txt"), "allowed content")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(File.read("../../../etc/passwd")).rejects.toThrow("Access denied: path escapes project directory")
      },
    })
  })

  test("rejects deeply nested traversal", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(File.read("src/nested/../../../../../../../etc/passwd")).rejects.toThrow(
          "Access denied: path escapes project directory",
        )
      },
    })
  })

  test("allows valid paths within project", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "valid.txt"), "valid content")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await File.read("valid.txt")
        expect(result.content).toBe("valid content")
      },
    })
  })
})

describe("File.list path traversal protection", () => {
  test("rejects ../ traversal attempting to list /etc", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await expect(File.list("../../../etc")).rejects.toThrow("Access denied: path escapes project directory")
      },
    })
  })

  test("allows valid subdirectory listing", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "subdir", "file.txt"), "content")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await File.list("subdir")
        expect(Array.isArray(result)).toBe(true)
      },
    })
  })
})

describe("Instance.containsPath", () => {
  test("returns true for path inside directory", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: () => {
        expect(Instance.containsPath(path.join(tmp.path, "foo.txt"))).toBe(true)
        expect(Instance.containsPath(path.join(tmp.path, "src", "file.ts"))).toBe(true)
      },
    })
  })

  test("returns true for path inside worktree but outside directory (monorepo subdirectory scenario)", async () => {
    await using tmp = await tmpdir({ git: true })
    const subdir = path.join(tmp.path, "packages", "lib")
    await fs.mkdir(subdir, { recursive: true })

    await Instance.provide({
      directory: subdir,
      fn: () => {
        // .dax at worktree root, but we're running from packages/lib
        expect(Instance.containsPath(path.join(tmp.path, ".dax", "state"))).toBe(true)
        // sibling package should also be accessible
        expect(Instance.containsPath(path.join(tmp.path, "packages", "other", "file.ts"))).toBe(true)
        // worktree root itself
        expect(Instance.containsPath(tmp.path)).toBe(true)
      },
    })
  })

  test("returns false for path outside both directory and worktree", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: () => {
        expect(Instance.containsPath("/etc/passwd")).toBe(false)
        expect(Instance.containsPath("/tmp/other-project")).toBe(false)
      },
    })
  })

  test("returns false for path with .. escaping worktree", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: () => {
        expect(Instance.containsPath(path.join(tmp.path, "..", "escape.txt"))).toBe(false)
      },
    })
  })

  test("handles directory === worktree (running from repo root)", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: () => {
        expect(Instance.directory).toBe(Instance.worktree)
        expect(Instance.containsPath(path.join(tmp.path, "file.txt"))).toBe(true)
        expect(Instance.containsPath("/etc/passwd")).toBe(false)
      },
    })
  })

  test("non-git project does not allow arbitrary paths via worktree='/'", async () => {
    await using tmp = await tmpdir() // no git: true

    await Instance.provide({
      directory: tmp.path,
      fn: () => {
        // worktree is "/" for non-git projects, but containsPath should NOT allow all paths
        expect(Instance.containsPath(path.join(tmp.path, "file.txt"))).toBe(true)
        expect(Instance.containsPath("/etc/passwd")).toBe(false)
        expect(Instance.containsPath("/tmp/other")).toBe(false)
      },
    })
  })
})

describe("Instance.containsPath with symlinks (security)", () => {
  test("blocks symlink escape to external directory", async () => {
    await using tmp = await tmpdir({ git: true })

    // Create external dir next to the temp project dir
    const externalDir = tmp.path + "-external"
    await fs.mkdir(externalDir, { recursive: true })
    const secretFile = path.join(externalDir, "secret.txt")
    await Bun.write(secretFile, "secret content")

    try {
      const symlinkInProject = path.join(tmp.path, "link-to-external")
      await fs.symlink(externalDir, symlinkInProject, "dir")

      await Instance.provide({
        directory: tmp.path,
        fn: () => {
          // Test symlink itself and file within it
          expect(Instance.containsPath(symlinkInProject)).toBe(false)
          expect(Instance.containsPath(path.join(symlinkInProject, "secret.txt"))).toBe(false)
          // Test non-existent file under the malicious symlink
          expect(Instance.containsPath(path.join(symlinkInProject, "non-existent.txt"))).toBe(false)
        },
      })
    } finally {
      await fs.rm(externalDir, { recursive: true, force: true })
    }
  })

  test("allows symlink to internal directory", async () => {
    await using tmp = await tmpdir({ git: true })

    const internalDir = path.join(tmp.path, "internal")
    await fs.mkdir(internalDir)
    const internalFile = path.join(internalDir, "internal.txt")
    await Bun.write(internalFile, "internal content")

    const symlinkInProject = path.join(tmp.path, "link-to-internal")
    await fs.symlink(internalDir, symlinkInProject, "dir")

    await Instance.provide({
      directory: tmp.path,
      fn: () => {
        expect(Instance.containsPath(symlinkInProject)).toBe(true)
        expect(Instance.containsPath(path.join(symlinkInProject, "internal.txt"))).toBe(true)
        expect(Instance.containsPath(path.join(symlinkInProject, "non-existent.txt"))).toBe(true)
      },
    })
  })

  test("File.read rejects symlink escape path", async () => {
    await using tmp = await tmpdir({ git: true })
    const externalDir = tmp.path + "-external"
    await fs.mkdir(externalDir, { recursive: true })
    const secretFile = path.join(externalDir, "secret.txt")
    await Bun.write(secretFile, "secret content")

    try {
      const symlinkInProject = "link-to-external" // relative path from tmp.path
      await fs.symlink(externalDir, path.join(tmp.path, symlinkInProject), "dir")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const escapePath = path.join(symlinkInProject, "secret.txt")
          await expect(File.read(escapePath)).rejects.toThrow("Access denied: path escapes project directory")
        },
      })
    } finally {
      await fs.rm(externalDir, { recursive: true, force: true })
    }
  })
})
