import fs from "node:fs/promises"
import path from "node:path"
import { Project } from "../project/project"

let launchDirectory = path.resolve(process.cwd())

export async function setLaunchDirectory(directory: string) {
  launchDirectory = await fs.realpath(directory)
}

export async function authorizedDirectory(input: string | undefined): Promise<string | undefined> {
  const directory = await fs.realpath(input ?? launchDirectory).catch(() => undefined)
  if (!directory) return undefined
  const launch = await fs.realpath(launchDirectory)
  if (directory === launch) return directory
  if (path.dirname(directory) === directory) return undefined

  // Consult only the launch project's registered worktrees, never discover a
  // project using the caller's proposed directory before it is authorized.
  const { project } = await Project.fromDirectory(launch)
  const sandboxes = await Project.sandboxes(project.id)
  for (const sandbox of sandboxes) {
    if (directory === (await fs.realpath(sandbox).catch(() => undefined))) return directory
  }
  return undefined
}
