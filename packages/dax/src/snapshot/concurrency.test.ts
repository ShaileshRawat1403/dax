import { $ } from "bun"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "@/project/instance"
import { Snapshot } from "@/snapshot"

let previousTestHome: string | undefined
let testRoot = ""
let testProject = ""

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dax-snapshot-concurrency-"))
  testProject = path.join(testRoot, "project")
  process.env.DAX_TEST_HOME = path.join(testRoot, "home")
  await fs.mkdir(testProject, { recursive: true })
  await fs.mkdir(path.join(process.env.DAX_TEST_HOME, ".config", "dax"), { recursive: true })
  await $`git init ${testProject}`.quiet()
  await fs.writeFile(path.join(testProject, "tracked.txt"), "before\n")
  await Instance.disposeAll()
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousTestHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousTestHome
  await fs.rm(testRoot, { recursive: true, force: true })
})

describe("project snapshot concurrency", () => {
  test("serializes concurrent baseline and mutation observations for one project", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const baselines = await Promise.all(Array.from({ length: 12 }, () => Snapshot.track()))
        expect(new Set(baselines).size).toBe(1)
        const baseline = baselines[0]
        expect(baseline).toMatch(/^[a-f0-9]{40,64}$/)

        await fs.writeFile(path.join(testProject, "tracked.txt"), "after\n")
        const observations = await Promise.all(Array.from({ length: 12 }, () => Snapshot.patch(baseline!)))

        for (const observation of observations) {
          expect(observation.status).toBe("observed")
          if (observation.status !== "observed") continue
          expect(observation.patch.files).toContain(path.join(testProject, "tracked.txt"))
          expect(observation.diff).toContain("+after")
        }
      },
    })
  })
})
