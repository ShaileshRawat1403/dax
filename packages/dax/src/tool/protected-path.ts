import { lstat, realpath } from "node:fs/promises"
import path from "node:path"

function isProtected(filepath: string) {
  const parts = filepath.toLowerCase().split(/[\\/]/)
  return parts.some(
    (part, index) =>
      part === ".dax" ||
      part === ".claude" ||
      part === "dax.json" ||
      part === "dax.jsonc" ||
      part === "agents.md" ||
      (part === "hooks" && parts[index - 1] === ".git"),
  )
}

// Resolve the existing ancestor of a new file, without treating a dangling
// symlink as a missing directory. Such links cannot be safely authorized.
async function resolveTarget(filepath: string): Promise<string> {
  try {
    return await realpath(filepath)
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
    const entry = await lstat(filepath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error
    })
    if (entry?.isSymbolicLink()) throw new Error(`Cannot authorize dangling symlink: ${filepath}`, { cause: error })
    const parent = path.dirname(filepath)
    if (parent === filepath) throw error
    return path.join(await resolveTarget(parent), path.basename(filepath))
  }
}

export async function assertUnprotectedWrite(filepath: string) {
  const absolute = path.resolve(filepath)
  if (isProtected(absolute) || isProtected(await resolveTarget(absolute))) {
    throw new Error(`Agent writes to configuration and instruction files are forbidden: ${filepath}`)
  }
}
