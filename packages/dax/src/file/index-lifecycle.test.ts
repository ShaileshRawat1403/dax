import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { File } from "./index"
import { Ripgrep } from "./ripgrep"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Log } from "@/util/log"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

let root: string
let previousHome: string | undefined
const restore: (() => void)[] = []

beforeEach(async () => {
  await Instance.disposeAll()
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dax-file-lifecycle-"))
  previousHome = process.env.DAX_TEST_HOME
  process.env.DAX_TEST_HOME = root
  const project = spyOn(Project, "fromDirectory").mockImplementation(async (directory) => ({
    project: {
      id: directory === root ? "global" : directory,
      worktree: directory,
      sandboxes: [],
      time: { created: 0, updated: 0 },
    },
    sandbox: directory,
  }))
  restore.push(() => project.mockRestore())
})

afterEach(async () => {
  await Instance.disposeAll()
  for (const fn of restore.splice(0).reverse()) fn()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await fs.promises.rm(root, { recursive: true, force: true })
})

async function inProject(fn: () => Promise<void>, name = "project") {
  const directory = path.join(root, name)
  await fs.promises.mkdir(directory, { recursive: true })
  return Instance.provide({ directory, fn })
}

async function drainUntil(check: () => boolean) {
  for (let i = 0; i < 30 && !check(); i++) await Promise.resolve()
  expect(check()).toBe(true)
}

test("immediate disposal aborts initialization and awaits scan settlement", async () => {
  let signal: AbortSignal | undefined
  let settled = false
  const error = spyOn(Log.create({ service: "file" }), "error").mockImplementation(() => {})
  const files = spyOn(Ripgrep, "files").mockImplementation(async function* (input) {
    signal = input.signal
    try {
      await Promise.resolve()
      input.signal!.throwIfAborted()
      yield "never-published.txt"
    } finally {
      settled = true
    }
  })
  restore.push(() => files.mockRestore(), () => error.mockRestore())
  await inProject(async () => {
    File.init()
    await Instance.dispose()
    expect(signal?.aborted).toBe(true)
    expect(settled).toBe(true)
    expect(files).toHaveBeenCalledTimes(1)
    expect(error).not.toHaveBeenCalled()
  })
})

test("disposal waits active initialization, excludes partial cache, and prevents new scans", async () => {
  const entered = deferred()
  const aborted = deferred()
  const release = deferred()
  let settled = false
  const files = spyOn(Ripgrep, "files").mockImplementation(async function* (input) {
    input.signal!.addEventListener("abort", aborted.resolve, { once: true })
    entered.resolve()
    try {
      yield "partial.txt"
      await aborted.promise
      await release.promise
      input.signal!.throwIfAborted()
    } finally {
      settled = true
    }
  })
  restore.push(() => files.mockRestore())
  await inProject(async () => {
    File.init()
    await entered.promise
    expect(await File.search({ query: "", type: "file" })).toEqual([])
    const disposing = Instance.dispose()
    await aborted.promise
    expect(settled).toBe(false)
    expect(await File.search({ query: "", type: "file" })).toEqual([])
    expect(files).toHaveBeenCalledTimes(1)
    release.resolve()
    await disposing
    expect(settled).toBe(true)
    await Instance.dispose()
    expect(files).toHaveBeenCalledTimes(1)
  })
})

test("active refresh preserves completed cache, is nonblocking, and is awaited on disposal", async () => {
  const refresh = deferred()
  const aborted = deferred()
  const release = deferred()
  let calls = 0
  let settled = false
  const files = spyOn(Ripgrep, "files").mockImplementation(async function* (input) {
    if (++calls === 1) {
      yield "initial.txt"
      return
    }
    input.signal!.addEventListener("abort", aborted.resolve, { once: true })
    refresh.resolve()
    try {
      yield "partial-refresh.txt"
      await aborted.promise
      await release.promise
      input.signal!.throwIfAborted()
    } finally {
      settled = true
    }
  })
  restore.push(() => files.mockRestore())
  await inProject(async () => {
    File.init()
    await drainUntil(() => calls === 1)
    for (let i = 0; i < 10 && calls < 2; i++) await File.search({ query: "", type: "file" })
    await refresh.promise
    expect(await File.search({ query: "", type: "file" })).toEqual(["initial.txt"])
    const disposing = Instance.dispose()
    await aborted.promise
    expect(settled).toBe(false)
    expect(await File.search({ query: "", type: "file" })).toEqual(["initial.txt"])
    expect(calls).toBe(2)
    release.resolve()
    await disposing
    expect(settled).toBe(true)
  })
})

test("unexpected scan failure is logged, partial result excluded, and a later search recovers", async () => {
  let calls = 0
  const failure = new Error("controlled indexing failure")
  const error = spyOn(Log.create({ service: "file" }), "error").mockImplementation(() => {})
  const files = spyOn(Ripgrep, "files").mockImplementation(async function* (input) {
    if (++calls === 1) {
      yield "partial.txt"
      throw failure
    }
    yield "recovered.txt"
    input.signal!.throwIfAborted()
  })
  restore.push(
    () => files.mockRestore(),
    () => error.mockRestore(),
  )
  await inProject(async () => {
    File.init()
    await drainUntil(() => error.mock.calls.length === 1)
    expect(error.mock.calls[0]).toEqual(["file index scan failed", expect.objectContaining({ error: failure })])
    let result: string[] = []
    for (let i = 0; i < 10 && !result.includes("recovered.txt"); i++)
      result = await File.search({ query: "", type: "file" })
    expect(result).toEqual(["recovered.txt"])
    expect(result).not.toContain("partial.txt")
    await Instance.dispose()
    expect(error).toHaveBeenCalledTimes(1)
  })
})

test("independent instances dispose only their own scans; repeated disposal remains safe", async () => {
  const signals = new Map<string, AbortSignal>()
  const settled = new Set<string>()
  const files = spyOn(Ripgrep, "files").mockImplementation(async function* (input) {
    signals.set(input.cwd, input.signal!)
    try {
      await new Promise<void>((resolve) => input.signal!.addEventListener("abort", () => resolve(), { once: true }))
      input.signal!.throwIfAborted()
      yield "unreachable.txt"
    } finally {
      settled.add(input.cwd)
    }
  })
  restore.push(() => files.mockRestore())
  await inProject(async () => {
    File.init()
  }, "one")
  await inProject(async () => {
    File.init()
  }, "two")
  const one = path.join(root, "one")
  const two = path.join(root, "two")
  await inProject(async () => {
    await Promise.all([Instance.dispose(), Instance.dispose()])
  }, "one")
  expect(signals.get(one)?.aborted).toBe(true)
  expect(settled.has(one)).toBe(true)
  expect(signals.get(two)?.aborted).toBe(false)
  await inProject(async () => {
    expect(await File.search({ query: "" })).toEqual([])
    await Instance.dispose()
  }, "two")
  expect(settled.has(two)).toBe(true)
  expect(files).toHaveBeenCalledTimes(2)
})

test("failed refresh retains completed cache and does not prevent a later refresh", async () => {
  let calls = 0
  const failure = new Error("controlled refresh failure")
  const error = spyOn(Log.create({ service: "file" }), "error").mockImplementation(() => {})
  const files = spyOn(Ripgrep, "files").mockImplementation(async function* () {
    if (++calls === 1) {
      yield "initial.txt"
      return
    }
    if (calls === 2) {
      yield "partial-refresh.txt"
      throw failure
    }
    yield "recovered.txt"
  })
  restore.push(() => files.mockRestore(), () => error.mockRestore())
  await inProject(async () => {
    File.init()
    for (let i = 0; i < 10 && calls < 2; i++) await File.search({ query: "", type: "file" })
    await drainUntil(() => error.mock.calls.length === 1)
    expect(await File.search({ query: "", type: "file" })).toEqual(["initial.txt"])
    let result: string[] = []
    for (let i = 0; i < 10 && !result.includes("recovered.txt"); i++)
      result = await File.search({ query: "", type: "file" })
    expect(result).toEqual(["recovered.txt"])
    expect(error.mock.calls[0]).toEqual(["file index scan failed", expect.objectContaining({ error: failure })])
    await Instance.dispose()
  })
})

test("disposal does not mask an unrelated scan error that races cancellation", async () => {
  const entered = deferred()
  const failure = new Error("controlled unrelated failure during disposal")
  const error = spyOn(Log.create({ service: "file" }), "error").mockImplementation(() => {})
  const files = spyOn(Ripgrep, "files").mockImplementation(async function* (input) {
    yield "partial.txt"
    entered.resolve()
    await new Promise<void>((resolve) => input.signal!.addEventListener("abort", () => resolve(), { once: true }))
    throw failure
  })
  restore.push(() => files.mockRestore(), () => error.mockRestore())
  await inProject(async () => {
    File.init()
    await entered.promise
    await Instance.dispose()
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0]).toEqual(["file index scan failed", expect.objectContaining({ error: failure })])
  })
})

test("global-home unexpected readdir failure is reported and a later scan recovers", async () => {
  await fs.promises.mkdir(path.join(root, "visible"), { recursive: true })
  const failure = Object.assign(new Error("controlled directory failure"), { code: "EACCES" })
  const error = spyOn(Log.create({ service: "file" }), "error").mockImplementation(() => {})
  const original = fs.promises.readdir
  const target = fs.promises as { readdir(path: string, options: { withFileTypes: true }): Promise<fs.Dirent[]> }
  let failed = false
  const read = spyOn(target, "readdir").mockImplementation(async (directory, options) => {
    if (directory === root && !failed) {
      failed = true
      throw failure
    }
    return original(directory, options)
  })
  restore.push(() => read.mockRestore(), () => error.mockRestore())
  await Instance.provide({
    directory: root,
    async fn() {
      File.init()
      await drainUntil(() => error.mock.calls.length === 1)
      expect(error.mock.calls[0]).toEqual(["file index scan failed", expect.objectContaining({ error: failure })])
      let result: string[] = []
      for (let i = 0; i < 50 && !result.includes("visible/"); i++) {
        result = await File.search({ query: "", type: "directory" })
        if (!result.length) await new Promise<void>((resolve) => setImmediate(resolve))
      }
      expect(result).toEqual(["visible/"])
      expect(error).toHaveBeenCalledTimes(1)
      await Instance.dispose()
    },
  })
})

for (const code of ["EACCES", "EPERM"]) {
  test(`global-home persistent ${code} child denial preserves siblings on initialization and refresh`, async () => {
    await fs.promises.mkdir(path.join(root, "visible", "nested"), { recursive: true })
    await fs.promises.mkdir(path.join(root, "restricted", "private"), { recursive: true })
    const original = fs.promises.readdir
    const target = fs.promises as { readdir(path: string, options: { withFileTypes: true }): Promise<fs.Dirent[]> }
    const rootEntries = (await original(root, { withFileTypes: true })).toSorted((a, b) => a.name.localeCompare(b.name))
    let visibleEntries = await original(path.join(root, "visible"), { withFileTypes: true })
    let deniedReads = 0
    const read = spyOn(target, "readdir").mockImplementation(async (directory, options) => {
      if (directory === path.join(root, "restricted")) {
        deniedReads++
        throw Object.assign(new Error("controlled child denial"), { code })
      }
      // Exercise continuation to an accessible sibling after the denied child.
      if (directory === root) return rootEntries
      if (directory === path.join(root, "visible")) return visibleEntries
      return original(directory, options)
    })
    const warn = spyOn(Log.create({ service: "file" }), "warn").mockImplementation(() => {})
    const error = spyOn(Log.create({ service: "file" }), "error").mockImplementation(() => {})
    restore.push(() => read.mockRestore(), () => warn.mockRestore(), () => error.mockRestore())
    await Instance.provide({
      directory: root,
      async fn() {
        File.init()
        const initial = ["restricted/", "visible/", "visible/nested/"]
        let result: string[] = []
        for (let i = 0; i < 100 && !result.includes("visible/nested/"); i++) {
          result = await File.search({ query: "", type: "directory" })
          await new Promise<void>((resolve) => setImmediate(resolve))
        }
        expect(result).toEqual(initial)
        const initialDenials = deniedReads
        expect(initialDenials).toBeGreaterThan(0)
        await fs.promises.mkdir(path.join(root, "visible", "added"), { recursive: true })
        visibleEntries = await original(path.join(root, "visible"), { withFileTypes: true })
        const refreshed = ["restricted/", "visible/", "visible/added/", "visible/nested/"]
        for (let i = 0; i < 100 && !result.includes("visible/added/"); i++) {
          result = await File.search({ query: "", type: "directory" })
          // Cache remains atomic even while every refresh encounters the denial.
          expect([initial, refreshed]).toContainEqual(result)
          await new Promise<void>((resolve) => setImmediate(resolve))
        }
        expect(result).toEqual(refreshed)
        expect(deniedReads).toBeGreaterThan(initialDenials)
        expect(warn).toHaveBeenCalledWith("file index child directory inaccessible", {
          directory: path.join(root, "restricted"),
          code,
        })
        expect(error).not.toHaveBeenCalled()
        await Instance.dispose()
      },
    })
  })
}

for (const failureCase of [
  { at: "root", code: "EACCES" },
  { at: "root", code: "ENOENT" },
  { at: "child", code: "EIO" },
]) {
  test(`global-home ${failureCase.at} ${failureCase.code} failure preserves prior cache and remains an error`, async () => {
    await fs.promises.mkdir(path.join(root, "visible", "nested"), { recursive: true })
    const failure = Object.assign(new Error("controlled scan failure"), { code: failureCase.code })
    const original = fs.promises.readdir
    const target = fs.promises as { readdir(path: string, options: { withFileTypes: true }): Promise<fs.Dirent[]> }
    let reject = false
    const failingDirectory = failureCase.at === "root" ? root : path.join(root, "visible")
    const read = spyOn(target, "readdir").mockImplementation(async (directory, options) => {
      if (reject && directory === failingDirectory) throw failure
      return original(directory, options)
    })
    const warn = spyOn(Log.create({ service: "file" }), "warn").mockImplementation(() => {})
    const error = spyOn(Log.create({ service: "file" }), "error").mockImplementation(() => {})
    restore.push(() => read.mockRestore(), () => warn.mockRestore(), () => error.mockRestore())
    await Instance.provide({
      directory: root,
      async fn() {
        File.init()
        let result: string[] = []
        for (let i = 0; i < 100 && !result.includes("visible/nested/"); i++) {
          result = await File.search({ query: "", type: "directory" })
          await new Promise<void>((resolve) => setImmediate(resolve))
        }
        const initial = ["visible/", "visible/nested/"]
        expect(result).toEqual(initial)
        reject = true
        for (let i = 0; i < 100 && !error.mock.calls.length; i++) {
          result = await File.search({ query: "", type: "directory" })
          expect(result).toEqual(initial)
          await new Promise<void>((resolve) => setImmediate(resolve))
        }
        expect(error).toHaveBeenCalledWith("file index scan failed", { directory: root, error: failure })
        expect(warn).not.toHaveBeenCalled()
        expect(await File.search({ query: "", type: "directory" })).toEqual(initial)
        await Instance.dispose()
      },
    })
  })
}

test("global-home disposal during a denied child read does not publish partial cache or report cancellation as denial", async () => {
  await fs.promises.mkdir(path.join(root, "restricted"), { recursive: true })
  await fs.promises.mkdir(path.join(root, "visible", "nested"), { recursive: true })
  const entered = deferred()
  const release = deferred()
  const original = fs.promises.readdir
  const target = fs.promises as { readdir(path: string, options: { withFileTypes: true }): Promise<fs.Dirent[]> }
  let rootReads = 0
  const read = spyOn(target, "readdir").mockImplementation(async (directory, options) => {
    if (directory === root) rootReads++
    if (directory === path.join(root, "restricted")) {
      entered.resolve()
      await release.promise
      throw Object.assign(new Error("controlled cancelled child read"), { code: "EACCES" })
    }
    return original(directory, options)
  })
  const warn = spyOn(Log.create({ service: "file" }), "warn").mockImplementation(() => {})
  const error = spyOn(Log.create({ service: "file" }), "error").mockImplementation(() => {})
  restore.push(() => read.mockRestore(), () => warn.mockRestore(), () => error.mockRestore())
  await Instance.provide({
    directory: root,
    async fn() {
      File.init()
      await entered.promise
      let settled = false
      const disposing = Instance.dispose().then(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(false)
      expect(await File.search({ query: "", type: "directory" })).toEqual([])
      expect(rootReads).toBe(1)
      release.resolve()
      await disposing
      expect(warn).not.toHaveBeenCalled()
      expect(error).not.toHaveBeenCalled()
    },
  })
})

test("global-home scan is awaited during startup disposal and never falls through to ripgrep", async () => {
  const entered = deferred()
  const release = deferred()
  const original = fs.promises.readdir
  const target = fs.promises as { readdir(path: string, options: { withFileTypes: true }): Promise<fs.Dirent[]> }
  const read = spyOn(target, "readdir").mockImplementation(async (directory, options) => {
    if (directory === root) {
      entered.resolve()
      await release.promise
    }
    return original(directory, options)
  })
  const files = spyOn(Ripgrep, "files")
  restore.push(
    () => read.mockRestore(),
    () => files.mockRestore(),
  )
  await Instance.provide({
    directory: root,
    async fn() {
      File.init()
      await entered.promise
      let disposed = false
      const disposing = Instance.dispose().then(() => {
        disposed = true
      })
      await Promise.resolve()
      expect(disposed).toBe(false)
      release.resolve()
      await disposing
      expect(disposed).toBe(true)
      expect(files).not.toHaveBeenCalled()
    },
  })
})

test("global-home completed directory cache preserves hidden and nested exclusions", async () => {
  await fs.promises.mkdir(path.join(root, "visible", "nested"), { recursive: true })
  await fs.promises.mkdir(path.join(root, "visible", "node_modules"), { recursive: true })
  await fs.promises.mkdir(path.join(root, ".hidden"), { recursive: true })
  await Instance.provide({
    directory: root,
    async fn() {
      File.init()
      let result: string[] = []
      for (let i = 0; i < 50 && !result.includes("visible/"); i++) {
        result = await File.search({ query: "", type: "directory" })
        if (!result.length) await new Promise<void>((resolve) => setImmediate(resolve))
      }
      expect(result).toEqual(["visible/", "visible/nested/"])
      await Instance.dispose()
    },
  })
})

test("real ripgrep initialization settles before strict fixture deletion", async () => {
  await inProject(async () => {
    const directory = Instance.directory
    await fs.promises.writeFile(path.join(directory, "seed.txt"), "synthetic\n")
    File.init()
    await Instance.dispose()
    await fs.promises.rm(directory, { recursive: true, force: true })
    expect(fs.existsSync(directory)).toBe(false)
  })
})
