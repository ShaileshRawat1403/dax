import { expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Discovery } from "./discovery"
import { Global } from "../global"

test("remote skill manifests cannot traverse paths or write through cache symlinks", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-skill-paths-"))
  const previous = process.env.DAX_TEST_HOME
  process.env.DAX_TEST_HOME = home
  const cache = Discovery.dir()
  const outside = path.join(home, "outside")
  const sentinel = path.join(outside, "SKILL.md")
  await fs.mkdir(cache, { recursive: true })
  await fs.mkdir(outside)
  await Bun.write(sentinel, "keep")
  await fs.symlink(outside, path.join(cache, "linked"))
  await fs.mkdir(path.join(cache, "linked-file"))
  await fs.symlink(sentinel, path.join(cache, "linked-file", "SKILL.md"))
  const invalid = ["..", ".", "../escape", "a/b", "a\\b", "/absolute", "C:\\escape", "C:escape", "bad\0name"]
  const skills = [
    ...invalid.map((name) => ({ name, files: ["SKILL.md"] })),
    ...invalid.map((file, i) => ({ name: `invalid-${i}`, files: ["SKILL.md", file] })),
    { name: 42, files: ["SKILL.md"] },
    { name: "invalid-file", files: [null] },
    { name: "linked", files: ["SKILL.md"] },
    { name: "linked-file", files: ["SKILL.md"] },
    { name: "valid", files: ["SKILL.md", "reference.txt"] },
  ]
  const requested: string[] = []
  const fetch = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL) => {
        const url = String(input)
        requested.push(url)
        return url.endsWith("/index.json") ? Response.json({ skills }) : new Response("downloaded")
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
  try {
    const found = await Discovery.pull("https://registry.example/skills")
    expect(found).toEqual([path.join(cache, "valid")])
    expect(await Bun.file(sentinel).text()).toBe("keep")
    expect(await Bun.file(path.join(cache, "valid", "reference.txt")).text()).toBe("downloaded")
    expect(requested.sort()).toEqual([
      "https://registry.example/skills/index.json",
      "https://registry.example/skills/valid/SKILL.md",
      "https://registry.example/skills/valid/reference.txt",
    ])
    expect((await fs.readdir(cache)).sort()).toEqual(["linked", "linked-file", "valid"])

    // A fresh cache is created only under the trusted cache parent.
    await fs.rm(cache, { recursive: true })
    expect(await Discovery.pull("https://registry.example/skills")).toContain(path.join(cache, "valid"))
    expect(Global.Path.cache).toContain(home)
  } finally {
    fetch.mockRestore()
    if (previous === undefined) delete process.env.DAX_TEST_HOME
    else process.env.DAX_TEST_HOME = previous
    await fs.rm(home, { recursive: true, force: true })
  }
})
