import { expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Project } from "../project/project"
import { Instance } from "../project/instance"
import * as Secrets from "../secrets/secrets-loader"
import { Server } from "./server"
import { authorizedDirectory, setLaunchDirectory } from "./directory-boundary"
import { configureTransport } from "./transport-security"

test("directory headers and queries cannot relocate the project root before initialization", async () => {
  configureTransport({ hostname: "127.0.0.1", ports: [4096] })
  const secrets = spyOn(Secrets, "getSecrets").mockResolvedValue({
    source: { type: "env" },
    raw: new Map(),
    serverPassword: undefined,
    serverUsername: undefined,
    substrateToken: undefined,
    natsCreds: undefined,
    natsCredsData: undefined,
  })
  const provide = spyOn(Instance, "provide").mockImplementation(async () => {
    throw new Error("instance reached")
  })
  try {
    for (const query of ["/?directory=/", "/?directory=%2F"]) {
      expect((await Server.App().request("http://localhost:4096" + query)).status).toBe(403)
    }
    expect(
      (
        await Server.App().request("http://localhost:4096/file", {
          headers: { "x-dax-directory": "/" },
        })
      ).status,
    ).toBe(403)
    expect(provide).not.toHaveBeenCalled()
  } finally {
    secrets.mockRestore()
    provide.mockRestore()
  }
})

test("directory authorization resolves aliases and permits registered worktrees only", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "dax-directory-boundary-"))
  const launch = path.join(temp, "launch")
  const sandbox = path.join(temp, "sandbox")
  const outside = path.join(temp, "outside")
  for (const dir of [launch, sandbox, outside]) await fs.mkdir(dir)
  await fs.symlink(outside, path.join(launch, "escape"))
  await fs.symlink(launch, path.join(temp, "alias"))
  const project = spyOn(Project, "fromDirectory").mockResolvedValue({
    project: { id: "test", worktree: launch, sandboxes: [sandbox], time: { created: 0, updated: 0 } },
    sandbox: launch,
  })
  const sandboxes = spyOn(Project, "sandboxes").mockResolvedValue([sandbox])
  try {
    await setLaunchDirectory(launch)
    expect(await authorizedDirectory(undefined)).toBe(await fs.realpath(launch))
    expect(await authorizedDirectory(path.join(temp, "alias"))).toBe(await fs.realpath(launch))
    expect(await authorizedDirectory(sandbox)).toBe(await fs.realpath(sandbox))
    expect(await authorizedDirectory(path.join(launch, "escape"))).toBeUndefined()
    expect(await authorizedDirectory(outside)).toBeUndefined()
    expect(await authorizedDirectory(temp)).toBeUndefined()
    const awaitRealLaunch = await fs.realpath(launch)
    expect(project.mock.calls.every(([directory]) => directory === awaitRealLaunch)).toBe(true)
  } finally {
    project.mockRestore()
    sandboxes.mockRestore()
    await setLaunchDirectory(process.cwd())
    await fs.rm(temp, { recursive: true, force: true })
  }
})
