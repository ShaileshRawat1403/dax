import { expect, spyOn, test } from "bun:test"
import path from "node:path"
import os from "node:os"
import { Project } from "./project"
import { Instance, InstanceCapacityError } from "./instance"

test("instance capacity is bounded without evicting live contexts and explicit disposal frees a slot", async () => {
  const prefix = path.join(os.tmpdir(), `dax-instance-cap-${crypto.randomUUID()}`)
  const project = spyOn(Project, "fromDirectory").mockImplementation(async (directory) => ({
    project: { id: directory, worktree: directory, sandboxes: [], time: { created: 0, updated: 0 } },
    sandbox: directory,
  }))
  const created: string[] = []
  try {
    let limited = false
    for (let i = 0; i <= 64; i++) {
      const directory = path.join(prefix, String(i))
      try {
        await Instance.provide({ directory, fn: () => undefined })
        created.push(directory)
      } catch (error) {
        expect(error).toBeInstanceOf(InstanceCapacityError)
        limited = true
        break
      }
    }
    expect(limited).toBe(true)
    expect(created.length).toBeGreaterThan(0)
    expect(project.mock.calls.length).toBeLessThanOrEqual(64)
    await Instance.provide({ directory: created[0], fn: () => expect(Instance.directory).toBe(created[0]) })
    await Instance.provide({ directory: created.pop()!, fn: () => Instance.dispose() })
    const replacement = path.join(prefix, "replacement")
    await Instance.provide({ directory: replacement, fn: () => undefined })
    created.push(replacement)
  } finally {
    for (const directory of created) await Instance.provide({ directory, fn: () => Instance.dispose() })
    project.mockRestore()
  }
})
