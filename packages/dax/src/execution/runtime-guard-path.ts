import fs from "node:fs"
import path from "node:path"

/** Resolve an absent target through its nearest existing ancestor, preserving symlink boundaries. */
function realpathAllowMissing(target: string): string {
  try {
    return fs.realpathSync(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    const parent = path.dirname(target)
    if (parent === target) throw error
    return path.join(realpathAllowMissing(parent), path.basename(target))
  }
}

export function relativeGuardPath(input: { filePath: string; directory: string; worktree: string }): string {
  if (!input.filePath) return input.filePath
  const absolute = path.isAbsolute(input.filePath) ? input.filePath : path.resolve(input.directory, input.filePath)
  const root = fs.realpathSync(input.worktree)
  const target = realpathAllowMissing(absolute)
  const relative = path.relative(root, target)
  // On Windows, path.relative can return an absolute path for a different
  // volume. A real worktree must reject that crossing. The non-Git sentinel
  // "/" is deliberately global, however; preserve its existing cross-volume
  // behavior so contract scope checks can make the governing decision.
  return path.isAbsolute(relative) && input.worktree !== "/" ? `..${path.sep}${relative}` : relative
}
